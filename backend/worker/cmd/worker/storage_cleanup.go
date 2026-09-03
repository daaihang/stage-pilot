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

// cleanupFiles removes abandoned presigned uploads and old soft-deleted objects.
// It is deliberately best-effort: database state remains authoritative if S3 is unavailable.
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
	bucket := envOrDefault("S3_BUCKET", "stagepilot")
	rows, err := db.Query(ctx, `SELECT id, object_key, status FROM files WHERE deleted_at IS NULL AND ((status='pending' AND created_at < NOW()-INTERVAL '24 hours') OR (status='abandoned' AND created_at < NOW()-INTERVAL '24 hours')) LIMIT 100`)
	if err != nil {
		logger.Warn("list stale files", "error", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, key, status string
		if err := rows.Scan(&id, &key, &status); err != nil {
			continue
		}
		if err := client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{}); err != nil {
			logger.Warn("remove stale object", "file_id", id, "error", err)
			continue
		}
		if _, err := db.Exec(ctx, "UPDATE files SET status='abandoned', updated_at=NOW() WHERE id=$1 AND status=$2", id, status); err != nil {
			logger.Warn("mark stale file", "file_id", id, "error", err)
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
