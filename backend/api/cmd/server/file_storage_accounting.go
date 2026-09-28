package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	hardMaxFileBytes      int64 = 2_000_000_000
	postUploadMaxBytes    int64 = 100_000_000
	multipartPartBytes    int64 = 64 * 1024 * 1024
	uploadSessionLifetime       = 24 * time.Hour
)

type fileUploadPolicy struct {
	MaxBytes            int64
	AllowedContentTypes []string
}

func sameOptionalString(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

type fileStorageError struct {
	Status  int
	Code    string
	Message string
}

func (e *fileStorageError) Error() string { return e.Message }

func storageError(status int, code, message string) error {
	return &fileStorageError{Status: status, Code: code, Message: message}
}

func writeFileStorageError(w http.ResponseWriter, err error) bool {
	var storageErr *fileStorageError
	if !errors.As(err, &storageErr) {
		return false
	}
	errorJSON(w, storageErr.Status, storageErr.Code, storageErr.Message)
	return true
}

func validateFileUploadSize(policy fileUploadPolicy, declared, systemMax int64) error {
	limit := min(systemMax, hardMaxFileBytes)
	if policy.MaxBytes > 0 {
		limit = min(limit, policy.MaxBytes)
	}
	if declared <= 0 || declared > limit {
		if declared > hardMaxFileBytes || declared > systemMax {
			return storageError(413, "file_too_large", "文件超过系统单件大小上限")
		}
		return storageError(413, "file_policy_violation", "文件超过当前用途允许的大小")
	}
	return nil
}

func ensureWorkspaceStorageAccount(ctx context.Context, tx pgx.Tx, workspaceID string) error {
	_, err := tx.Exec(ctx, `INSERT INTO workspace_storage_accounts(workspace_id)
		VALUES($1) ON CONFLICT(workspace_id) DO NOTHING`, workspaceID)
	return err
}

// reserveUploadStorageTx serializes admissions on the Workspace account row,
// then applies both user quota and the physical safety cap before a session is
// persisted. Callers insert the matching file_upload_sessions row in this same
// transaction.
func reserveUploadStorageTx(ctx context.Context, tx pgx.Tx, workspaceID, userID, sessionID, idempotencyKey string, quotaBytes, physicalBytes, physicalLimit int64) error {
	if err := ensureWorkspaceStorageAccount(ctx, tx, workspaceID); err != nil {
		return err
	}
	// Serialize per-user hourly admission even when that user uploads into two
	// different Workspace accounts concurrently.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "file-upload-user:"+userID); err != nil {
		return err
	}
	// Serialize Workspace-scoped active/hourly limits before counting. Lock
	// order is always user -> Workspace -> account to avoid cross-scope deadlocks.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "file-upload-workspace:"+workspaceID); err != nil {
		return err
	}
	var activeUser, activeWorkspace, hourlyUser, hourlyWorkspace int
	err := tx.QueryRow(ctx, `SELECT
		(SELECT COUNT(*) FROM file_upload_sessions WHERE created_by=$1 AND id<>$3 AND status='pending' AND expires_at>NOW()),
		(SELECT COUNT(*) FROM file_upload_sessions WHERE workspace_id=$2 AND id<>$3 AND status='pending' AND expires_at>NOW()),
		(SELECT COUNT(*) FROM file_upload_sessions WHERE created_by=$1 AND id<>$3 AND created_at>NOW()-INTERVAL '1 hour'),
		(SELECT COUNT(*) FROM file_upload_sessions WHERE workspace_id=$2 AND id<>$3 AND created_at>NOW()-INTERVAL '1 hour')`, userID, workspaceID, sessionID).
		Scan(&activeUser, &activeWorkspace, &hourlyUser, &hourlyWorkspace)
	if err != nil {
		return err
	}
	if activeUser >= 4 || activeWorkspace >= 16 || hourlyUser >= 60 || hourlyWorkspace >= 240 {
		return storageError(429, "upload_rate_limited", "上传任务过多，请稍后再试")
	}
	var quotaLimit *int64
	var quotaUsed, quotaReserved, physicalUsed, physicalReserved int64
	var blocked bool
	var blockedReason string
	err = tx.QueryRow(ctx, `SELECT quota_limit_bytes,quota_used_bytes,quota_reserved_bytes,
		physical_used_bytes,physical_reserved_bytes,uploads_blocked,blocked_reason
		FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID).
		Scan(&quotaLimit, &quotaUsed, &quotaReserved, &physicalUsed, &physicalReserved, &blocked, &blockedReason)
	if err != nil {
		return err
	}
	if quotaLimit != nil && quotaUsed+quotaReserved+quotaBytes > *quotaLimit {
		return storageError(409, "workspace_quota_exceeded", "工作空间存储配额不足")
	}
	var observed *int64
	if err := tx.QueryRow(ctx, `SELECT physical_observed_bytes FROM workspace_storage_accounts WHERE workspace_id=$1`, workspaceID).Scan(&observed); err != nil {
		return err
	}
	if blocked {
		if blockedReason == "physical_limit" {
			return storageError(409, "workspace_physical_limit_exceeded", "工作空间已达到存储安全上限")
		}
		return storageError(503, "workspace_storage_reconciliation_required", "工作空间存储核对异常，暂时停止上传")
	}
	physicalBase := physicalUsed
	if observed != nil && *observed > physicalBase {
		physicalBase = *observed
	}
	if physicalLimit <= 0 || physicalBase+physicalReserved+physicalBytes > physicalLimit {
		return storageError(409, "workspace_physical_limit_exceeded", "工作空间存储安全空间不足")
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET
		quota_reserved_bytes=quota_reserved_bytes+$2,
		physical_reserved_bytes=physical_reserved_bytes+$3,updated_at=NOW()
		WHERE workspace_id=$1`, workspaceID, quotaBytes, physicalBytes); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO workspace_storage_reservations(
		id,workspace_id,upload_session_id,idempotency_key,user_id,reservation_kind,status,
		quota_reserved_bytes,physical_reserved_bytes
	) VALUES($1,$2,$1,NULLIF($3,''),$4,'upload','reserved',$5,$6)`, sessionID, workspaceID, idempotencyKey, userID, quotaBytes, physicalBytes)
	if err != nil {
		return err
	}
	return appendWorkspaceStorageEvent(ctx, tx, workspaceID, userID, "upload_reserved", 0, quotaBytes, 0, physicalBytes, "upload_session", sessionID)
}

func reserveCopyStorage(ctx context.Context, db pgxBeginner, workspaceID, userID, idempotencyKey string, size, physicalLimit int64) (string, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if len(idempotencyKey) > 200 {
		return "", storageError(http.StatusBadRequest, "invalid_idempotency_key", "复制请求标识无效")
	}
	id := newID()
	tx, err := db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if err := ensureWorkspaceStorageAccount(ctx, tx, workspaceID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "file-upload-user:"+userID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "file-upload-workspace:"+workspaceID); err != nil {
		return "", err
	}
	if idempotencyKey != "" {
		var existingID, existingStatus string
		err := tx.QueryRow(ctx, `SELECT id,status FROM workspace_storage_reservations
			WHERE workspace_id=$1 AND user_id=$2 AND idempotency_key=$3`, workspaceID, userID, idempotencyKey).
			Scan(&existingID, &existingStatus)
		if err == nil {
			if existingStatus == "committed" {
				return existingID, storageError(http.StatusConflict, "idempotency_conflict", "该复制请求已完成")
			}
			return existingID, storageError(http.StatusConflict, "idempotency_in_progress", "该复制请求正在处理")
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	var activeUser, activeWorkspace, hourlyUser, hourlyWorkspace int
	err = tx.QueryRow(ctx, `SELECT
		(SELECT COUNT(*) FROM file_upload_sessions WHERE created_by=$1 AND status='pending' AND expires_at>NOW()) +
		(SELECT COUNT(*) FROM workspace_storage_reservations WHERE user_id=$1 AND reservation_kind='copy' AND status='reserved'),
		(SELECT COUNT(*) FROM file_upload_sessions WHERE workspace_id=$2 AND status='pending' AND expires_at>NOW()) +
		(SELECT COUNT(*) FROM workspace_storage_reservations WHERE workspace_id=$2 AND reservation_kind='copy' AND status='reserved'),
		(SELECT COUNT(*) FROM file_upload_sessions WHERE created_by=$1 AND created_at>NOW()-INTERVAL '1 hour') +
		(SELECT COUNT(*) FROM workspace_storage_reservations WHERE user_id=$1 AND reservation_kind='copy' AND created_at>NOW()-INTERVAL '1 hour'),
		(SELECT COUNT(*) FROM file_upload_sessions WHERE workspace_id=$2 AND created_at>NOW()-INTERVAL '1 hour') +
		(SELECT COUNT(*) FROM workspace_storage_reservations WHERE workspace_id=$2 AND reservation_kind='copy' AND created_at>NOW()-INTERVAL '1 hour')`, userID, workspaceID).
		Scan(&activeUser, &activeWorkspace, &hourlyUser, &hourlyWorkspace)
	if err != nil {
		return "", err
	}
	if activeUser >= 4 || activeWorkspace >= 16 || hourlyUser >= 60 || hourlyWorkspace >= 240 {
		return "", storageError(http.StatusTooManyRequests, "upload_rate_limited", "上传任务过多，请稍后再试")
	}
	var limit *int64
	var used, reserved, physicalUsed, physicalReserved int64
	var observed *int64
	var blocked bool
	var reason string
	err = tx.QueryRow(ctx, `SELECT quota_limit_bytes,quota_used_bytes,quota_reserved_bytes,
		physical_used_bytes,physical_reserved_bytes,physical_observed_bytes,uploads_blocked,blocked_reason
		FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID).
		Scan(&limit, &used, &reserved, &physicalUsed, &physicalReserved, &observed, &blocked, &reason)
	if err != nil {
		return "", err
	}
	if limit != nil && used+reserved+size > *limit {
		return "", storageError(http.StatusConflict, "workspace_quota_exceeded", "工作空间存储配额不足")
	}
	if blocked {
		if reason == "physical_limit" {
			return "", storageError(http.StatusConflict, "workspace_physical_limit_exceeded", "工作空间已达到存储安全上限")
		}
		return "", storageError(http.StatusServiceUnavailable, "workspace_storage_reconciliation_required", "工作空间存储核对异常，暂时停止上传")
	}
	if observed != nil && *observed > physicalUsed {
		physicalUsed = *observed
	}
	if physicalLimit <= 0 || physicalUsed+physicalReserved+size > physicalLimit {
		return "", storageError(http.StatusConflict, "workspace_physical_limit_exceeded", "工作空间存储安全空间不足")
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET quota_reserved_bytes=quota_reserved_bytes+$2,
		physical_reserved_bytes=physical_reserved_bytes+$2,updated_at=NOW() WHERE workspace_id=$1`, workspaceID, size); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_reservations(id,workspace_id,idempotency_key,user_id,
		reservation_kind,status,quota_reserved_bytes,physical_reserved_bytes)
		VALUES($1,$2,NULLIF($3,''),$4,'copy','reserved',$5,$5)`, id, workspaceID, idempotencyKey, userID, size); err != nil {
		return "", err
	}
	if err := appendWorkspaceStorageEvent(ctx, tx, workspaceID, userID, "copy_reserved", 0, size, 0, size, "storage_reservation", id); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

