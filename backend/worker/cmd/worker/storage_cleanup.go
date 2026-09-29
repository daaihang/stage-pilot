package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	objectstore "github.com/daaihang/stagepilot/backend/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fileObjectRemover interface {
	RemoveObject(context.Context, objectstore.ObjectRef) error
}

type fileMultipartUploadAborter interface {
	AbortMultipart(context.Context, objectstore.ObjectRef, string) error
}

type fileMultipartPartLister interface {
	ListParts(context.Context, objectstore.ObjectRef, string, int, int) (objectstore.PartsPage, error)
}

// cleanupFiles reclaims unfinished uploads, expired quarantined versions, and
// soft-deleted file versions whose retention deadline has elapsed.
func cleanupFiles(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client objectstore.Client) {
	if client == nil {
		return
	}
	bucket := envOrDefault("S3_BUCKET", "stagepilot")
	stagingBucket := envOrDefault("S3_STAGING_BUCKET", bucket+"-staging")
	if err := validateWorkerStorageBuckets(ctx, client, []string{bucket, stagingBucket}); err != nil {
		logger.Error("skip object cleanup because bucket versioning or scope is unsafe", "error", err)
		return
	}
	uploadTTL := durationOrDefault("S3_UPLOAD_URL_TTL", 15*time.Minute)
	staleAfter := 24 * time.Hour
	if uploadTTL+time.Hour > staleAfter {
		staleAfter = uploadTTL + time.Hour
	}
	cleanupFilesWithClient(ctx, logger, db, client, staleAfter)
	cleanupUploadSessionsWithClient(ctx, logger, db, client, staleAfter)
	cleanupCopyAttemptsWithClient(ctx, logger, db, client, staleAfter)
	freezeLegacyFileVersions(ctx, logger, db, client, uploadTTL+time.Hour)
	cleanupExpiredFileVersions(ctx, logger, db, client)
}

