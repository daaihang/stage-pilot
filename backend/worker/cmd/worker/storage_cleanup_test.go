package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
)

type testObjectRemover struct {
	mu       sync.Mutex
	calls    map[string]int
	failOnce map[string]bool
	started  chan string
	release  chan struct{}
}

func (r *testObjectRemover) RemoveObject(_ context.Context, bucket, key string, _ minio.RemoveObjectOptions) error {
	if bucket != "test-file-cleanup-bucket" {
		return fmt.Errorf("unexpected bucket %q", bucket)
	}
	if r.started != nil {
		r.started <- key
		<-r.release
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls[key]++
	if r.failOnce[key] && r.calls[key] == 1 {
		return fmt.Errorf("temporary storage failure")
	}
	return nil
}

func (r *testObjectRemover) callCount(key string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls[key]
}

func TestCleanupFilesOnlyAbandonsUnfinishedUploads(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect database: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(t.Context()); err != nil {
		t.Fatalf("ping database: %v", err)
	}
	unique := fmt.Sprintf("file-cleanup-%d", time.Now().UnixNano())
	userID, workspaceID := unique+"-user", unique+"-workspace"
	if _, err := pool.Exec(t.Context(), `INSERT INTO users(id,display_name) VALUES($1,'File cleanup test')`, userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO workspaces(id,name,slug) VALUES($1,'File cleanup test',$2)`, workspaceID, unique); err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM files WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID)
	})
	insert := func(suffix, status string, age time.Duration, deleted, purged bool) string {
		t.Helper()
		id := unique + "-" + suffix
		var deletedAt, purgedAt any
		if deleted {
			deletedAt = time.Now()
		}
		if purged {
			purgedAt = time.Now()
		}
		_, err := pool.Exec(t.Context(), `INSERT INTO files(id,workspace_id,bucket,object_key,filename,size_bytes,status,created_by,created_at,deleted_at,object_purged_at)
			VALUES($1,$2,'test-file-cleanup-bucket',$3,'test.txt',5,$4,$5,$6,$7,$8)`, id, workspaceID, suffix, status, userID, time.Now().Add(-age), deletedAt, purgedAt)
		if err != nil {
			t.Fatalf("insert %s: %v", suffix, err)
		}
		return id
	}
	oldID := insert("stale", "pending", 48*time.Hour, false, false)
	recentID := insert("recent", "pending", time.Hour, false, false)
	deletedID := insert("deleted", "uploaded", 48*time.Hour, true, false)
	retryID := insert("retry", "abandoned", 48*time.Hour, false, false)
	insert("purged", "abandoned", 48*time.Hour, false, true)
	remover := &testObjectRemover{calls: map[string]int{}, failOnce: map[string]bool{"retry": true}}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cleanupFilesWithClient(t.Context(), logger, pool, remover, 24*time.Hour)
	if remover.callCount("stale") != 1 || remover.callCount("retry") != 1 || remover.callCount("recent") != 0 || remover.callCount("deleted") != 0 || remover.callCount("purged") != 0 {
		t.Fatalf("unexpected first cleanup calls: %#v", remover.calls)
	}
	var oldStatus, recentStatus, deletedStatus string
	var oldPurged, retryPurged bool
	if err := pool.QueryRow(t.Context(), `SELECT status,object_purged_at IS NOT NULL FROM files WHERE id=$1`, oldID).Scan(&oldStatus, &oldPurged); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT object_purged_at IS NOT NULL FROM files WHERE id=$1`, retryID).Scan(&retryPurged); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT status FROM files WHERE id=$1`, recentID).Scan(&recentStatus); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT status FROM files WHERE id=$1`, deletedID).Scan(&deletedStatus); err != nil {
		t.Fatal(err)
	}
	if oldStatus != "abandoned" || !oldPurged || retryPurged || recentStatus != "pending" || deletedStatus != "uploaded" {
		t.Fatalf("unexpected file states: old=%s/%v retry=%v recent=%s deleted=%s", oldStatus, oldPurged, retryPurged, recentStatus, deletedStatus)
	}
	cleanupFilesWithClient(t.Context(), logger, pool, remover, 24*time.Hour)
	if remover.callCount("stale") != 1 || remover.callCount("retry") != 2 {
		t.Fatalf("cleanup did not retry only failed object: %#v", remover.calls)
	}

	// The API's conditional completion update must lose once cleanup has claimed
	// the stale row, even while object deletion is still in progress.
	raceID := insert("race", "pending", 48*time.Hour, false, false)
	blocking := &testObjectRemover{calls: map[string]int{}, started: make(chan string), release: make(chan struct{})}
	done := make(chan struct{})
	go func() {
		cleanupFilesWithClient(context.Background(), logger, pool, blocking, 24*time.Hour)
		close(done)
	}()
	select {
	case key := <-blocking.started:
		if key != "race" {
			t.Fatalf("unexpected claimed object: %s", key)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup did not claim stale upload")
	}
	tag, err := pool.Exec(t.Context(), `UPDATE files SET status='uploaded' WHERE id=$1 AND status='pending' AND deleted_at IS NULL AND created_by=$2`, raceID, userID)
	if err != nil || tag.RowsAffected() != 0 {
		t.Fatalf("completion raced with cleanup: affected=%d err=%v", tag.RowsAffected(), err)
	}
	close(blocking.release)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup did not finish")
	}
}
