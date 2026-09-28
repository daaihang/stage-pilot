package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
)

type storedObjectKey struct {
	bucket string
	key    string
}

type storageWorkspaceSnapshot struct {
	workspaceID string
	bytes       int64
	unknown     int
	missing     int
	parts       map[string]int64
	keys        map[storedObjectKey]int64
}

func settleWorkerReservationTx(ctx context.Context, tx pgx.Tx, workspaceID, reservationID string, releaseQuota, releasePhysical bool, event string) error {
	var status, userID string
	var quotaReserved, physicalReserved int64
	err := tx.QueryRow(ctx, `SELECT status,user_id,quota_reserved_bytes,physical_reserved_bytes
		FROM workspace_storage_reservations WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, reservationID, workspaceID).
		Scan(&status, &userID, &quotaReserved, &physicalReserved)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	quotaDelta, physicalDelta := int64(0), int64(0)
	newQuota, newPhysical := quotaReserved, physicalReserved
	if releaseQuota && status == "reserved" {
		quotaDelta = -quotaReserved
		newQuota = 0
	}
	if releasePhysical {
		physicalDelta = -physicalReserved
		newPhysical = 0
	}
	if quotaDelta == 0 && physicalDelta == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET
		quota_reserved_bytes=GREATEST(0,quota_reserved_bytes+$2),
		physical_reserved_bytes=GREATEST(0,physical_reserved_bytes+$3),updated_at=NOW()
		WHERE workspace_id=$1`, workspaceID, quotaDelta, physicalDelta); err != nil {
		return err
	}
	newStatus := status
	if releaseQuota && status == "reserved" {
		newStatus = "released"
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_reservations SET status=$2,quota_reserved_bytes=$3,
		physical_reserved_bytes=$4,updated_at=NOW() WHERE id=$1`, reservationID, newStatus, newQuota, newPhysical); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO workspace_storage_events(workspace_id,actor_user_id,actor_label,event_type,
		quota_reserved_delta,physical_reserved_delta,reference_type,reference_id)
		VALUES($1,$2,$2,$3,$4,$5,'storage_reservation',$6)`, workspaceID, userID, event, quotaDelta, physicalDelta, reservationID)
	return err
}