func cleanupUploadSessionsWithClient(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client fileObjectRemover, staleAfter time.Duration) {
	// Expire at the session deadline, release its product quota immediately, but
	// retain physical headroom until every signed URL and temporary object is gone.
	expiredRows, err := db.Query(ctx, `SELECT id,workspace_id FROM file_upload_sessions
		WHERE status='pending' AND expires_at<=NOW() ORDER BY expires_at,id LIMIT 100`)
	if err != nil {
		logger.Warn("list expired file upload sessions", "error", err)
		return
	}
	type uploadRef struct{ id, workspaceID string }
	expired := []uploadRef{}
	for expiredRows.Next() {
		var item uploadRef
		if err := expiredRows.Scan(&item.id, &item.workspaceID); err != nil {
			expiredRows.Close()
			logger.Warn("scan upload session", "error", err)
			return
		}
		expired = append(expired, item)
	}
	err = expiredRows.Err()
	expiredRows.Close()
	if err != nil {
		logger.Warn("read expired upload sessions", "error", err)
		return
	}
	for _, item := range expired {
		tx, err := db.Begin(ctx)
		if err != nil {
			logger.Warn("begin upload expiry", "error", err)
			continue
		}
		if _, err = tx.Exec(ctx, `INSERT INTO workspace_storage_accounts(workspace_id) VALUES($1) ON CONFLICT DO NOTHING`, item.workspaceID); err == nil {
			_, err = tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, item.workspaceID)
		}
		if err == nil {
			var status string
			err = tx.QueryRow(ctx, `UPDATE file_upload_sessions SET status='abandoned' WHERE id=$1 AND workspace_id=$2
				AND status='pending' AND expires_at<=NOW() RETURNING status`, item.id, item.workspaceID).Scan(&status)
		}
		if err == nil {
			err = settleWorkerReservationTx(ctx, tx, item.workspaceID, item.id, true, false, "upload_expired")
		}
		if err == nil {
			err = tx.Commit(ctx)
		} else {
			_ = tx.Rollback(ctx)
		}
		if err != nil {
			logger.Warn("expire upload session", "upload_id", item.id, "error", err)
		}
	}
	rows, err := db.Query(ctx, `SELECT id,workspace_id,staging_bucket,staging_key,multipart_upload_id,upload_url_expires_at
		FROM file_upload_sessions WHERE object_purged_at IS NULL AND status IN ('abandoned','cancelled','completed')
		AND COALESCE(upload_url_expires_at,expires_at)<=NOW()-INTERVAL '1 hour'
		ORDER BY object_cleanup_attempted_at NULLS FIRST,created_at,id LIMIT 100`)
	if err != nil {
		logger.Warn("list staging objects for cleanup", "error", err)
		return
	}
	type upload struct {
		id, workspaceID, bucket, key string
		multipartID                  *string
	}
	items := []upload{}
	for rows.Next() {
		var item upload
		var urlExpired *time.Time
		if err := rows.Scan(&item.id, &item.workspaceID, &item.bucket, &item.key, &item.multipartID, &urlExpired); err != nil {
			rows.Close()
			logger.Warn("scan upload staging cleanup", "error", err)
			return
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		logger.Warn("read staging cleanup list", "error", err)
		return
	}
	for _, item := range items {
		tx, err := db.Begin(ctx)
		if err != nil {
			logger.Warn("begin staging cleanup", "error", err)
			continue
		}
		if _, err = tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, item.workspaceID); err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("lock storage account for upload cleanup", "upload_id", item.id, "error", err)
			continue
		}
		var lockID string
		err = tx.QueryRow(ctx, `UPDATE file_upload_sessions SET object_cleanup_attempted_at=NOW()
			WHERE id=$1 AND workspace_id=$2 AND status IN ('abandoned','cancelled','completed') AND object_purged_at IS NULL
			RETURNING id`, item.id, item.workspaceID).Scan(&lockID)
		if err != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		ref := objectstore.ObjectRef{Bucket: item.bucket, Key: item.key}
		if item.multipartID != nil {
			aborter, canAbort := client.(fileMultipartUploadAborter)
			lister, canVerify := client.(fileMultipartPartLister)
			if !canAbort || !canVerify {
				_ = tx.Commit(ctx)
				logger.Warn("multipart cleanup adapter cannot verify abort", "upload_id", item.id)
				continue
			}
			if err := aborter.AbortMultipart(ctx, ref, *item.multipartID); err != nil && !errors.Is(err, objectstore.ErrMultipartNotFound) {
				_ = tx.Commit(ctx)
				logger.Warn("abort incomplete multipart upload", "upload_id", item.id, "error", err)
				continue
			}
			// S3 can still finish an in-flight part after an abort. Do not release
			// physical headroom while storage still reports the multipart upload.
			parts, listErr := lister.ListParts(ctx, ref, *item.multipartID, 0, 1)
			if listErr == nil || !errors.Is(listErr, objectstore.ErrMultipartNotFound) {
				_ = tx.Commit(ctx)
				logger.Warn("multipart upload still needs cleanup", "upload_id", item.id, "parts", len(parts.Parts), "error", listErr)
				continue
			}
		}
		if err := client.RemoveObject(ctx, ref); err != nil {
			_ = tx.Commit(ctx)
			logger.Warn("remove expired staging object", "upload_id", item.id, "error", err)
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE file_upload_sessions SET object_purged_at=NOW() WHERE id=$1 AND object_purged_at IS NULL`, item.id); err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("mark staging object purged", "error", err)
			continue
		}
		if err := settleWorkerReservationTx(ctx, tx, item.workspaceID, item.id, false, true, "upload_staging_reclaimed"); err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("release staging reservation", "upload_id", item.id, "error", err)
			continue
		}
		if err := tx.Commit(ctx); err != nil {
			logger.Warn("commit staging cleanup", "upload_id", item.id, "error", err)
		}
	}
}

func cleanupCopyAttemptsWithClient(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client fileObjectRemover, staleAfter time.Duration) {
	rows, err := db.Query(ctx, `SELECT id,workspace_id,bucket,object_key,storage_reservation_id FROM file_copy_attempts
		WHERE status='pending' AND object_purged_at IS NULL AND created_at < $1
		ORDER BY object_cleanup_attempted_at NULLS FIRST,created_at,id LIMIT 100`, time.Now().Add(-staleAfter))
	if err != nil {
		logger.Warn("list uncommitted file copies", "error", err)
		return
	}
	type copyAttempt struct {
		id, workspaceID, bucket, key string
		reservationID                *string
	}
	items := []copyAttempt{}
	for rows.Next() {
		var item copyAttempt
		if err := rows.Scan(&item.id, &item.workspaceID, &item.bucket, &item.key, &item.reservationID); err != nil {
			rows.Close()
			logger.Warn("scan copy attempt", "error", err)
			return
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		logger.Warn("read copy attempts", "error", err)
		return
	}
	for _, item := range items {
		tx, err := db.Begin(ctx)
		if err != nil {
			logger.Warn("begin copy cleanup", "error", err)
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_accounts(workspace_id) VALUES($1) ON CONFLICT DO NOTHING`, item.workspaceID); err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("ensure copy cleanup storage account", "copy_id", item.id, "error", err)
			continue
		}
		if _, err := tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, item.workspaceID); err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("lock copy cleanup storage account", "copy_id", item.id, "error", err)
			continue
		}
		// Keep the row lock until the object removal finishes. A publishing
		// transaction must not mark this copy committed while cleanup deletes it.
		var lockID string
		err = tx.QueryRow(ctx, `UPDATE file_copy_attempts SET object_cleanup_attempted_at=NOW()
			WHERE id=$1 AND status='pending' AND object_purged_at IS NULL RETURNING id`, item.id).Scan(&lockID)
		if err != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		if err := client.RemoveObject(ctx, objectstore.ObjectRef{Bucket: item.bucket, Key: item.key}); err != nil {
			_ = tx.Commit(ctx)
			logger.Warn("remove uncommitted file copy", "copy_id", item.id, "error", err)
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE file_copy_attempts SET object_purged_at=NOW() WHERE id=$1`, item.id); err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("mark uncommitted copy purged", "error", err)
			continue
		}
		if item.reservationID != nil {
			if err := settleWorkerReservationTx(ctx, tx, item.workspaceID, *item.reservationID, true, true, "copy_object_reclaimed"); err != nil {
				_ = tx.Rollback(ctx)
				logger.Warn("release copy reservation", "copy_id", item.id, "error", err)
				continue
			}
		}
		if err := tx.Commit(ctx); err != nil {
			logger.Warn("commit uncommitted copy cleanup", "error", err)
		}
	}
}

func freezeLegacyFileVersions(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client interface {
	objectstore.ObjectReader
	objectstore.ObjectWriter
}, minAge time.Duration) {
	rows, err := db.Query(ctx, `SELECT id,workspace_id,bucket,object_key,etag,size_bytes FROM file_versions
		WHERE version_no=1 AND frozen_at IS NULL AND created_at < $1 ORDER BY created_at,id LIMIT 30`, time.Now().Add(-minAge))
	if err != nil {
		logger.Warn("list legacy file versions", "error", err)
		return
	}
	type legacy struct {
		id, workspace, bucket, key, etag string
		size                             int64
	}
	items := []legacy{}
	for rows.Next() {
		var item legacy
		if err := rows.Scan(&item.id, &item.workspace, &item.bucket, &item.key, &item.etag, &item.size); err != nil {
			rows.Close()
			logger.Warn("scan legacy version", "error", err)
			return
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		logger.Warn("read legacy versions", "error", err)
		return
	}
	for _, item := range items {
		if ctx.Err() != nil {
			return
		}
		stat, err := client.StatObject(ctx, objectstore.ObjectRef{Bucket: item.bucket, Key: item.key})
		if err != nil {
			if isMissingObject(err) {
				rejectLegacyFileVersion(ctx, logger, db, item.id, "object_missing")
			} else {
				logger.Warn("stat legacy version", "version_id", item.id, "error", err)
			}
			continue
		}
		if stat.Size != item.size {
			rejectLegacyFileVersion(ctx, logger, db, item.id, "size_mismatch")
			continue
		}
		attemptID := fmt.Sprintf("freeze-%d-%s", time.Now().UnixNano(), item.id)
		key := "ws/" + item.workspace + "/versions/" + attemptID
		if _, err := db.Exec(ctx, `INSERT INTO file_copy_attempts(id,workspace_id,bucket,object_key) VALUES($1,$2,$3,$4)`, attemptID, item.workspace, item.bucket, key); err != nil {
			logger.Warn("record legacy freeze attempt", "version_id", item.id, "error", err)
			continue
		}
		copied, err := client.CopyObject(ctx, objectstore.ObjectRef{Bucket: item.bucket, Key: item.key}, objectstore.ObjectRef{Bucket: item.bucket, Key: key}, stat.ETag, item.size)
		if err != nil {
			logger.Warn("copy legacy version", "version_id", item.id, "error", err)
			continue
		}
		if copied.Size != item.size {
			logger.Warn("verify legacy version copy", "version_id", item.id, "expected_size", item.size, "actual_size", copied.Size)
			continue
		}
		copiedETag := copied.ETag
		tx, err := db.Begin(ctx)
		if err != nil {
			logger.Warn("begin legacy freeze", "error", err)
			continue
		}
		var fileID string
		err = tx.QueryRow(ctx, `UPDATE file_versions SET bucket=$1,object_key=$2,etag=$3,frozen_at=NOW()
			WHERE id=$4 AND frozen_at IS NULL RETURNING file_id`, item.bucket, key, copiedETag, item.id).Scan(&fileID)
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE files SET bucket=$1,object_key=$2,etag=$3 WHERE id=$4 AND current_version_id=$5`, item.bucket, key, copiedETag, fileID, item.id)
		}
		if err == nil {
			tag, updateErr := tx.Exec(ctx, `UPDATE file_copy_attempts SET status='committed' WHERE id=$1 AND status='pending' AND object_purged_at IS NULL`, attemptID)
			err = updateErr
			if err == nil && tag.RowsAffected() != 1 {
				err = fmt.Errorf("legacy freeze copy %s was already cleaned", attemptID)
			}
		}
		if err == nil {
			err = tx.Commit(ctx)
		} else {
			_ = tx.Rollback(ctx)
		}
		if err != nil {
			logger.Warn("commit legacy freeze", "version_id", item.id, "error", err)
			_ = client.RemoveObject(ctx, objectstore.ObjectRef{Bucket: item.bucket, Key: key})
		}
	}
}