type pgxBeginner interface {
	Begin(context.Context) (pgx.Tx, error)
}

func commitCopyStorageTx(ctx context.Context, tx pgx.Tx, reservationID, workspaceID, userID, versionID string, size int64) error {
	var status string
	var quotaReserved, physicalReserved int64
	if err := tx.QueryRow(ctx, `SELECT status,quota_reserved_bytes,physical_reserved_bytes
		FROM workspace_storage_reservations WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, reservationID, workspaceID).
		Scan(&status, &quotaReserved, &physicalReserved); err != nil {
		return err
	}
	if status != "reserved" {
		return fmt.Errorf("copy storage reservation %s is not active", reservationID)
	}
	if _, err := tx.Exec(ctx, `UPDATE file_versions SET quota_charged=TRUE WHERE id=$1 AND workspace_id=$2 AND quota_charged=FALSE`, versionID, workspaceID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET quota_reserved_bytes=GREATEST(0,quota_reserved_bytes-$2),
		quota_used_bytes=quota_used_bytes+$3,physical_reserved_bytes=GREATEST(0,physical_reserved_bytes-$4),
		physical_used_bytes=physical_used_bytes+$5,updated_at=NOW() WHERE workspace_id=$1`, workspaceID, quotaReserved, size, physicalReserved, size); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_reservations SET status='committed',quota_reserved_bytes=0,
		quota_committed_bytes=$2,physical_reserved_bytes=0,updated_at=NOW() WHERE id=$1`, reservationID, size); err != nil {
		return err
	}
	return appendWorkspaceStorageEvent(ctx, tx, workspaceID, userID, "attachment_copy_committed", size, -quotaReserved, size, -physicalReserved, "file_version", versionID)
}

func releaseUncommittedCopyStorage(ctx context.Context, db pgxBeginner, reservationID, workspaceID, userID string, releasePhysical bool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID); err != nil {
		return err
	}
	var status string
	var quotaReserved, physicalReserved int64
	err = tx.QueryRow(ctx, `SELECT status,quota_reserved_bytes,physical_reserved_bytes
		FROM workspace_storage_reservations WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, reservationID, workspaceID).
		Scan(&status, &quotaReserved, &physicalReserved)
	if errors.Is(err, pgx.ErrNoRows) || status != "reserved" {
		return err
	}
	if err != nil {
		return err
	}
	releasePhysicalBytes := int64(0)
	if releasePhysical {
		releasePhysicalBytes = physicalReserved
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET quota_reserved_bytes=GREATEST(0,quota_reserved_bytes-$2),
		physical_reserved_bytes=GREATEST(0,physical_reserved_bytes-$3),updated_at=NOW() WHERE workspace_id=$1`, workspaceID, quotaReserved, releasePhysicalBytes); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_reservations SET status='released',quota_reserved_bytes=0,
		physical_reserved_bytes=CASE WHEN $2 THEN 0 ELSE physical_reserved_bytes END,updated_at=NOW() WHERE id=$1`, reservationID, releasePhysical); err != nil {
		return err
	}
	if err := appendWorkspaceStorageEvent(ctx, tx, workspaceID, userID, "copy_reservation_released", 0, -quotaReserved, 0, -releasePhysicalBytes, "storage_reservation", reservationID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func appendWorkspaceStorageEvent(ctx context.Context, tx pgx.Tx, workspaceID, actorID, eventType string, quotaUsedDelta, quotaReservedDelta, physicalUsedDelta, physicalReservedDelta int64, referenceType, referenceID string) error {
	_, err := tx.Exec(ctx, `INSERT INTO workspace_storage_events(
		workspace_id,actor_user_id,actor_label,event_type,quota_used_delta,quota_reserved_delta,
		physical_used_delta,physical_reserved_delta,reference_type,reference_id
	) VALUES($1,NULLIF($2,''),$2,$3,$4,$5,$6,$7,$8,$9)`, workspaceID, actorID, eventType,
		quotaUsedDelta, quotaReservedDelta, physicalUsedDelta, physicalReservedDelta, referenceType, referenceID)
	return err
}

// commitUploadReservationTx converts the user quota reservation into a version
// charge. One copy's bytes become tracked physical usage; the remaining physical
// reservation covers the staging object until the Worker confirms its removal.
func commitUploadReservationTx(ctx context.Context, tx pgx.Tx, sessionID, versionID, workspaceID, actorID string, size int64) error {
	var status string
	var quotaReserved, physicalReserved int64
	err := tx.QueryRow(ctx, `SELECT status,quota_reserved_bytes,physical_reserved_bytes
		FROM workspace_storage_reservations WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, sessionID, workspaceID).
		Scan(&status, &quotaReserved, &physicalReserved)
	if err != nil {
		return err
	}
	if status == "committed" {
		return nil
	}
	if status != "reserved" {
		return fmt.Errorf("upload reservation %s is not active", sessionID)
	}
	var charged bool
	if err := tx.QueryRow(ctx, `UPDATE file_versions SET quota_charged=TRUE
		WHERE id=$1 AND workspace_id=$2 AND quota_charged=FALSE RETURNING quota_charged`, versionID, workspaceID).Scan(&charged); err != nil {
		return err
	}
	remainingPhysical := physicalReserved - size
	if remainingPhysical < 0 {
		remainingPhysical = 0
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET
		quota_reserved_bytes=GREATEST(0,quota_reserved_bytes-$2),quota_used_bytes=quota_used_bytes+$3,
		physical_reserved_bytes=GREATEST(0,physical_reserved_bytes-$4),physical_used_bytes=physical_used_bytes+$5,
		updated_at=NOW() WHERE workspace_id=$1`, workspaceID, quotaReserved, size, physicalReserved-remainingPhysical, size); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_reservations SET status='committed',
		quota_reserved_bytes=0,quota_committed_bytes=$2,physical_reserved_bytes=$3,updated_at=NOW()
		WHERE id=$1`, sessionID, size, remainingPhysical); err != nil {
		return err
	}
	return appendWorkspaceStorageEvent(ctx, tx, workspaceID, actorID, "upload_committed", size, -quotaReserved, size, -(physicalReserved - remainingPhysical), "file_version", versionID)
}

func releaseSessionQuotaTx(ctx context.Context, tx pgx.Tx, sessionID, actorID, workspaceID string) error {
	var status string
	var reserved int64
	err := tx.QueryRow(ctx, `SELECT status,quota_reserved_bytes FROM workspace_storage_reservations
		WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, sessionID, workspaceID).Scan(&status, &reserved)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil || status != "reserved" {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET quota_reserved_bytes=GREATEST(0,quota_reserved_bytes-$2),updated_at=NOW()
		WHERE workspace_id=$1`, workspaceID, reserved); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_reservations SET status='released',quota_reserved_bytes=0,updated_at=NOW() WHERE id=$1`, sessionID); err != nil {
		return err
	}
	return appendWorkspaceStorageEvent(ctx, tx, workspaceID, actorID, "upload_reservation_released", 0, -reserved, 0, 0, "upload_session", sessionID)
}

