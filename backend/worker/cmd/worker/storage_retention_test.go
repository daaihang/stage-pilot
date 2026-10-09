package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestFileRetentionPurgeQueueE2E(t *testing.T) {
	if os.Getenv("FILE_RETENTION_E2E") != "1" {
		t.Skip("set FILE_RETENTION_E2E=1 with the isolated test database")
	}
	pool, err := pgxpool.New(t.Context(), workerTestDatabaseURL(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	unique := fmt.Sprintf("file-retention-%d", time.Now().UnixNano())
	userID, workspaceID := unique+"-user", unique+"-workspace"
	if _, err := pool.Exec(t.Context(), `INSERT INTO users(id,display_name) VALUES($1,'File retention test')`, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO workspaces(id,name,slug) VALUES($1,'File retention test',$2)`, workspaceID, unique); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO workspace_storage_accounts(workspace_id,physical_used_bytes) VALUES($1,60)`, workspaceID); err != nil {
		t.Fatal(err)
	}
	files := []struct {
		suffix string
		size   int64
	}{{"a", 10}, {"b", 20}, {"held", 30}}
	versionIDs := map[string]string{}
	for _, item := range files {
		fileID, versionID := unique+"-file-"+item.suffix, unique+"-version-"+item.suffix
		objectKey := "ws/" + workspaceID + "/" + item.suffix
		if _, err := pool.Exec(t.Context(), `INSERT INTO files(id,workspace_id,bucket,object_key,filename,content_type,size_bytes,status,created_by,deleted_at,purge_after)
			VALUES($1,$2,'test-file-cleanup-bucket',$3,'retained.txt','text/plain',$4,'uploaded',$5,NOW()-INTERVAL '31 days',NOW()-INTERVAL '1 day')`,
			fileID, workspaceID, objectKey, item.size, userID); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(t.Context(), `INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,created_by)
			VALUES($1,$2,$3,1,'test-file-cleanup-bucket',$4,'retained.txt','text/plain',$5,$6)`,
			versionID, workspaceID, fileID, objectKey, item.size, userID); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(t.Context(), `UPDATE files SET current_version_id=$2 WHERE id=$1`, fileID, versionID); err != nil {
			t.Fatal(err)
		}
		versionIDs[item.suffix] = versionID
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO file_retention_holds(id,workspace_id,file_id,actor_label,reason,case_reference)
		VALUES($1,$2,$3,'test-operator','preserve test data','TEST-RETENTION-1')`, unique+"-hold", workspaceID, unique+"-file-held"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE file_versions SET security_status='infected',quarantine_until=NOW()-INTERVAL '1 day' WHERE id=$1`, versionIDs["held"]); err != nil {
		t.Fatal(err)
	}
	keyA, keyB, keyHeld := "ws/"+workspaceID+"/a", "ws/"+workspaceID+"/b", "ws/"+workspaceID+"/held"
	// Audit rows are intentionally append-only, so keep the isolated Workspace
	// account and Workspace after removing the test's file fixtures.
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM file_purge_tasks WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM file_retention_holds WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `UPDATE files SET current_version_id=NULL WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM file_versions WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM files WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `UPDATE workspace_storage_accounts SET physical_used_bytes=0 WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID)
	})

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	remover := &testObjectRemover{calls: map[string]int{}, failOnce: map[string]bool{keyA: true}}
	cleanupExpiredFileVersions(t.Context(), logger, pool, remover)
	purgeQuarantinedVersionsWithAccounting(t.Context(), logger, pool, remover)
	if remover.callCount(keyA) != 1 || remover.callCount(keyB) != 1 || remover.callCount(keyHeld) != 0 {
		t.Fatalf("unexpected first purge calls: %#v", remover.calls)
	}
	var retryStatus, retryError string
	var attempts int
	if err := pool.QueryRow(t.Context(), `SELECT status,last_error,attempts FROM file_purge_tasks WHERE version_id=$1`, versionIDs["a"]).Scan(&retryStatus, &retryError, &attempts); err != nil {
		t.Fatal(err)
	}
	if retryStatus != "pending" || retryError == "" || attempts != 1 {
		t.Fatalf("failed object did not enter retry state: status=%s attempts=%d error=%q", retryStatus, attempts, retryError)
	}
	var heldTaskCount, physicalUsed, retainedVersions int64
	if err := pool.QueryRow(t.Context(), `SELECT COUNT(*) FROM file_purge_tasks WHERE version_id=$1`, versionIDs["held"]).Scan(&heldTaskCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT physical_used_bytes FROM workspace_storage_accounts WHERE workspace_id=$1`, workspaceID).Scan(&physicalUsed); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT COUNT(*) FROM file_versions WHERE workspace_id=$1`, workspaceID).Scan(&retainedVersions); err != nil {
		t.Fatal(err)
	}
	if heldTaskCount != 0 || physicalUsed != 40 || retainedVersions != 3 {
		t.Fatalf("first purge state: held tasks=%d physical=%d versions=%d", heldTaskCount, physicalUsed, retainedVersions)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE file_purge_tasks SET available_at=NOW()-INTERVAL '1 second' WHERE version_id=$1`, versionIDs["a"]); err != nil {
		t.Fatal(err)
	}
	cleanupExpiredFileVersions(t.Context(), logger, pool, remover)
	if remover.callCount(keyA) != 2 {
		t.Fatalf("failed deletion was not retried: %#v", remover.calls)
	}
	var taskStatus string
	if err := pool.QueryRow(t.Context(), `SELECT status FROM file_purge_tasks WHERE version_id=$1`, versionIDs["a"]).Scan(&taskStatus); err != nil {
		t.Fatal(err)
	}
	if taskStatus != "completed" {
		t.Fatalf("retried task status = %q, want completed", taskStatus)
	}
	if err := pool.QueryRow(t.Context(), `SELECT physical_used_bytes FROM workspace_storage_accounts WHERE workspace_id=$1`, workspaceID).Scan(&physicalUsed); err != nil {
		t.Fatal(err)
	}
	if physicalUsed != 30 {
		t.Fatalf("physical usage after retry = %d, want held object's 30 bytes", physicalUsed)
	}
	var aPurged, bPurged, heldPurged bool
	if err := pool.QueryRow(t.Context(), `SELECT object_purged_at IS NOT NULL FROM file_versions WHERE id=$1`, versionIDs["a"]).Scan(&aPurged); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT object_purged_at IS NOT NULL FROM file_versions WHERE id=$1`, versionIDs["b"]).Scan(&bPurged); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT object_purged_at IS NOT NULL FROM file_versions WHERE id=$1`, versionIDs["held"]).Scan(&heldPurged); err != nil {
		t.Fatal(err)
	}
	if !aPurged || !bPurged || heldPurged {
		t.Fatalf("purge markers: retried=%v first=%v held=%v", aPurged, bPurged, heldPurged)
	}
}
