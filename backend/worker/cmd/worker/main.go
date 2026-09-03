package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
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

	logger.Info("worker started", "interval", interval)
	go cleanupTicker(ctx, logger, pool, interval)
	run(ctx, logger, pool, interval)
	logger.Info("worker stopped")
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