func releaseSessionPhysicalTx(ctx context.Context, tx pgx.Tx, sessionID, workspaceID string) error {
	var reserved int64
	err := tx.QueryRow(ctx, `SELECT physical_reserved_bytes FROM workspace_storage_reservations
		WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, sessionID, workspaceID).Scan(&reserved)
	if errors.Is(err, pgx.ErrNoRows) || reserved == 0 {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET physical_reserved_bytes=GREATEST(0,physical_reserved_bytes-$2),updated_at=NOW()
		WHERE workspace_id=$1`, workspaceID, reserved); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_reservations SET physical_reserved_bytes=0,updated_at=NOW() WHERE id=$1`, sessionID); err != nil {
		return err
	}
	return appendWorkspaceStorageEvent(ctx, tx, workspaceID, "", "upload_staging_reclaimed", 0, 0, 0, -reserved, "upload_session", sessionID)
}

func releaseVersionChargeTx(ctx context.Context, tx pgx.Tx, workspaceID, fileID, actorID, eventType string) error {
	var bytes int64
	err := tx.QueryRow(ctx, `WITH released AS (
		UPDATE file_versions SET quota_charged=FALSE WHERE workspace_id=$1 AND file_id=$2 AND quota_charged=TRUE
		RETURNING size_bytes
	) SELECT COALESCE(SUM(size_bytes),0) FROM released`, workspaceID, fileID).Scan(&bytes)
	if err != nil || bytes == 0 {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET quota_used_bytes=GREATEST(0,quota_used_bytes-$2),updated_at=NOW()
		WHERE workspace_id=$1`, workspaceID, bytes); err != nil {
		return err
	}
	return appendWorkspaceStorageEvent(ctx, tx, workspaceID, actorID, eventType, -bytes, 0, 0, 0, "file", fileID)
}

