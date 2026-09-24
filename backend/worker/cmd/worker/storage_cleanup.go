package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type fileObjectRemover interface {
	RemoveObject(context.Context, string, string, minio.RemoveObjectOptions) error
}

// cleanupFiles only reclaims unfinished uploads. Soft-deleted uploaded files
// retain their object until a separate retention policy is established.
func cleanupFiles(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool) {
	endpoint := strings.TrimPrefix(strings.TrimPrefix(os.Getenv("S3_ENDPOINT"), "http://"), "https://")
	if endpoint == "" {
		return
	}
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(os.Getenv("S3_ACCESS_KEY"), os.Getenv("S3_SECRET_KEY"), ""),
		Secure: os.Getenv("S3_USE_SSL") == "true", Region: envOrDefault("S3_REGION", "us-east-1"),
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		logger.Warn("create object storage cleanup client", "error", err)
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
}

func cleanupUploadSessionsWithClient(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client fileObjectRemover, staleAfter time.Duration) {
	_, err := db.Exec(ctx, `WITH stale AS (
		SELECT id FROM file_upload_sessions WHERE status='pending' AND created_at < $1
		ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
	) UPDATE file_upload_sessions s SET status='abandoned' FROM stale WHERE s.id=stale.id`, time.Now().Add(-staleAfter))
	if err != nil {
		logger.Warn("claim expired file upload sessions", "error", err)
		return
	}
	rows, err := db.Query(ctx, `SELECT id,staging_bucket,staging_key FROM file_upload_sessions
		WHERE object_purged_at IS NULL AND (status='abandoned' OR (status='completed' AND created_at < $1 AND expires_at < NOW()-INTERVAL '1 hour'))
		ORDER BY object_cleanup_attempted_at NULLS FIRST,created_at,id LIMIT 100`, time.Now().Add(-staleAfter))
	if err != nil {
		logger.Warn("list expired file upload sessions", "error", err)
		return
	}
	type upload struct{ id, bucket, key string }
	items := []upload{}
	for rows.Next() {
		var item upload
		if err := rows.Scan(&item.id, &item.bucket, &item.key); err != nil {
			rows.Close()
			logger.Warn("scan upload session", "error", err)
			return
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		logger.Warn("read upload sessions", "error", err)
		return
	}
	for _, item := range items {
		if _, err := db.Exec(ctx, `UPDATE file_upload_sessions SET object_cleanup_attempted_at=NOW() WHERE id=$1 AND status IN ('abandoned','completed') AND object_purged_at IS NULL`, item.id); err != nil {
			logger.Warn("mark upload cleanup attempt", "error", err)
			continue
		}
		if err := client.RemoveObject(ctx, item.bucket, item.key, minio.RemoveObjectOptions{}); err != nil {
			logger.Warn("remove abandoned staging object", "upload_id", item.id, "error", err)
			continue
		}
		if _, err := db.Exec(ctx, `UPDATE file_upload_sessions SET object_purged_at=NOW() WHERE id=$1 AND status IN ('abandoned','completed')`, item.id); err != nil {
			logger.Warn("mark staging object purged", "error", err)
		}
	}
}

func cleanupCopyAttemptsWithClient(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client fileObjectRemover, staleAfter time.Duration) {
	rows, err := db.Query(ctx, `SELECT id,bucket,object_key FROM file_copy_attempts
		WHERE status='pending' AND object_purged_at IS NULL AND created_at < $1
		ORDER BY object_cleanup_attempted_at NULLS FIRST,created_at,id LIMIT 100`, time.Now().Add(-staleAfter))
	if err != nil {
		logger.Warn("list uncommitted file copies", "error", err)
		return
	}
	type copyAttempt struct{ id, bucket, key string }
	items := []copyAttempt{}
	for rows.Next() {
		var item copyAttempt
		if err := rows.Scan(&item.id, &item.bucket, &item.key); err != nil {
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
		// Keep the row lock until the object removal finishes. A publishing
		// transaction must not mark this copy committed while cleanup deletes it.
		tag, err := tx.Exec(ctx, `UPDATE file_copy_attempts SET object_cleanup_attempted_at=NOW()
			WHERE id=$1 AND status='pending' AND object_purged_at IS NULL`, item.id)
		if err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("mark copy cleanup attempt", "error", err)
			continue
		}
		if tag.RowsAffected() != 1 {
			_ = tx.Rollback(ctx)
			continue
		}
		if err := client.RemoveObject(ctx, item.bucket, item.key, minio.RemoveObjectOptions{}); err != nil {
			_ = tx.Commit(ctx)
			logger.Warn("remove uncommitted file copy", "copy_id", item.id, "error", err)
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE file_copy_attempts SET object_purged_at=NOW() WHERE id=$1`, item.id); err != nil {
			_ = tx.Rollback(ctx)
			logger.Warn("mark uncommitted copy purged", "error", err)
			continue
		}
		if err := tx.Commit(ctx); err != nil {
			logger.Warn("commit uncommitted copy cleanup", "error", err)
		}
	}
}

func freezeLegacyFileVersions(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client *minio.Client, minAge time.Duration) {
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
		attemptID := fmt.Sprintf("freeze-%d-%s", time.Now().UnixNano(), item.id)
		key := "ws/" + item.workspace + "/versions/" + attemptID
		if _, err := db.Exec(ctx, `INSERT INTO file_copy_attempts(id,workspace_id,bucket,object_key) VALUES($1,$2,$3,$4)`, attemptID, item.workspace, item.bucket, key); err != nil {
			logger.Warn("record legacy freeze attempt", "error", err)
			continue
		}
		stat, err := client.StatObject(ctx, item.bucket, item.key, minio.StatObjectOptions{})
		if err != nil || stat.Size != item.size {
			logger.Warn("stat legacy version", "version_id", item.id, "error", err)
			continue
		}
		src := minio.CopySrcOptions{Bucket: item.bucket, Object: item.key, MatchETag: strings.Trim(stat.ETag, `"`)}
		dst := minio.CopyDestOptions{Bucket: item.bucket, Object: key}
		if item.size <= 5_000_000_000 {
			_, err = client.CopyObject(ctx, dst, src)
		} else {
			parts := []minio.CopySrcOptions{}
			for start := int64(0); start < item.size; start += 1 << 30 {
				end := start + (1 << 30) - 1
				if end >= item.size {
					end = item.size - 1
				}
				part := src
				part.MatchRange, part.Start, part.End = true, start, end
				parts = append(parts, part)
			}
			_, err = client.ComposeObject(ctx, dst, parts...)
		}
		if err != nil {
			logger.Warn("copy legacy version", "version_id", item.id, "error", err)
			continue
		}
		copied, e := client.StatObject(ctx, item.bucket, key, minio.StatObjectOptions{})
		if e != nil || copied.Size != item.size {
			logger.Warn("verify legacy version copy", "version_id", item.id, "error", e)
			continue
		}
		copiedETag := strings.Trim(copied.ETag, `"`)
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
			_ = client.RemoveObject(ctx, item.bucket, key, minio.RemoveObjectOptions{})
		}
	}
}

func cleanupFilesWithClient(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, client fileObjectRemover, staleAfter time.Duration) {
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
		if err := client.RemoveObject(ctx, file.bucket, file.key, minio.RemoveObjectOptions{}); err != nil {
			logger.Warn("remove abandoned object", "file_id", file.id, "error", err)
			continue
		}
		if _, err := db.Exec(ctx, `UPDATE files SET object_purged_at=NOW(),updated_at=NOW()
			WHERE id=$1 AND status='abandoned' AND object_purged_at IS NULL`, file.id); err != nil {
			logger.Warn("record abandoned object cleanup", "file_id", file.id, "error", err)
		}
	}
}

func cleanupTicker(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, interval time.Duration) {
	cleanupFiles(ctx, logger, db)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cleanupFiles(ctx, logger, db)
		}
	}
}
