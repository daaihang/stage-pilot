package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type replicaTask struct {
	ID                                                                   int64
	AssetType, AssetID, SourceBucket, SourceKey, TargetBucket, TargetKey string
	ExpectedSize                                                         int64
	ExpectedSHA256                                                       string
	Status                                                               string
	Attempts                                                             int
}

func newReplicaStorageClient() (*minio.Client, string, error) {
	endpoint := strings.TrimPrefix(strings.TrimPrefix(os.Getenv("S3_REPLICA_ENDPOINT"), "http://"), "https://")
	bucket := strings.TrimSpace(os.Getenv("S3_REPLICA_BUCKET"))
	if endpoint == "" || bucket == "" {
		return nil, bucket, errors.New("S3_REPLICA_ENDPOINT and S3_REPLICA_BUCKET are required")
	}
	client, err := minio.New(endpoint, &minio.Options{Creds: credentials.NewStaticV4(os.Getenv("S3_REPLICA_ACCESS_KEY"), os.Getenv("S3_REPLICA_SECRET_KEY"), ""), Secure: os.Getenv("S3_REPLICA_USE_SSL") == "true", Region: envOrDefault("S3_REPLICA_REGION", "us-east-1"), BucketLookup: minio.BucketLookupPath})
	return client, bucket, err
}

func enqueueFileReplications(ctx context.Context, db *pgxpool.Pool, targetBucket, sourceBucket string) error {
	if targetBucket == "" || sourceBucket == "" {
		return errors.New("replication buckets are not configured")
	}
	if _, err := db.Exec(ctx, `INSERT INTO file_replication_tasks(asset_type,workspace_id,asset_id,source_bucket,source_key,target_bucket,target_key,expected_size,expected_sha256)
		SELECT 'file_version',v.workspace_id,v.id,v.bucket,v.object_key,$1,v.object_key,v.size_bytes,v.sha256
		FROM file_versions v WHERE v.object_purged_at IS NULL AND v.bucket=$2
		ON CONFLICT(asset_type,asset_id) DO NOTHING`, targetBucket, sourceBucket); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `UPDATE file_replication_tasks SET target_bucket=$1,updated_at=NOW()
		WHERE asset_type='avatar' AND target_bucket='' AND source_bucket=$2`, targetBucket, sourceBucket); err != nil {
		return err
	}
	_, err := db.Exec(ctx, `INSERT INTO file_replication_tasks(asset_type,asset_id,source_bucket,source_key,target_bucket,target_key,expected_size,expected_sha256)
		SELECT 'avatar',u.avatar_object_key,$2,u.avatar_object_key,$1,u.avatar_object_key,u.avatar_size_bytes,u.avatar_sha256
		FROM users u
		WHERE COALESCE(u.avatar_object_key,'')<>''
		ON CONFLICT(asset_type,asset_id) DO NOTHING`, targetBucket, sourceBucket)
	return err
}

