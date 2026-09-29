package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type testObjectRemover struct {
	mu               sync.Mutex
	calls            map[string]int
	failOnce         map[string]bool
	started          chan string
	release          chan struct{}
	multipartVisible map[string]int
	abortCalls       map[string]int
}

func (r *testObjectRemover) AbortMultipartUpload(_ context.Context, _, _, uploadID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.abortCalls == nil {
		r.abortCalls = map[string]int{}
	}
	r.abortCalls[uploadID]++
	return nil
}

func (r *testObjectRemover) ListObjectParts(_ context.Context, _, _, uploadID string, _, _ int) (minio.ListObjectPartsResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.multipartVisible[uploadID] > 0 {
		r.multipartVisible[uploadID]--
		return minio.ListObjectPartsResult{}, nil
	}
	return minio.ListObjectPartsResult{}, minio.ErrorResponse{Code: "NoSuchUpload"}
}

func TestValidateWorkerBucketVersioningDisabled(t *testing.T) {
	for _, test := range []struct {
		name, status string
		wantError    bool
	}{{name: "unversioned"}, {name: "enabled", status: "Enabled", wantError: true}, {name: "suspended", status: "Suspended", wantError: true}} {
		t.Run(test.name, func(t *testing.T) {
			err := validateWorkerBucketVersioningDisabled("files", minio.BucketVersioningConfiguration{Status: test.status})
			if (err != nil) != test.wantError {
				t.Fatalf("validate versioning status %q error = %v", test.status, err)
			}
		})
	}
}