func cleanupFilesWithClient(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client fileObjectRemover, staleAfter time.Duration) {
	purgeQuarantinedVersionsWithAccounting(ctx, logger, db, client)
	// Claim before removing the object. The API can only complete a pending file,
	// so a concurrent completion and cleanup cannot both succeed.
	_, err := db.Exec(ctx, `WITH stale AS (
		SELECT id FROM files WHERE status='pending' AND created_at < $1
		ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
	) UPDATE files f SET status='abandoned',updated_at=NOW()
	FROM stale WHERE f.id=stale.id`, time.Now().Add(-staleAfter))
	if err != nil {
		logger.Warn("claim stale uploads", "error", err)
		return
	}
	rows, err := db.Query(ctx, `SELECT id,bucket,object_key FROM files
		WHERE status='abandoned' AND object_purged_at IS NULL
		ORDER BY object_cleanup_attempted_at NULLS FIRST,created_at,id LIMIT 100`)
	if err != nil {
		logger.Warn("list abandoned uploads", "error", err)
		return
	}
	type abandonedFile struct{ id, bucket, key string }
	files := make([]abandonedFile, 0, 100)
	for rows.Next() {
		var file abandonedFile
		if err := rows.Scan(&file.id, &file.bucket, &file.key); err != nil {
			rows.Close()
			logger.Warn("scan abandoned uploads", "error", err)
			return
		}
		files = append(files, file)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		logger.Warn("read abandoned uploads", "error", err)
		return
	}
	for _, file := range files {
		if _, err := db.Exec(ctx, `UPDATE files SET object_cleanup_attempted_at=NOW()
			WHERE id=$1 AND status='abandoned' AND object_purged_at IS NULL`, file.id); err != nil {
			logger.Warn("record abandoned object attempt", "file_id", file.id, "error", err)
			continue
		}
		if err := client.RemoveObject(ctx, objectstore.ObjectRef{Bucket: file.bucket, Key: file.key}); err != nil {
			logger.Warn("remove abandoned object", "file_id", file.id, "error", err)
			continue
		}
		if _, err := db.Exec(ctx, `UPDATE files SET object_purged_at=NOW(),updated_at=NOW()
			WHERE id=$1 AND status='abandoned' AND object_purged_at IS NULL`, file.id); err != nil {
			logger.Warn("record abandoned object cleanup", "file_id", file.id, "error", err)
		}
	}
}

