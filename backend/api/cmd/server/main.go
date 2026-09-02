package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type application struct {
	db     *pgxpool.Pool
	logger *slog.Logger
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	databaseURL := envOrDefault("DATABASE_URL", "postgres://stagepilot:stagepilot@localhost:15432/stagepilot?sslmode=disable")
	port := envOrDefault("PORT", "8080")

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		logger.Error("create database pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	app := application{db: pool, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", app.health)
	mux.HandleFunc("GET /readyz", app.ready)

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           requestLogger(logger, mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("graceful shutdown", "error", err)
		}
	}()

	logger.Info("api listening", "address", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("serve api", "error", err)
		os.Exit(1)
	}
}

func (app application) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok", "service": "stagepilot-api"})
}

func (app application) ready(writer http.ResponseWriter, request *http.Request) {
	ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
	defer cancel()
	if err := app.db.Ping(ctx); err != nil {
		app.logger.Warn("database not ready", "error", err)
		writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ready"})
}

func requestLogger(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		started := time.Now()
		next.ServeHTTP(writer, request)
		logger.Info("request", "method", request.Method, "path", request.URL.Path, "duration", time.Since(started))
	})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