func TestFreezeLegacyFileVersionPreservesSourceObject(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" || os.Getenv("S3_ENDPOINT") == "" {
		t.Skip("database and S3 are required")
	}
	pool, err := pgxpool.New(t.Context(), os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	endpoint := strings.TrimPrefix(strings.TrimPrefix(os.Getenv("S3_ENDPOINT"), "http://"), "https://")
	client, err := minio.New(endpoint, &minio.Options{Creds: credentials.NewStaticV4(os.Getenv("S3_ACCESS_KEY"), os.Getenv("S3_SECRET_KEY"), ""), Secure: os.Getenv("S3_USE_SSL") == "true", BucketLookup: minio.BucketLookupPath})
	if err != nil {
		t.Fatal(err)
	}
	bucket := os.Getenv("S3_BUCKET")
	if bucket == "" {
		bucket = "stagepilot"
	}
	unique := fmt.Sprintf("freeze-%d", time.Now().UnixNano())
	userID, workspaceID, fileID, versionID := unique+"-user", unique+"-workspace", unique+"-file", unique+"-version"
	oldKey := "ws/" + workspaceID + "/files/original"
	if _, err := pool.Exec(t.Context(), `INSERT INTO users(id,display_name) VALUES($1,'Freeze test')`, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO workspaces(id,name,slug) VALUES($1,'Freeze test',$2)`, workspaceID, unique); err != nil {
		t.Fatal(err)
	}
	info, err := client.PutObject(t.Context(), bucket, oldKey, strings.NewReader("first"), 5, minio.PutObjectOptions{ContentType: "text/plain"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		var finalKey string
		_ = pool.QueryRow(ctx, `SELECT object_key FROM file_versions WHERE id=$1`, versionID).Scan(&finalKey)
		_, _ = pool.Exec(ctx, `UPDATE files SET current_version_id=NULL WHERE id=$1`, fileID)
		_, _ = pool.Exec(ctx, `DELETE FROM file_versions WHERE file_id=$1`, fileID)
		_, _ = pool.Exec(ctx, `DELETE FROM files WHERE id=$1`, fileID)
		_, _ = pool.Exec(ctx, `DELETE FROM file_copy_attempts WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM workspaces WHERE id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID)
		_ = client.RemoveObject(ctx, bucket, oldKey, minio.RemoveObjectOptions{})
		if finalKey != "" {
			_ = client.RemoveObject(ctx, bucket, finalKey, minio.RemoveObjectOptions{})
		}
	})
	if _, err := pool.Exec(t.Context(), `INSERT INTO files(id,workspace_id,bucket,object_key,filename,content_type,size_bytes,etag,status,created_by,created_at)
		VALUES($1,$2,$3,$4,'legacy.txt','text/plain',5,$5,'uploaded',$6,$7)`, fileID, workspaceID, bucket, oldKey, info.ETag, userID, time.Now().Add(-10*365*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,etag,created_by,created_at)
		VALUES($1,$2,$3,1,$4,$5,'legacy.txt','text/plain',5,$6,$7,$8)`, versionID, workspaceID, fileID, bucket, oldKey, info.ETag, userID, time.Now().Add(-10*365*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE files SET current_version_id=$1 WHERE id=$2`, versionID, fileID); err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	freezeLegacyFileVersions(t.Context(), logger, pool, client, time.Hour)
	var finalKey string
	var frozen bool
	if err := pool.QueryRow(t.Context(), `SELECT object_key,frozen_at IS NOT NULL FROM file_versions WHERE id=$1`, versionID).Scan(&finalKey, &frozen); err != nil {
		t.Fatal(err)
	}
	if !frozen || finalKey == oldKey {
		t.Fatalf("legacy version not frozen: %q", finalKey)
	}
	for _, key := range []string{oldKey, finalKey} {
		object, err := client.GetObject(t.Context(), bucket, key, minio.GetObjectOptions{})
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(object)
		object.Close()
		if err != nil || string(data) != "first" {
			t.Fatalf("object %s changed: %q %v", key, data, err)
		}
	}
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
		_, _ = pool.Exec(ctx, `DELETE FROM file_copy_attempts WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM file_upload_sessions WHERE workspace_id=$1`, workspaceID)
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

	for _, session := range []struct {
		id, status string
		age        time.Duration
	}{{"unfinished", "pending", 48 * time.Hour}, {"finished", "completed", 48 * time.Hour}, {"recent-completed", "completed", time.Hour}} {
		_, err := pool.Exec(t.Context(), `INSERT INTO file_upload_sessions(id,workspace_id,file_id,created_by,staging_bucket,staging_key,expected_size,filename,content_type,status,created_at,expires_at)
			VALUES($1,$2,$3,$4,'test-file-cleanup-bucket',$5,5,'test.txt','text/plain',$6,$7,$8)`, unique+session.id, workspaceID, oldID, userID, session.id, session.status, time.Now().Add(-session.age), time.Now().Add(-session.age+time.Hour))
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, attempt := range []struct{ id, status string }{{"orphan", "pending"}, {"committed", "committed"}} {
		_, err := pool.Exec(t.Context(), `INSERT INTO file_copy_attempts(id,workspace_id,bucket,object_key,status,created_at)
			VALUES($1,$2,'test-file-cleanup-bucket',$3,$4,$5)`, unique+attempt.id, workspaceID, unique+"-"+attempt.id, attempt.status, time.Now().Add(-48*time.Hour))
		if err != nil {
			t.Fatal(err)
		}
	}
	cleaner := &testObjectRemover{calls: map[string]int{}, failOnce: map[string]bool{"unfinished": true}}
	cleanupUploadSessionsWithClient(t.Context(), logger, pool, cleaner, 24*time.Hour)
	cleanupCopyAttemptsWithClient(t.Context(), logger, pool, cleaner, 24*time.Hour)
	if cleaner.callCount("unfinished") != 1 || cleaner.callCount("finished") != 1 || cleaner.callCount("recent-completed") != 0 || cleaner.callCount(unique+"-orphan") != 1 || cleaner.callCount(unique+"-committed") != 0 {
		t.Fatalf("new cleanup selected wrong objects: %#v", cleaner.calls)
	}
	cleanupUploadSessionsWithClient(t.Context(), logger, pool, cleaner, 24*time.Hour)
	cleanupCopyAttemptsWithClient(t.Context(), logger, pool, cleaner, 24*time.Hour)
	if cleaner.callCount("unfinished") != 2 || cleaner.callCount("finished") != 1 || cleaner.callCount(unique+"-orphan") != 1 {
		t.Fatalf("new cleanup retries or idempotence failed: %#v", cleaner.calls)
	}
	var sessionPurged, attemptPurged bool
	if err := pool.QueryRow(t.Context(), `SELECT object_purged_at IS NOT NULL FROM file_upload_sessions WHERE id=$1`, unique+"unfinished").Scan(&sessionPurged); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT object_purged_at IS NOT NULL FROM file_copy_attempts WHERE id=$1`, unique+"orphan").Scan(&attemptPurged); err != nil {
		t.Fatal(err)
	}
	if !sessionPurged || !attemptPurged {
		t.Fatalf("cleanup markers missing: session=%v copy=%v", sessionPurged, attemptPurged)
	}
	mpuID := unique + "-mpu"
	if _, err := pool.Exec(t.Context(), `INSERT INTO file_upload_sessions(id,workspace_id,file_id,created_by,staging_bucket,staging_key,expected_size,filename,content_type,status,multipart_upload_id,created_at,expires_at)
		VALUES($1,$2,$3,$4,'test-file-cleanup-bucket',$5,5,'part.txt','text/plain','cancelled',$6,NOW()-INTERVAL '48 hours',NOW()-INTERVAL '47 hours')`, unique+"-multipart", workspaceID, oldID, userID, unique+"-multipart", mpuID); err != nil {
		t.Fatal(err)
	}
	mpuCleaner := &testObjectRemover{calls: map[string]int{}, multipartVisible: map[string]int{mpuID: 1}}
	cleanupUploadSessionsWithClient(t.Context(), logger, pool, mpuCleaner, 24*time.Hour)
	var mpuPurged bool
	if err := pool.QueryRow(t.Context(), `SELECT object_purged_at IS NOT NULL FROM file_upload_sessions WHERE id=$1`, unique+"-multipart").Scan(&mpuPurged); err != nil {
		t.Fatal(err)
	}
	if mpuPurged || mpuCleaner.callCount(unique+"-multipart") != 0 || mpuCleaner.abortCalls[mpuID] != 1 {
		t.Fatalf("multipart cleanup released storage before abort was verified: purged=%v calls=%d", mpuPurged, mpuCleaner.callCount(unique+"-multipart"))
	}
	cleanupUploadSessionsWithClient(t.Context(), logger, pool, mpuCleaner, 24*time.Hour)
	if err := pool.QueryRow(t.Context(), `SELECT object_purged_at IS NOT NULL FROM file_upload_sessions WHERE id=$1`, unique+"-multipart").Scan(&mpuPurged); err != nil {
		t.Fatal(err)
	}
	if !mpuPurged || mpuCleaner.callCount(unique+"-multipart") != 1 || mpuCleaner.abortCalls[mpuID] != 2 {
		t.Fatalf("multipart cleanup did not retry to verified completion: purged=%v calls=%d", mpuPurged, mpuCleaner.callCount(unique+"-multipart"))
	}
	copyRaceID := unique + "-copy-race"
	if _, err := pool.Exec(t.Context(), `INSERT INTO file_copy_attempts(id,workspace_id,bucket,object_key,created_at)
		VALUES($1,$2,'test-file-cleanup-bucket',$3,$4)`, copyRaceID, workspaceID, copyRaceID, time.Now().Add(-48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	copyBlocking := &testObjectRemover{calls: map[string]int{}, started: make(chan string), release: make(chan struct{})}
	copyDone := make(chan struct{})
	go func() {
		cleanupCopyAttemptsWithClient(context.Background(), logger, pool, copyBlocking, 24*time.Hour)
		close(copyDone)
	}()
	select {
	case key := <-copyBlocking.started:
		if key != copyRaceID {
			t.Fatalf("unexpected copy cleanup target: %s", key)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("copy cleanup did not start")
	}
	type publishResult struct {
		affected int64
		err      error
	}
	published := make(chan publishResult, 1)
	go func() {
		tag, err := pool.Exec(context.Background(), `UPDATE file_copy_attempts SET status='committed'
			WHERE id=$1 AND status='pending' AND object_purged_at IS NULL`, copyRaceID)
		published <- publishResult{tag.RowsAffected(), err}
	}()
	select {
	case result := <-published:
		t.Fatalf("copy published while cleanup held its lock: %+v", result)
	case <-time.After(100 * time.Millisecond):
	}
	close(copyBlocking.release)
	select {
	case <-copyDone:
	case <-time.After(5 * time.Second):
		t.Fatal("copy cleanup did not finish")
	}
	select {
	case result := <-published:
		if result.err != nil || result.affected != 0 {
			t.Fatalf("cleaned copy became publishable: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("publisher did not resume after copy cleanup")
	}
}