func cancelPendingFileSessionsTx(ctx context.Context, tx pgx.Tx, workspaceID, fileID, actorID string) error {
	rows, err := tx.Query(ctx, `SELECT id FROM file_upload_sessions WHERE workspace_id=$1 AND file_id=$2 AND status='pending' FOR UPDATE`, workspaceID, fileID)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, id := range ids {
		if _, err := tx.Exec(ctx, `UPDATE file_upload_sessions SET status='cancelled',cancelled_at=NOW() WHERE id=$1`, id); err != nil {
			return err
		}
		if err := releaseSessionQuotaTx(ctx, tx, id, actorID, workspaceID); err != nil {
			return err
		}
	}
	return nil
}

func chargeRestoredFileTx(ctx context.Context, tx pgx.Tx, workspaceID, fileID, actorID string) error {
	var bytes int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(SUM(size_bytes),0) FROM file_versions
		WHERE workspace_id=$1 AND file_id=$2 AND security_status IN ('pending','clean')
		AND object_purged_at IS NULL AND quota_charged=FALSE`, workspaceID, fileID).Scan(&bytes); err != nil {
		return err
	}
	if bytes == 0 {
		return nil
	}
	var limit *int64
	var used, reserved int64
	if err := tx.QueryRow(ctx, `SELECT quota_limit_bytes,quota_used_bytes,quota_reserved_bytes
		FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID).Scan(&limit, &used, &reserved); err != nil {
		return err
	}
	if limit != nil && used+reserved+bytes > *limit {
		return storageError(409, "restore_quota_exceeded", "恢复后将超过工作空间存储配额；文件仍保留在回收站")
	}
	if _, err := tx.Exec(ctx, `UPDATE file_versions SET quota_charged=TRUE WHERE workspace_id=$1 AND file_id=$2
		AND security_status IN ('pending','clean') AND object_purged_at IS NULL AND quota_charged=FALSE`, workspaceID, fileID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET quota_used_bytes=quota_used_bytes+$2,updated_at=NOW()
		WHERE workspace_id=$1`, workspaceID, bytes); err != nil {
		return err
	}
	return appendWorkspaceStorageEvent(ctx, tx, workspaceID, actorID, "file_restored", bytes, 0, 0, 0, "file", fileID)
}
