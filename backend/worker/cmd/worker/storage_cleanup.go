package main

import (
	"context"
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
