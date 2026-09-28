package main

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
)

func TestRetentionOperatorInputs(t *testing.T) {
	if err := validateOperatorFields(options{actor: "ops", reason: "legal request", caseRef: "CASE-1"}); err != nil {
		t.Fatalf("complete operator fields rejected: %v", err)
	}
	for _, opts := range []options{{actor: "ops", reason: "reason"}, {actor: "ops", caseRef: "CASE-1"}, {reason: "reason", caseRef: "CASE-1"}} {
		if err := validateOperatorFields(opts); err == nil {
			t.Fatalf("incomplete operator fields accepted: %+v", opts)
		}
	}
	if err := validatePurgeConfirmation("file-1", "file-1"); err != nil {
		t.Fatalf("exact confirmation rejected: %v", err)
	}
	if err := validatePurgeConfirmation("file-1", "file-2"); err == nil {
		t.Fatal("mismatched confirmation accepted")
	}
}

func TestRetentionStorageVersioningMustBeDisabled(t *testing.T) {
	for _, test := range []struct {
		name, status string
		wantError    bool
	}{{name: "unversioned"}, {name: "enabled", status: "Enabled", wantError: true}, {name: "suspended", status: "Suspended", wantError: true}} {
		t.Run(test.name, func(t *testing.T) {
			err := validateBucketVersioningDisabled("stagepilot", minio.BucketVersioningConfiguration{Status: test.status})
			if (err != nil) != test.wantError {
				t.Fatalf("validate versioning status %q error = %v", test.status, err)
			}
		})
	}
}

func TestRetentionOperationsE2E(t *testing.T) {
	if os.Getenv("FILE_RETENTION_E2E") != "1" || os.Getenv("DATABASE_URL") == "" {
		t.Skip("set FILE_RETENTION_E2E=1 with DATABASE_URL and migration 52 applied")
	}
	pool, err := pgxpool.New(t.Context(), os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	unique := fmt.Sprintf("retention-cli-%d", time.Now().UnixNano())
	userID, workspaceID := unique+"-user", unique+"-workspace"
	fileID, versionID := unique+"-file", unique+"-version"
	if _, err := pool.Exec(t.Context(), `INSERT INTO users(id,display_name) VALUES($1,'Retention CLI test')`, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO workspaces(id,name,slug) VALUES($1,'Retention CLI test',$2)`, workspaceID, unique); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO workspace_storage_accounts(workspace_id) VALUES($1)`, workspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO files(id,workspace_id,bucket,object_key,filename,content_type,size_bytes,status,created_by,deleted_at,purge_after)
		VALUES($1,$2,'retention-test','ws/'||$2||'/retention-cli','test.txt','text/plain',5,'uploaded',$3,NOW()-INTERVAL '1 day',NOW()+INTERVAL '29 days')`, fileID, workspaceID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO file_versions(id,workspace_id,file_id,version_no,bucket,object_key,filename,content_type,size_bytes,created_by)
		VALUES($1,$2,$3,1,'retention-test','ws/'||$2||'/retention-cli','test.txt','text/plain',5,$4)`, versionID, workspaceID, fileID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE files SET current_version_id=$2 WHERE id=$1`, fileID, versionID); err != nil {
		t.Fatal(err)
	}
	// Audit rows intentionally survive, so this opt-in test keeps the isolated
	// Workspace/account while removing its file fixtures.
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM file_purge_tasks WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `DELETE FROM file_retention_holds WHERE workspace_id=$1`, workspaceID)
		_, _ = pool.Exec(ctx, `UPDATE files SET current_version_id=NULL WHERE id=$1`, fileID)
		_, _ = pool.Exec(ctx, `DELETE FROM file_versions WHERE id=$1`, versionID)
		_, _ = pool.Exec(ctx, `DELETE FROM files WHERE id=$1`, fileID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID)
	})
	opts := options{workspaceID: workspaceID, fileID: fileID, actor: "retention-test-operator", reason: "case review", caseRef: "CASE-RET-52"}
	if err := placeHold(t.Context(), pool, opts); err != nil {
		t.Fatal(err)
	}
	if err := requestPurge(t.Context(), pool, opts); err == nil {
		t.Fatal("operator purge was accepted while a retention hold is active")
	}
	if err := releaseHold(t.Context(), pool, opts); err != nil {
		t.Fatal(err)
	}
	if err := requestPurge(t.Context(), pool, opts); err != nil {
		t.Fatal(err)
	}
	var cause, taskStatus, releaseCase string
	if err := pool.QueryRow(t.Context(), `SELECT cause,status FROM file_purge_tasks WHERE version_id=$1`, versionID).Scan(&cause, &taskStatus); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT release_case_reference FROM file_retention_holds WHERE workspace_id=$1 AND file_id=$2`, workspaceID, fileID).Scan(&releaseCase); err != nil {
		t.Fatal(err)
	}
	if cause != "operator_requested" || taskStatus != "pending" || releaseCase != opts.caseRef {
		t.Fatalf("retention operation state: cause=%s task=%s release case=%s", cause, taskStatus, releaseCase)
	}
	var eventCount int
	if err := pool.QueryRow(t.Context(), `SELECT COUNT(*) FROM workspace_storage_events WHERE workspace_id=$1
		AND reference_id=$2 AND event_type IN ('retention_hold_placed','retention_hold_released','permanent_purge_requested')`, workspaceID, fileID).Scan(&eventCount); err != nil {
		t.Fatal(err)
	}
	if eventCount != 3 {
		t.Fatalf("retention audit event count = %d, want 3", eventCount)
	}
}