func purgeQuarantinedVersions(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client fileObjectRemover) {
	rows, err := db.Query(ctx, `SELECT id FROM file_versions WHERE security_status='infected'
		AND quarantine_until <= NOW() AND object_purged_at IS NULL
		ORDER BY object_cleanup_attempted_at NULLS FIRST,quarantine_until,id LIMIT 100`)
	if err != nil {
		logger.Warn("list expired quarantined versions", "error", err)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			logger.Warn("scan expired quarantined version", "error", err)
			return
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		logger.Warn("read expired quarantined versions", "error", err)
		return
	}
	for _, id := range ids {
		tx, err := db.Begin(ctx)
		if err != nil {
			logger.Warn("begin quarantined object cleanup", "error", err)
			continue
		}
		var bucket, key string
		err = tx.QueryRow(ctx, `SELECT bucket,object_key FROM file_versions WHERE id=$1 AND security_status='infected'
			AND quarantine_until <= NOW() AND object_purged_at IS NULL FOR UPDATE SKIP LOCKED`, id).Scan(&bucket, &key)
		if err != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		if _, err = tx.Exec(ctx, `UPDATE file_versions SET object_cleanup_attempted_at=NOW() WHERE id=$1`, id); err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("mark quarantine cleanup attempt", "version_id", id, "error", err)
			continue
		}
		if err = client.RemoveObject(ctx, objectstore.ObjectRef{Bucket: bucket, Key: key}); err != nil {
			_ = tx.Commit(ctx)
			logger.Warn("purge expired quarantined object", "version_id", id, "error", err)
			continue
		}
		if _, err = tx.Exec(ctx, `UPDATE file_versions SET object_purged_at=NOW() WHERE id=$1 AND object_purged_at IS NULL`, id); err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("record quarantined object purge", "version_id", id, "error", err)
			continue
		}
		if err := tx.Commit(ctx); err != nil {
			logger.Warn("commit quarantined object purge", "version_id", id, "error", err)
		}
	}
}

func cleanupTicker(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client objectstore.Client, interval time.Duration) {
	cleanupFiles(ctx, logger, db, client)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cleanupFiles(ctx, logger, db, client)
		}
	}
}