// reconcileWorkspaceStorage inventories content objects and incomplete
// multipart parts without deleting unknown data. Unknown or missing references
// block new uploads until an operator resolves the discrepancy.
func reconcileWorkspaceStorage(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client *minio.Client, buckets []string, physicalLimit int64) {
	rows, err := db.Query(ctx, `SELECT id FROM workspaces WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		logger.Warn("list workspaces for storage reconciliation", "error", err)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			logger.Warn("scan workspace for storage reconciliation", "error", err)
			return
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		logger.Warn("read workspaces for storage reconciliation", "error", err)
		return
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return
		}
		snapshot, err := inventoryWorkspaceStorage(ctx, db, client, buckets, id)
		if err != nil {
			blockWorkspaceUploads(ctx, db, id, "reconciliation_error")
			logger.Warn("workspace storage reconciliation failed", "workspace_id", id, "error", err)
			continue
		}
		if err := applyWorkspaceStorageSnapshot(ctx, db, snapshot, physicalLimit); err != nil {
			blockWorkspaceUploads(ctx, db, id, "reconciliation_error")
			logger.Warn("store workspace storage snapshot", "workspace_id", id, "error", err)
			continue
		}
		if snapshot.unknown > 0 || snapshot.missing > 0 || snapshot.bytes > physicalLimit {
			logger.Warn("workspace storage mismatch blocks uploads", "workspace_id", id,
				"observed_bytes", snapshot.bytes, "unknown_objects", snapshot.unknown,
				"missing_objects", snapshot.missing, "physical_limit_bytes", physicalLimit)
		}
	}
}

func inventoryWorkspaceStorage(ctx context.Context, db *pgxpool.Pool, client *minio.Client, buckets []string, workspaceID string) (storageWorkspaceSnapshot, error) {
	snapshot := storageWorkspaceSnapshot{workspaceID: workspaceID, parts: map[string]int64{}, keys: map[storedObjectKey]int64{}}
	rows, err := db.Query(ctx, `SELECT bucket,object_key FROM (
		SELECT bucket,object_key FROM file_versions WHERE workspace_id=$1 AND object_purged_at IS NULL
		UNION SELECT staging_bucket,staging_key FROM file_upload_sessions WHERE workspace_id=$1 AND object_purged_at IS NULL
		UNION SELECT bucket,object_key FROM file_copy_attempts WHERE workspace_id=$1 AND status='pending' AND object_purged_at IS NULL
		UNION SELECT f.bucket,f.object_key FROM files f WHERE f.workspace_id=$1 AND f.deleted_at IS NULL AND f.object_purged_at IS NULL
			AND f.status IN ('pending','uploaded','abandoned')
			AND f.created_at<NOW()-INTERVAL '1 hour'
			AND NOT EXISTS(SELECT 1 FROM file_versions v WHERE v.file_id=f.id)
			AND NOT EXISTS(SELECT 1 FROM file_upload_sessions s WHERE s.file_id=f.id AND s.workspace_id=f.workspace_id)
	) refs WHERE bucket<>'' AND object_key<>''`, workspaceID)
	if err != nil {
		return snapshot, err
	}
	expected := map[storedObjectKey]struct{}{}
	for rows.Next() {
		var item storedObjectKey
		if err := rows.Scan(&item.bucket, &item.key); err != nil {
			rows.Close()
			return snapshot, err
		}
		expected[item] = struct{}{}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return snapshot, err
	}
	prefix := "ws/" + workspaceID + "/"
	for _, bucket := range buckets {
		objects := client.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: prefix, Recursive: true})
		for object := range objects {
			if object.Err != nil {
				return snapshot, object.Err
			}
			ref := storedObjectKey{bucket: bucket, key: object.Key}
			snapshot.keys[ref] = object.Size
			snapshot.bytes += object.Size
			if _, ok := expected[ref]; !ok {
				snapshot.unknown++
			}
		}
	}
	for ref := range expected {
		if _, ok := snapshot.keys[ref]; !ok {
			snapshot.missing++
		}
	}
	if err := inventoryWorkspaceMultipart(ctx, db, client, buckets, workspaceID, prefix, &snapshot); err != nil {
		return snapshot, err
	}
	return snapshot, nil
}

func inventoryWorkspaceMultipart(ctx context.Context, db *pgxpool.Pool, client *minio.Client, buckets []string, workspaceID, prefix string, snapshot *storageWorkspaceSnapshot) error {
	type session struct{ bucket, key string }
	rows, err := db.Query(ctx, `SELECT staging_bucket,staging_key,multipart_upload_id FROM file_upload_sessions
		WHERE workspace_id=$1 AND multipart_upload_id IS NOT NULL AND object_purged_at IS NULL`, workspaceID)
	if err != nil {
		return err
	}
	known := map[string]session{}
	for rows.Next() {
		var bucket, key, uploadID string
		if err := rows.Scan(&bucket, &key, &uploadID); err != nil {
			rows.Close()
			return err
		}
		known[uploadID] = session{bucket: bucket, key: key}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	core := minio.Core{Client: client}
	for _, bucket := range buckets {
		keyMarker, uploadMarker := "", ""
		for {
			listed, err := core.ListMultipartUploads(ctx, bucket, prefix, keyMarker, uploadMarker, "", 1000)
			if err != nil {
				return err
			}
			for _, upload := range listed.Uploads {
				if upload.Err != nil {
					return upload.Err
				}
				if expected, ok := known[upload.UploadID]; !ok || expected.bucket != bucket || expected.key != upload.Key {
					snapshot.unknown++
				}
				marker := 0
				for {
					parts, err := core.ListObjectParts(ctx, bucket, upload.Key, upload.UploadID, marker, 1000)
					if err != nil {
						return err
					}
					for _, part := range parts.ObjectParts {
						snapshot.bytes += part.Size
						snapshot.parts[upload.UploadID] += part.Size
					}
					if !parts.IsTruncated {
						break
					}
					if parts.NextPartNumberMarker <= marker {
						return fmt.Errorf("multipart part listing did not advance")
					}
					marker = parts.NextPartNumberMarker
				}
			}
			if !listed.IsTruncated {
				break
			}
			if listed.NextKeyMarker == keyMarker && listed.NextUploadIDMarker == uploadMarker {
				return fmt.Errorf("multipart upload listing did not advance")
			}
			keyMarker, uploadMarker = listed.NextKeyMarker, listed.NextUploadIDMarker
		}
	}
	return nil
}

func applyWorkspaceStorageSnapshot(ctx context.Context, db *pgxpool.Pool, snapshot storageWorkspaceSnapshot, physicalLimit int64) error {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_accounts(workspace_id) VALUES($1) ON CONFLICT DO NOTHING`, snapshot.workspaceID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, snapshot.workspaceID); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT r.id,r.status,r.reservation_kind,r.physical_reserved_bytes,
		s.status,s.expected_size,s.staging_bucket,s.staging_key,s.multipart_upload_id,s.object_purged_at,
		ca.bucket,ca.object_key,ca.object_purged_at
		FROM workspace_storage_reservations r
		LEFT JOIN file_upload_sessions s ON s.id=r.upload_session_id AND s.workspace_id=r.workspace_id
		LEFT JOIN file_copy_attempts ca ON ca.storage_reservation_id=r.id
		WHERE r.workspace_id=$1 AND r.physical_reserved_bytes>0 FOR UPDATE OF r`, snapshot.workspaceID)
	if err != nil {
		return err
	}
	type reservation struct {
		id, status, kind                                   string
		physical, expected                                 int64
		sessionStatus, stagingBucket, stagingKey, uploadID *string
		sessionPurged                                      *time.Time
		copyBucket, copyKey                                *string
		copyPurged                                         *time.Time
	}
	reservations := []reservation{}
	for rows.Next() {
		var value reservation
		if err := rows.Scan(&value.id, &value.status, &value.kind, &value.physical,
			&value.sessionStatus, &value.expected, &value.stagingBucket, &value.stagingKey, &value.uploadID, &value.sessionPurged,
			&value.copyBucket, &value.copyKey, &value.copyPurged); err != nil {
			rows.Close()
			return err
		}
		reservations = append(reservations, value)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, item := range reservations {
		target := item.physical
		switch item.kind {
		case "upload":
			if item.status == "committed" || item.status == "released" && item.sessionPurged != nil || item.sessionStatus != nil && *item.sessionStatus == "completed" {
				target = 0
			} else if item.sessionStatus != nil && *item.sessionStatus == "pending" && item.expected > 0 && item.stagingBucket != nil && item.stagingKey != nil {
				staged := snapshot.keys[storedObjectKey{bucket: *item.stagingBucket, key: *item.stagingKey}]
				if item.uploadID != nil {
					staged += snapshot.parts[*item.uploadID]
				}
				peak := item.expected * 2
				target = max(int64(0), peak-staged)
			}
		case "copy":
			if item.status == "committed" || item.copyPurged != nil {
				target = 0
			} else if item.copyBucket != nil && item.copyKey != nil {
				if _, exists := snapshot.keys[storedObjectKey{bucket: *item.copyBucket, key: *item.copyKey}]; exists {
					target = 0
				}
			}
		}
		if target != item.physical {
			if _, err := tx.Exec(ctx, `UPDATE workspace_storage_reservations SET physical_reserved_bytes=$2,updated_at=NOW() WHERE id=$1`, item.id, target); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_events(workspace_id,event_type,physical_reserved_delta,reference_type,reference_id)
				VALUES($1,'storage_reconciled',$2,'storage_reservation',$3)`, snapshot.workspaceID, target-item.physical, item.id); err != nil {
				return err
			}
		}
	}
	var physicalReserved int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(SUM(physical_reserved_bytes),0) FROM workspace_storage_reservations WHERE workspace_id=$1`, snapshot.workspaceID).Scan(&physicalReserved); err != nil {
		return err
	}
	reason := ""
	switch {
	case snapshot.unknown > 0:
		reason = "orphan_objects"
	case snapshot.missing > 0:
		reason = "missing_objects"
	case physicalLimit <= 0 || snapshot.bytes+physicalReserved > physicalLimit:
		reason = "physical_limit"
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET physical_used_bytes=$2,
		physical_reserved_bytes=$3,physical_observed_bytes=$2,physical_observed_at=NOW(),
		uploads_blocked=($4<>''),blocked_reason=$4,updated_at=NOW() WHERE workspace_id=$1`,
		snapshot.workspaceID, snapshot.bytes, physicalReserved, reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func blockWorkspaceUploads(ctx context.Context, db *pgxpool.Pool, workspaceID, reason string) {
	_, _ = db.Exec(ctx, `INSERT INTO workspace_storage_accounts(workspace_id,uploads_blocked,blocked_reason)
		VALUES($1,TRUE,$2) ON CONFLICT(workspace_id) DO UPDATE SET uploads_blocked=TRUE,blocked_reason=EXCLUDED.blocked_reason,updated_at=NOW()`, workspaceID, reason)
}

