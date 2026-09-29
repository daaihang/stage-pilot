package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if len(os.Args) > 1 && os.Args[1] == "scanner-check" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		version, err := checkClamAVScanner(ctx, newClamAVScanner(os.Getenv("CLAMD_ADDRESS"), 20*time.Second))
		if err != nil {
			logger.Error("ClamAV smoke test failed", "error", err)
			os.Exit(1)
		}
		logger.Info("ClamAV PING/PONG and clean/infected scans succeeded", "version", version)
		return
	}
	databaseURL := envOrDefault("DATABASE_URL", "postgres://stagepilot:stagepilot@localhost:15432/stagepilot?sslmode=disable")
	interval := durationOrDefault("WORKER_INTERVAL", 30*time.Second)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		logger.Error("create database pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	storage, storageErr := newWorkerStorageClient()
	if storageErr != nil {
		logger.Warn("file scanning storage unavailable; scan tasks will remain queued", "error", storageErr)
	}
	scanner := newClamAVScanner(os.Getenv("CLAMD_ADDRESS"), durationOrDefault("CLAMD_TIMEOUT", 15*time.Minute))
	physicalLimit := int64(0)
	if value, parseErr := strconv.ParseInt(os.Getenv("FILES_WORKSPACE_PHYSICAL_MAX_BYTES"), 10, 64); parseErr == nil && value > 0 {
		physicalLimit = value
	}
	bucket := envOrDefault("S3_BUCKET", "stagepilot")
	stagingBucket := envOrDefault("S3_STAGING_BUCKET", bucket+"-staging")
	storageBuckets := []string{bucket}
	if stagingBucket != bucket {
		storageBuckets = append(storageBuckets, stagingBucket)
	}
	storageRetentionReady := false
	if storage != nil {
		for _, name := range storageBuckets {
			if err := storage.MakeBucket(ctx, name, minio.MakeBucketOptions{Region: envOrDefault("S3_REGION", "us-east-1")}); err != nil && minio.ToErrorResponse(err).Code != "BucketAlreadyOwnedByYou" {
				logger.Error("ensure file storage bucket", "bucket", name, "error", err)
			}
		}
		if err := validateWorkerStorageBuckets(ctx, storage, storageBuckets); err != nil {
			logger.Error("file object cleanup and storage reconciliation disabled", "error", err)
		} else {
			storageRetentionReady = true
		}
	}

	logger.Info("worker started", "interval", interval)
	if storageRetentionReady {
		go cleanupTicker(ctx, logger, pool, interval)
		go storageReconcileTicker(ctx, logger, pool, storage, storageBuckets, physicalLimit, durationOrDefault("STORAGE_RECONCILE_INTERVAL", 6*time.Hour))
		go storageReconcileRequestTicker(ctx, logger, pool, storage, storageBuckets, physicalLimit, interval)
		go fileReplicationTicker(ctx, logger, pool, storage, bucket, durationOrDefault("FILE_REPLICATION_INTERVAL", interval))
	} else {
		logger.Error("file cleanup and reconciliation remain disabled until the formal and staging buckets are distinct and both have versioning disabled")
	}
	go fileScanTicker(ctx, logger, pool, storage, scanner, interval, maxFileBytesFromEnv())
	run(ctx, logger, pool, interval)
	logger.Info("worker stopped")
}

func validateWorkerBucketVersioningDisabled(bucket string, config minio.BucketVersioningConfiguration) error {
	if config.Status != "" {
		return fmt.Errorf("object bucket %q must have versioning disabled (status %q)", bucket, config.Status)
	}
	return nil
}

func validateWorkerStorageBuckets(ctx context.Context, client *minio.Client, buckets []string) error {
	if client == nil || len(buckets) != 2 || buckets[0] == "" || buckets[1] == "" || buckets[0] == buckets[1] {
		return fmt.Errorf("formal and staging buckets must both exist and be distinct")
	}
	for _, bucket := range buckets {
		config, err := client.GetBucketVersioning(ctx, bucket)
		if err != nil {
			return fmt.Errorf("check bucket %q versioning: %w", bucket, err)
		}
		if err := validateWorkerBucketVersioningDisabled(bucket, config); err != nil {
			return err
		}
	}
	return nil
}

func fileScanTicker(ctx context.Context, logger *slog.Logger, db *pgxpool.Pool, storage *minio.Client, scanner fileScanner, interval time.Duration, maxBytes int64) {
	if storage == nil {
		return
	}
	process := func() {
		probeContext, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := scanner.Ping(probeContext)
		cancel()
		if err != nil {
			logger.Warn("ClamAV scanner unavailable; scan tasks will retry", "error", err)
			return
		}
		processFileScanQueue(ctx, logger, db, storage, scanner, maxBytes)
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

func run(ctx context.Context, logger *slog.Logger, pool *pgxpool.Pool, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		pingContext, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := pool.Ping(pingContext)
		cancel()
		if err != nil {
			logger.Warn("database heartbeat failed", "error", err)
		} else {
			logger.Info("database heartbeat ok")
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func durationOrDefault(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
