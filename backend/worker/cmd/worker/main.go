package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
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

	logger.Info("worker started", "interval", interval)
	go cleanupTicker(ctx, logger, pool, interval)
	go fileScanTicker(ctx, logger, pool, storage, scanner, interval, maxFileBytesFromEnv())
	run(ctx, logger, pool, interval)
	logger.Info("worker stopped")
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