func cleanupExpiredFileVersions(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client fileObjectRemover) {
	if _, err := db.Exec(ctx, `INSERT INTO file_purge_tasks(workspace_id,file_id,version_id,cause,actor_label,reason)
		SELECT v.workspace_id,v.file_id,v.id,'retention_expired','system','30_day_trash_expiry'
		FROM file_versions v JOIN files f ON f.id=v.file_id AND f.workspace_id=v.workspace_id
		WHERE v.object_purged_at IS NULL AND f.deleted_at IS NOT NULL
		AND COALESCE(f.purge_after,f.deleted_at+INTERVAL '30 days')<=NOW()
		AND NOT EXISTS(SELECT 1 FROM file_retention_holds h WHERE h.workspace_id=f.workspace_id AND h.file_id=f.id AND h.released_at IS NULL)
		ON CONFLICT(version_id) DO UPDATE SET cause='retention_expired',actor_label='system',reason='30_day_trash_expiry',
			status='pending',available_at=NOW(),lease_owner='',lease_until=NULL,last_error='',updated_at=NOW()
		WHERE file_purge_tasks.status='cancelled' AND (
			file_purge_tasks.cause='operator_requested' OR
			EXISTS(SELECT 1 FROM files f WHERE f.workspace_id=EXCLUDED.workspace_id AND f.id=EXCLUDED.file_id
				AND COALESCE(f.purge_after,f.deleted_at+INTERVAL '30 days')<=NOW())
		)`); err != nil {
		logger.Warn("enqueue expired file versions for purge", "error", err)
		return
	}
	host, _ := os.Hostname()
	owner := fmt.Sprintf("file-purge-%s-%d", host, os.Getpid())
	tasks, err := claimFilePurgeTasks(ctx, db, owner, 100)
	if err != nil {
		logger.Warn("claim file purge tasks", "error", err)
		return
	}
	for _, task := range tasks {
		if err := processFilePurgeTask(ctx, db, client, task, owner); err != nil && ctx.Err() == nil {
			logger.Warn("purge retained file version", "version_id", task.versionID, "attempt", task.attempts, "error", err)
		}
	}
}