func claimReplicaTasks(ctx context.Context, db *pgxpool.Pool, owner string, limit int) ([]replicaTask, error) {
	rows, err := db.Query(ctx, `WITH selected AS (
		SELECT id FROM file_replication_tasks
		WHERE (status='pending' AND available_at<=NOW()) OR (status='leased' AND lease_until<NOW())
		ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $2
	), claimed AS (
		UPDATE file_replication_tasks t SET status='leased',attempts=t.attempts+1,lease_owner=$1,lease_until=NOW()+INTERVAL '30 minutes',updated_at=NOW()
		FROM selected s WHERE t.id=s.id
		RETURNING t.id,t.asset_type,t.asset_id,t.source_bucket,t.source_key,t.target_bucket,t.target_key,t.expected_size,t.expected_sha256,t.status,t.attempts
	) SELECT * FROM claimed`, owner, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tasks := []replicaTask{}
	for rows.Next() {
		var t replicaTask
		if err := rows.Scan(&t.ID, &t.AssetType, &t.AssetID, &t.SourceBucket, &t.SourceKey, &t.TargetBucket, &t.TargetKey, &t.ExpectedSize, &t.ExpectedSHA256, &t.Status, &t.Attempts); err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

func sha256Reader(reader io.Reader) (string, int64, error) {
	h := sha256.New()
	n, err := io.Copy(h, reader)
	if err != nil {
		return "", n, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func streamHash(reader io.Reader) (hash.Hash, io.Reader) {
	h := sha256.New()
	return h, io.TeeReader(reader, h)
}

func processReplicaTask(ctx context.Context, db *pgxpool.Pool, source, destination *minio.Client, task replicaTask, owner string) error {
	workCtx, cancel := context.WithTimeout(ctx, 45*time.Minute)
	defer cancel()
	info, err := source.StatObject(workCtx, task.SourceBucket, task.SourceKey, minio.StatObjectOptions{})
	if err != nil {
		return retryReplicaTask(ctx, db, task, owner, err)
	}
	if task.ExpectedSize == 0 {
		task.ExpectedSize = info.Size
		if _, err := db.Exec(ctx, `UPDATE file_replication_tasks SET expected_size=$2,updated_at=NOW() WHERE id=$1 AND status='leased' AND lease_owner=$3`, task.ID, info.Size, owner); err != nil {
			return err
		}
	}
	if info.Size != task.ExpectedSize {
		return needsAttentionReplicaTask(ctx, db, task, owner, "source_size_mismatch")
	}
	object, err := source.GetObject(workCtx, task.SourceBucket, task.SourceKey, minio.GetObjectOptions{})
	if err != nil {
		return retryReplicaTask(ctx, db, task, owner, err)
	}
	hasher, stream := streamHash(object)
	_, putErr := destination.PutObject(workCtx, task.TargetBucket, task.TargetKey, stream, task.ExpectedSize, minio.PutObjectOptions{ContentType: info.ContentType})
	closeErr := object.Close()
	if putErr != nil {
		return retryReplicaTask(ctx, db, task, owner, putErr)
	}
	if closeErr != nil {
		return retryReplicaTask(ctx, db, task, owner, closeErr)
	}
	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if task.ExpectedSHA256 != "" && actualHash != task.ExpectedSHA256 {
		return needsAttentionReplicaTask(ctx, db, task, owner, "source_sha256_mismatch")
	}
	verified, err := destination.GetObject(workCtx, task.TargetBucket, task.TargetKey, minio.GetObjectOptions{})
	if err != nil {
		return retryReplicaTask(ctx, db, task, owner, err)
	}
	verifiedInfo, err := verified.Stat()
	if err != nil {
		verified.Close()
		return retryReplicaTask(ctx, db, task, owner, err)
	}
	if verifiedInfo.Size != task.ExpectedSize {
		verified.Close()
		return needsAttentionReplicaTask(ctx, db, task, owner, "replica_size_mismatch")
	}
	verifiedHash, verifiedBytes, err := sha256Reader(verified)
	closeErr = verified.Close()
	if err != nil {
		return retryReplicaTask(ctx, db, task, owner, err)
	}
	if closeErr != nil {
		return retryReplicaTask(ctx, db, task, owner, closeErr)
	}
	if verifiedBytes != task.ExpectedSize || verifiedHash != actualHash {
		return needsAttentionReplicaTask(ctx, db, task, owner, "replica_sha256_mismatch")
	}
	_, err = db.Exec(ctx, `UPDATE file_replication_tasks SET status='replicated',expected_sha256=$2,replicated_at=NOW(),lease_owner='',lease_until=NULL,last_error='',updated_at=NOW()
		WHERE id=$1 AND status='leased' AND lease_owner=$3`, task.ID, actualHash, owner)
	return err
}

func retryReplicaTask(ctx context.Context, db *pgxpool.Pool, task replicaTask, owner string, cause error) error {
	wait := nextRetry(task.Attempts)
	_, err := db.Exec(ctx, `UPDATE file_replication_tasks SET status='pending',available_at=NOW()+make_interval(secs=>$1),lease_owner='',lease_until=NULL,last_error=$2,updated_at=NOW()
		WHERE id=$3 AND status='leased' AND lease_owner=$4`, wait.Seconds(), trimPurgeError(cause.Error()), task.ID, owner)
	return err
}
func needsAttentionReplicaTask(ctx context.Context, db *pgxpool.Pool, task replicaTask, owner, code string) error {
	_, err := db.Exec(ctx, `UPDATE file_replication_tasks SET status='needs_attention',lease_owner='',lease_until=NULL,last_error=$1,updated_at=NOW() WHERE id=$2 AND status='leased' AND lease_owner=$3`, code, task.ID, owner)
	return err
}

func replicationWatermark(ctx context.Context, db *pgxpool.Pool) error {
	_, err := db.Exec(ctx, `UPDATE file_replication_watermarks SET contiguous_through=NOW(),updated_at=NOW(),details='{}'::jsonb WHERE id=1
		AND NOT EXISTS(SELECT 1 FROM file_replication_tasks WHERE status NOT IN ('replicated','purge_pending','purged'))
		AND NOT EXISTS(SELECT 1 FROM file_versions v LEFT JOIN file_replication_tasks t ON t.asset_type='file_version' AND t.asset_id=v.id
			WHERE v.object_purged_at IS NULL AND v.bucket=$1 AND t.id IS NULL)
		AND NOT EXISTS(SELECT 1 FROM users u LEFT JOIN file_replication_tasks t ON t.asset_type='avatar' AND t.asset_id=u.avatar_object_key
			WHERE COALESCE(u.avatar_object_key,'')<>'' AND t.id IS NULL)`, envOrDefault("S3_BUCKET", "stagepilot"))
	return err
}

func purgeReplicas(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, source, destination *minio.Client, sourceBucket string) {
	if _, err := db.Exec(ctx, `UPDATE file_replication_tasks t SET status='purge_pending',source_purged_at=NOW(),replica_purge_after=NOW()+INTERVAL '30 days',lease_owner='',lease_until=NULL,updated_at=NOW()
		WHERE t.status='replicated' AND t.asset_type='file_version' AND EXISTS(SELECT 1 FROM file_versions v WHERE v.id=t.asset_id AND v.object_purged_at IS NOT NULL)`); err != nil {
		logger.Warn("queue retained replica expiry", "error", err)
	}
	if _, err := db.Exec(ctx, `UPDATE file_replication_tasks t SET status='purge_pending',source_purged_at=NOW(),replica_purge_after=NOW()+INTERVAL '30 days',lease_owner='',lease_until=NULL,updated_at=NOW()
		WHERE t.status='replicated' AND t.asset_type='avatar' AND NOT EXISTS(SELECT 1 FROM users u WHERE u.avatar_object_key=t.asset_id)`); err != nil {
		logger.Warn("queue obsolete avatar replication expiry", "error", err)
	}
	rows, err := db.Query(ctx, `SELECT id,target_bucket,target_key,source_bucket,source_key FROM file_replication_tasks WHERE status='purge_pending' AND replica_purge_after<=NOW() ORDER BY id LIMIT 100`)
	if err != nil {
		logger.Warn("list expired replica objects", "error", err)
		return
	}
	type expired struct {
		id                                               int64
		targetBucket, targetKey, sourceBucket, sourceKey string
	}
	items := []expired{}
	for rows.Next() {
		var item expired
		if err := rows.Scan(&item.id, &item.targetBucket, &item.targetKey, &item.sourceBucket, &item.sourceKey); err != nil {
			rows.Close()
			logger.Warn("read expired replica", "error", err)
			return
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		logger.Warn("read expired replicas", "error", err)
		return
	}
	for _, item := range items {
		if err := destination.RemoveObject(ctx, item.targetBucket, item.targetKey, minio.RemoveObjectOptions{}); err != nil {
			logger.Warn("delete expired replica", "task_id", item.id, "error", err)
			continue
		}
		if item.sourceBucket != "" {
			if err := source.RemoveObject(ctx, item.sourceBucket, item.sourceKey, minio.RemoveObjectOptions{}); err != nil {
				logger.Warn("delete source object after replica retention", "task_id", item.id, "error", err)
				continue
			}
		}
		if _, err := db.Exec(ctx, `UPDATE file_replication_tasks SET status='purged',source_purged_at=COALESCE(source_purged_at,NOW()),replica_purged_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='purge_pending'`, item.id); err != nil {
			logger.Warn("record replica purge", "task_id", item.id, "error", err)
		}
	}
}

func fileReplicationTicker(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, source *minio.Client, sourceBucket string, interval time.Duration) {
	replica, targetBucket, err := newReplicaStorageClient()
	if err != nil {
		logger.Warn("secondary object storage is not configured; disaster replication is disabled", "error", err)
		return
	}
	if err := replica.MakeBucket(ctx, targetBucket, minio.MakeBucketOptions{Region: envOrDefault("S3_REPLICA_REGION", "us-east-1")}); err != nil && minio.ToErrorResponse(err).Code != "BucketAlreadyOwnedByYou" {
		logger.Error("ensure secondary bucket", "error", err)
		return
	}
	config, err := replica.GetBucketVersioning(ctx, targetBucket)
	if err != nil || config.Status != "" {
		logger.Error("secondary bucket must exist with versioning disabled", "bucket", targetBucket, "error", err)
		return
	}
	process := func() {
		if err := enqueueFileReplications(ctx, db, targetBucket, sourceBucket); err != nil {
			logger.Warn("enqueue immutable object replication", "error", err)
			return
		}
		host, _ := os.Hostname()
		owner := fmt.Sprintf("replica-%s-%d", host, os.Getpid())
		tasks, err := claimReplicaTasks(ctx, db, owner, 100)
		if err != nil {
			logger.Warn("claim replica tasks", "error", err)
			return
		}
		for _, task := range tasks {
			if err := processReplicaTask(ctx, db, source, replica, task, owner); err != nil && ctx.Err() == nil {
				logger.Warn("replicate immutable object", "asset_type", task.AssetType, "asset_id", task.AssetID, "error", err)
			}
		}
		purgeReplicas(ctx, logger, db, source, replica, sourceBucket)
		if err := replicationWatermark(ctx, db); err != nil {
			logger.Warn("advance replication watermark", "error", err)
		}
	}
	process()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			process()
		}
	}
}

func requireReplicatedBeforePurge(ctx context.Context, db *pgxpool.Pool, versionID string) error {
	if os.Getenv("S3_REPLICA_REQUIRED") != "true" {
		return nil
	}
	var status string
	err := db.QueryRow(ctx, `SELECT status FROM file_replication_tasks WHERE asset_type='file_version' AND asset_id=$1`, versionID).Scan(&status)
	if err != nil {
		return fmt.Errorf("file version is not backed up to secondary storage: %w", err)
	}
	if status != "replicated" {
		return fmt.Errorf("file version replica is not ready (status %s)", status)
	}
	return nil
}