type filePurgeTask struct {
	workspaceID, fileID, versionID string
	cause, actor, reason, caseRef  string
	attempts                       int
}

func claimFilePurgeTasks(ctx context.Context, db *pgxpool.Pool, owner string, limit int) ([]filePurgeTask, error) {
	rows, err := db.Query(ctx, `WITH candidate AS (
		SELECT version_id FROM file_purge_tasks
		WHERE (status='pending' AND available_at<=NOW()) OR (status='leased' AND lease_until<NOW())
		ORDER BY available_at,created_at,version_id FOR UPDATE SKIP LOCKED LIMIT $2
	), claimed AS (
		UPDATE file_purge_tasks t SET status='leased',attempts=t.attempts+1,lease_owner=$1,
			lease_until=NOW()+INTERVAL '10 minutes',updated_at=NOW()
		FROM candidate c WHERE t.version_id=c.version_id
		RETURNING t.workspace_id,t.file_id,t.version_id,t.cause,t.actor_label,t.reason,t.case_reference,t.attempts
	)
	SELECT workspace_id,file_id,version_id,cause,actor_label,reason,case_reference,attempts FROM claimed
	ORDER BY version_id`, owner, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tasks := []filePurgeTask{}
	for rows.Next() {
		var task filePurgeTask
		if err := rows.Scan(&task.workspaceID, &task.fileID, &task.versionID, &task.cause, &task.actor, &task.reason, &task.caseRef, &task.attempts); err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func processFilePurgeTask(ctx context.Context, db *pgxpool.Pool, client fileObjectRemover, task filePurgeTask, owner string) error {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_accounts(workspace_id) VALUES($1) ON CONFLICT DO NOTHING`, task.workspaceID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, task.workspaceID); err != nil {
		return err
	}
	var status, leaseOwner string
	if err := tx.QueryRow(ctx, `SELECT status,lease_owner FROM file_purge_tasks WHERE version_id=$1 FOR UPDATE`, task.versionID).Scan(&status, &leaseOwner); err != nil {
		return err
	}
	if status != "leased" || leaseOwner != owner {
		return tx.Commit(ctx)
	}
	var deletedAt *time.Time
	var held bool
	err = tx.QueryRow(ctx, `SELECT f.deleted_at,
		EXISTS(SELECT 1 FROM file_retention_holds h WHERE h.workspace_id=f.workspace_id AND h.file_id=f.id AND h.released_at IS NULL)
		FROM files f WHERE f.workspace_id=$1 AND f.id=$2 FOR UPDATE`, task.workspaceID, task.fileID).Scan(&deletedAt, &held)
	if err != nil {
		return err
	}
	if held {
		if _, err := tx.Exec(ctx, `UPDATE file_purge_tasks SET status='cancelled',lease_owner='',lease_until=NULL,
			last_error='cancelled_by_retention_hold',updated_at=NOW() WHERE version_id=$1`, task.versionID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if deletedAt == nil {
		if _, err := tx.Exec(ctx, `UPDATE file_purge_tasks SET status='cancelled',lease_owner='',lease_until=NULL,
			last_error='file_restored',updated_at=NOW() WHERE version_id=$1`, task.versionID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	var bucket, key string
	var size int64
	var charged, alreadyPurged bool
	err = tx.QueryRow(ctx, `SELECT bucket,object_key,size_bytes,quota_charged,object_purged_at IS NOT NULL
		FROM file_versions WHERE workspace_id=$1 AND file_id=$2 AND id=$3 FOR UPDATE`, task.workspaceID, task.fileID, task.versionID).
		Scan(&bucket, &key, &size, &charged, &alreadyPurged)
	if err != nil {
		return err
	}
	if alreadyPurged {
		if _, err := tx.Exec(ctx, `UPDATE file_purge_tasks SET status='completed',lease_owner='',lease_until=NULL,
			completed_at=COALESCE(completed_at,NOW()),updated_at=NOW() WHERE version_id=$1`, task.versionID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if task.cause == "retention_expired" {
		var expired bool
		if err := tx.QueryRow(ctx, `SELECT COALESCE(purge_after,deleted_at+INTERVAL '30 days')<=NOW()
			FROM files WHERE workspace_id=$1 AND id=$2`, task.workspaceID, task.fileID).Scan(&expired); err != nil {
			return err
		}
		if !expired {
			if _, err := tx.Exec(ctx, `UPDATE file_purge_tasks SET status='cancelled',lease_owner='',lease_until=NULL,
				last_error='retention_deadline_not_reached',updated_at=NOW() WHERE version_id=$1`, task.versionID); err != nil {
				return err
			}
			return tx.Commit(ctx)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE file_versions SET object_cleanup_attempted_at=NOW() WHERE id=$1`, task.versionID); err != nil {
		return err
	}
	if err := client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{}); err != nil {
		wait := nextRetry(task.attempts)
		if _, updateErr := tx.Exec(ctx, `UPDATE file_purge_tasks SET status='pending',available_at=NOW()+make_interval(secs=>$2),
			lease_owner='',lease_until=NULL,last_error=$3,updated_at=NOW() WHERE version_id=$1`, task.versionID, wait.Seconds(), trimPurgeError(err.Error())); updateErr != nil {
			return updateErr
		}
		if _, updateErr := tx.Exec(ctx, `INSERT INTO workspace_storage_events(workspace_id,actor_label,event_type,reference_type,reference_id,details)
			VALUES($1,$2,'file_content_purge_retry_scheduled','file_version',$3,jsonb_build_object('attempt',$4::int,'delay_seconds',$5::bigint))`,
			task.workspaceID, purgeActor(task.actor), task.versionID, task.attempts, int64(wait.Seconds())); updateErr != nil {
			return updateErr
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE file_versions SET object_purged_at=NOW(),quota_charged=FALSE WHERE id=$1 AND object_purged_at IS NULL`, task.versionID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET physical_used_bytes=GREATEST(0,physical_used_bytes-$2),
		quota_used_bytes=GREATEST(0,quota_used_bytes-CASE WHEN $3 THEN $4::bigint ELSE 0::bigint END),updated_at=NOW() WHERE workspace_id=$1`,
		task.workspaceID, size, charged, size); err != nil {
		return err
	}
	eventType := "file_content_purged_after_retention"
	if task.cause == "operator_requested" {
		eventType = "file_content_purged_by_operator"
	}
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_events(workspace_id,actor_label,event_type,physical_used_delta,
		reference_type,reference_id,details)
		VALUES($1,$2,$3,-$4::bigint,'file_version',$5,jsonb_build_object('reason',$6::text,'case_reference',$7::text,'attempt',$8::int))`,
		task.workspaceID, purgeActor(task.actor), eventType, size, task.versionID, task.reason, task.caseRef, task.attempts); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE files f SET object_purged_at=NOW() WHERE f.id=$1
		AND NOT EXISTS(SELECT 1 FROM file_versions v WHERE v.file_id=f.id AND v.object_purged_at IS NULL)`, task.fileID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE file_purge_tasks SET status='completed',lease_owner='',lease_until=NULL,
		last_error='',completed_at=NOW(),updated_at=NOW() WHERE version_id=$1`, task.versionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func purgeActor(actor string) string {
	if actor == "" {
		return "system:file-retention-worker"
	}
	return actor
}

func trimPurgeError(value string) string {
	const max = 1000
	if len(value) > max {
		return value[:max]
	}
	return value
}

func purgeStoredVersion(ctx context.Context, db *pgxpool.Pool, client fileObjectRemover, workspaceID, versionID, eventType string) error {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_accounts(workspace_id) VALUES($1) ON CONFLICT DO NOTHING`, workspaceID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID); err != nil {
		return err
	}
	var bucket, key string
	var size int64
	var charged bool
	if eventType == "quarantine_expired" {
		err = tx.QueryRow(ctx, `SELECT bucket,object_key,size_bytes,quota_charged FROM file_versions
			WHERE id=$1 AND workspace_id=$2 AND security_status IN ('infected','unsupported') AND quarantine_until<=NOW()
			AND object_purged_at IS NULL AND NOT EXISTS(
				SELECT 1 FROM file_retention_holds h WHERE h.workspace_id=file_versions.workspace_id
				AND h.file_id=file_versions.file_id AND h.released_at IS NULL
			) FOR UPDATE`, versionID, workspaceID).Scan(&bucket, &key, &size, &charged)
	} else {
		err = tx.QueryRow(ctx, `SELECT v.bucket,v.object_key,v.size_bytes,v.quota_charged FROM file_versions v
			JOIN files f ON f.id=v.file_id AND f.workspace_id=v.workspace_id
			WHERE v.id=$1 AND v.workspace_id=$2 AND v.object_purged_at IS NULL
			AND f.deleted_at IS NOT NULL AND COALESCE(f.purge_after,f.deleted_at+INTERVAL '30 days')<=NOW()
			AND NOT EXISTS(SELECT 1 FROM file_retention_holds h WHERE h.workspace_id=f.workspace_id AND h.file_id=f.id AND h.released_at IS NULL)
			FOR UPDATE OF v,f`, versionID, workspaceID).Scan(&bucket, &key, &size, &charged)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tx.Commit(ctx)
		}
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE file_versions SET object_cleanup_attempted_at=NOW() WHERE id=$1`, versionID); err != nil {
		return err
	}
	if err := client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{}); err != nil {
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return commitErr
		}
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE file_versions SET object_purged_at=NOW(),quota_charged=FALSE WHERE id=$1 AND object_purged_at IS NULL`, versionID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET physical_used_bytes=GREATEST(0,physical_used_bytes-$2),
		quota_used_bytes=GREATEST(0,quota_used_bytes-CASE WHEN $3 THEN $4 ELSE 0 END),updated_at=NOW() WHERE workspace_id=$1`, workspaceID, size, charged, size); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_events(workspace_id,event_type,quota_used_delta,physical_used_delta,reference_type,reference_id)
		VALUES($1,$2,$3,-$4,'file_version',$5)`, workspaceID, eventType, quotaDelta(charged, size), size, versionID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE files f SET object_purged_at=NOW() WHERE f.id=(SELECT file_id FROM file_versions WHERE id=$1)
		AND NOT EXISTS(SELECT 1 FROM file_versions v WHERE v.file_id=f.id AND v.object_purged_at IS NULL)`, versionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func quotaDelta(charged bool, size int64) int64 {
	if charged {
		return -size
	}
	return 0
}

func purgeQuarantinedVersionsWithAccounting(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client fileObjectRemover) {
	rows, err := db.Query(ctx, `SELECT id,workspace_id FROM file_versions WHERE security_status IN ('infected','unsupported')
		AND quarantine_until<=NOW() AND object_purged_at IS NULL ORDER BY quarantine_until,id LIMIT 100`)
	if err != nil {
		logger.Warn("list expired quarantined versions", "error", err)
		return
	}
	type candidate struct{ id, workspaceID string }
	items := []candidate{}
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.id, &item.workspaceID); err != nil {
			rows.Close()
			logger.Warn("scan quarantined version", "error", err)
			return
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		logger.Warn("read quarantined versions", "error", err)
		return
	}
	for _, item := range items {
		if err := purgeStoredVersion(ctx, db, client, item.workspaceID, item.id, "quarantine_expired"); err != nil && ctx.Err() == nil {
			logger.Warn("purge expired quarantined content", "version_id", item.id, "error", err)
		}
	}
}

func storageReconcileTicker(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client *minio.Client, buckets []string, physicalLimit int64, interval time.Duration) {
	if client == nil || len(buckets) == 0 || physicalLimit <= 0 {
		logger.Warn("storage reconciliation disabled: object storage bucket or physical limit missing")
		return
	}
	reconcile := func() {
		if err := validateWorkerStorageBuckets(ctx, client, buckets); err != nil {
			logger.Error("skip storage reconciliation because bucket versioning or scope is unsafe", "error", err)
			return
		}
		reconcileWorkspaceStorage(ctx, logger, db, client, buckets, physicalLimit)
	}
	reconcile()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			reconcile()
		}
	}
}
