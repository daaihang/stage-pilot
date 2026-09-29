package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	objectstore "github.com/daaihang/stagepilot/backend/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type options struct {
	workspace, task, finding, actor, reason, caseRef string
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	command := os.Args[1]
	flags := flag.NewFlagSet(command, flag.ExitOnError)
	opts := options{}
	flags.StringVar(&opts.workspace, "workspace", "", "Workspace ID")
	flags.StringVar(&opts.task, "task", "", "Scan task ID")
	flags.StringVar(&opts.finding, "finding", "", "Reconciliation finding ID")
	flags.StringVar(&opts.actor, "actor", "", "Platform operator identifier")
	flags.StringVar(&opts.reason, "reason", "", "Reason for the operation")
	flags.StringVar(&opts.caseRef, "case", "", "Case or ticket reference")
	_ = flags.Parse(os.Args[2:])
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db, err := connect(ctx)
	if err != nil {
		fatal("connect database: %v", err)
	}
	defer db.Close()
	var result any
	switch command {
	case "scan-status":
		result, err = scanStatus(ctx, db)
	case "scan-list":
		result, err = scanList(ctx, db, opts.workspace)
	case "scan-retry":
		requireOperator(opts)
		if opts.task == "" {
			fatal("--task is required")
		}
		err = retryScan(ctx, db, opts)
	case "replica-list":
		result, err = replicaList(ctx, db, opts.workspace)
	case "replica-retry":
		requireOperator(opts)
		if opts.task == "" {
			fatal("--task is required")
		}
		err = retryReplica(ctx, db, opts)
	case "reconcile-run":
		requireOperator(opts)
		err = requestReconciliation(ctx, db, opts)
	case "reconcile-list":
		result, err = listFindings(ctx, db, opts.workspace)
	case "reconcile-recheck":
		requireOperator(opts)
		if opts.finding == "" {
			fatal("--finding is required")
		}
		err = recheckFinding(ctx, db, opts)
	case "backup-status":
		result, err = backupStatus(ctx, db)
	default:
		usage()
	}
	if err != nil {
		fatal("%s: %v", command, err)
	}
	if result != nil {
		if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
			fatal("encode result: %v", err)
		}
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: file-ops <scan-status|scan-list|scan-retry|replica-list|replica-retry|reconcile-run|reconcile-list|reconcile-recheck|backup-status> [flags]")
	os.Exit(2)
}
func fatal(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...); os.Exit(1) }
func connect(ctx context.Context) (*pgxpool.Pool, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err = db.Ping(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
func requireOperator(o options) {
	if strings.TrimSpace(o.actor) == "" || strings.TrimSpace(o.reason) == "" || strings.TrimSpace(o.caseRef) == "" {
		fatal("--actor, --reason, and --case are required for state-changing operations")
	}
}
func scanStatus(ctx context.Context, db *pgxpool.Pool) (any, error) {
	rows, err := db.Query(ctx, `SELECT status,COUNT(*),MIN(created_at) FROM file_scan_tasks GROUP BY status ORDER BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type entry struct {
		Status string     `json:"status"`
		Count  int64      `json:"count"`
		Oldest *time.Time `json:"oldest_created_at,omitempty"`
	}
	items := []entry{}
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.Status, &e.Count, &e.Oldest); err != nil {
			return nil, err
		}
		items = append(items, e)
	}
	return map[string]any{"tasks": items}, rows.Err()
}
func scanList(ctx context.Context, db *pgxpool.Pool, workspace string) (any, error) {
	query := `SELECT id,workspace_id,file_id,version_id,status,attempts,available_at,last_error,updated_at FROM file_scan_tasks`
	args := []any{}
	if workspace != "" {
		query += ` WHERE workspace_id=$1`
		args = append(args, workspace)
	}
	query += ` ORDER BY CASE status WHEN 'needs_attention' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,updated_at,id LIMIT 100`
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type task struct {
		ID          string    `json:"id"`
		WorkspaceID string    `json:"workspace_id"`
		FileID      string    `json:"file_id"`
		VersionID   string    `json:"version_id"`
		Status      string    `json:"status"`
		Attempts    int       `json:"attempts"`
		AvailableAt time.Time `json:"available_at"`
		LastError   string    `json:"last_error"`
		UpdatedAt   time.Time `json:"updated_at"`
	}
	items := []task{}
	for rows.Next() {
		var t task
		if err := rows.Scan(&t.ID, &t.WorkspaceID, &t.FileID, &t.VersionID, &t.Status, &t.Attempts, &t.AvailableAt, &t.LastError, &t.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	return map[string]any{"items": items, "limit": 100}, rows.Err()
}
func retryScan(ctx context.Context, db *pgxpool.Pool, o options) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var workspace, version string
	var attempts int
	err = tx.QueryRow(ctx, `UPDATE file_scan_tasks SET status='pending',attempts=0,available_at=NOW(),lease_owner='',lease_until=NULL,last_error='',outcome='',completed_at=NULL,updated_at=NOW()
		WHERE id=$1 AND status='needs_attention' RETURNING workspace_id,version_id,attempts`, o.task).Scan(&workspace, &version, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("task is not in needs_attention state")
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO file_scan_attempt_events(task_id,workspace_id,attempt_no,event_type,error_code) VALUES($1,$2,1,'operator_retry','operator_requested')`, o.task, workspace); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO file_ops_audit_events(actor,action,reason,case_reference,target_type,target_id,details) VALUES($1,'scan_retry',$2,$3,'scan_task',$4,jsonb_build_object('workspace_id',$5::text,'version_id',$6::text))`, o.actor, o.reason, o.caseRef, o.task, workspace, version); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func replicaList(ctx context.Context, db *pgxpool.Pool, workspace string) (any, error) {
	query := `SELECT id,asset_type,COALESCE(workspace_id,''),asset_id,status,attempts,available_at,last_error,updated_at FROM file_replication_tasks`
	args := []any{}
	if workspace != "" {
		query += ` WHERE workspace_id=$1`
		args = append(args, workspace)
	}
	query += ` ORDER BY CASE status WHEN 'needs_attention' THEN 0 WHEN 'pending' THEN 1 WHEN 'leased' THEN 2 ELSE 3 END,updated_at,id LIMIT 100`
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type task struct {
		ID          int64     `json:"id"`
		AssetType   string    `json:"asset_type"`
		WorkspaceID string    `json:"workspace_id,omitempty"`
		AssetID     string    `json:"asset_id"`
		Status      string    `json:"status"`
		Attempts    int       `json:"attempts"`
		AvailableAt time.Time `json:"available_at"`
		LastError   string    `json:"last_error"`
		UpdatedAt   time.Time `json:"updated_at"`
	}
	items := []task{}
	for rows.Next() {
		var item task
		if err := rows.Scan(&item.ID, &item.AssetType, &item.WorkspaceID, &item.AssetID, &item.Status, &item.Attempts, &item.AvailableAt, &item.LastError, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{"items": items, "limit": 100}, rows.Err()
}

func retryReplica(ctx context.Context, db *pgxpool.Pool, o options) error {
	taskID, err := strconv.ParseInt(o.task, 10, 64)
	if err != nil || taskID < 1 {
		return errors.New("replication task ID must be a positive integer")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var assetType, assetID, workspace string
	err = tx.QueryRow(ctx, `UPDATE file_replication_tasks SET status='pending',attempts=0,available_at=NOW(),lease_owner='',lease_until=NULL,last_error='',updated_at=NOW()
		WHERE id=$1 AND status='needs_attention' RETURNING asset_type,asset_id,COALESCE(workspace_id,'')`, taskID).Scan(&assetType, &assetID, &workspace)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("replication task is not in needs_attention state")
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO file_ops_audit_events(actor,action,reason,case_reference,target_type,target_id,details)
		VALUES($1,'replica_retry',$2,$3,'replication_task',$4,jsonb_build_object('asset_type',$5::text,'asset_id',$6::text,'workspace_id',$7::text))`, o.actor, o.reason, o.caseRef, o.task, assetType, assetID, workspace); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func requestReconciliation(ctx context.Context, db *pgxpool.Pool, o options) error {
	id := uuid.NewString()
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var workspace any
	if o.workspace != "" {
		workspace = o.workspace
	}
	if _, err = tx.Exec(ctx, `INSERT INTO storage_reconciliation_requests(id,workspace_id,requested_by,reason,case_reference) VALUES($1,$2,$3,$4,$5)`, id, workspace, o.actor, o.reason, o.caseRef); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO file_ops_audit_events(actor,action,reason,case_reference,target_type,target_id,details) VALUES($1,'reconciliation_requested',$2,$3,'reconciliation_request',$4,jsonb_build_object('workspace_id',$5::text))`, o.actor, o.reason, o.caseRef, id, o.workspace); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"request_id": id, "status": "pending"})
}
func listFindings(ctx context.Context, db *pgxpool.Pool, workspace string) (any, error) {
	query := `SELECT id,asset_type,finding_type,workspace_id,bucket,object_key,expected_size,observed_size,first_seen_run_id,last_seen_run_id,consecutive_runs,confirmed_at,updated_at FROM storage_reconciliation_findings WHERE resolved_at IS NULL`
	args := []any{}
	if workspace != "" {
		query += ` AND workspace_id=$1`
		args = append(args, workspace)
	}
	query += ` ORDER BY confirmed_at NULLS FIRST,updated_at DESC,id LIMIT 500`
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type finding struct {
		ID           int64      `json:"id"`
		AssetType    string     `json:"asset_type"`
		FindingType  string     `json:"finding_type"`
		WorkspaceID  *string    `json:"workspace_id,omitempty"`
		Bucket       string     `json:"bucket"`
		ObjectKey    string     `json:"object_key"`
		ExpectedSize *int64     `json:"expected_size,omitempty"`
		ObservedSize *int64     `json:"observed_size,omitempty"`
		FirstRun     string     `json:"first_seen_run_id"`
		LastRun      string     `json:"last_seen_run_id"`
		Consecutive  int        `json:"consecutive_runs"`
		ConfirmedAt  *time.Time `json:"confirmed_at,omitempty"`
		UpdatedAt    time.Time  `json:"updated_at"`
	}
	items := []finding{}
	for rows.Next() {
		var f finding
		if err := rows.Scan(&f.ID, &f.AssetType, &f.FindingType, &f.WorkspaceID, &f.Bucket, &f.ObjectKey, &f.ExpectedSize, &f.ObservedSize, &f.FirstRun, &f.LastRun, &f.Consecutive, &f.ConfirmedAt, &f.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, f)
	}
	return map[string]any{"items": items, "limit": 500}, rows.Err()
}
func s3Client() (objectstore.Client, error) {
	client, err := objectstore.NewMinIO(objectstore.MinIOConfig{
		Endpoint: os.Getenv("S3_ENDPOINT"), AccessKey: os.Getenv("S3_ACCESS_KEY"), SecretKey: os.Getenv("S3_SECRET_KEY"),
		Secure: os.Getenv("S3_USE_SSL") == "true", Region: env("S3_REGION", "us-east-1"), PathStyle: true,
	})
	if err != nil {
		return nil, fmt.Errorf("create object storage adapter: %w", err)
	}
	return client, nil
}
func recheckFinding(ctx context.Context, db *pgxpool.Pool, o options) error {
	var assetType, findingType, bucket, key string
	var workspace *string
	var expected, observed *int64
	err := db.QueryRow(ctx, `SELECT asset_type,finding_type,bucket,object_key,workspace_id,expected_size,observed_size FROM storage_reconciliation_findings WHERE id=$1 AND resolved_at IS NULL`, o.finding).Scan(&assetType, &findingType, &bucket, &key, &workspace, &expected, &observed)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("open finding not found")
	}
	if err != nil {
		return err
	}
	if findingType == "stale_multipart" {
		return errors.New("stale multipart findings are resolved by a complete reconciliation run")
	}
	client, err := s3Client()
	if err != nil {
		return err
	}
	exists := false
	var actual int64
	if key != "" {
		info, statErr := client.StatObject(ctx, objectstore.ObjectRef{Bucket: bucket, Key: key})
		if statErr == nil {
			exists = true
			actual = info.Size
		} else if !errors.Is(statErr, objectstore.ErrObjectNotFound) {
			return statErr
		}
	}
	resolve := false
	switch findingType {
	case "orphan":
		resolve = !exists
	case "missing":
		if !exists {
			resolve, err = referenceGone(ctx, db, assetType, workspace, bucket, key)
		} else {
			resolve = true
		}
	case "size_mismatch":
		resolve = exists && expected != nil && actual == *expected
	default:
		return fmt.Errorf("unsupported finding type %q", findingType)
	}
	if err != nil {
		return err
	}
	if !resolve {
		return fmt.Errorf("finding still present; storage was not changed")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `UPDATE storage_reconciliation_findings SET resolved_at=NOW(),resolution='operator_recheck_confirmed',updated_at=NOW() WHERE id=$1 AND resolved_at IS NULL`, o.finding); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO file_ops_audit_events(actor,action,reason,case_reference,target_type,target_id,details) VALUES($1,'reconciliation_finding_closed',$2,$3,'finding',$4,jsonb_build_object('finding_type',$5::text,'asset_type',$6::text,'bucket',$7::text,'object_key',$8::text))`, o.actor, o.reason, o.caseRef, o.finding, findingType, assetType, bucket, key); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func referenceGone(ctx context.Context, db *pgxpool.Pool, assetType string, workspace *string, bucket, key string) (bool, error) {
	if workspace == nil && assetType != "avatar" {
		return false, nil
	}
	var exists bool
	var query string
	switch assetType {
	case "avatar":
		query = `SELECT EXISTS(SELECT 1 FROM users WHERE avatar_object_key=$1 AND deleted_at IS NULL)`
	case "file_version":
		query = `SELECT EXISTS(SELECT 1 FROM file_versions WHERE workspace_id=$1 AND bucket=$2 AND object_key=$3 AND object_purged_at IS NULL)`
	case "legacy_file":
		query = `SELECT EXISTS(SELECT 1 FROM files WHERE workspace_id=$1 AND bucket=$2 AND object_key=$3 AND object_purged_at IS NULL)`
	default:
		return false, nil
	}
	var err error
	if assetType == "avatar" {
		err = db.QueryRow(ctx, query, key).Scan(&exists)
	} else {
		err = db.QueryRow(ctx, query, *workspace, bucket, key).Scan(&exists)
	}
	return !exists, err
}
func backupStatus(ctx context.Context, db *pgxpool.Pool) (any, error) {
	var base, wal, restore *time.Time
	var restoreStatus string
	var replicaThrough *time.Time
	err := db.QueryRow(ctx, `SELECT b.last_base_backup_at,b.wal_archived_through,b.last_restore_validation_at,b.last_restore_validation_status,r.contiguous_through
		FROM file_backup_status b CROSS JOIN file_replication_watermarks r WHERE b.id=1 AND r.id=1`).Scan(&base, &wal, &restore, &restoreStatus, &replicaThrough)
	if err != nil {
		return nil, err
	}
	var pending, attention int64
	var oldest *time.Time
	err = db.QueryRow(ctx, `SELECT COUNT(*) FILTER(WHERE status IN ('pending','leased')),COUNT(*) FILTER(WHERE status='needs_attention'),
		MIN(created_at) FILTER(WHERE status NOT IN ('replicated','purge_pending','purged')) FROM file_replication_tasks`).Scan(&pending, &attention, &oldest)
	if err != nil {
		return nil, err
	}
	var safe *time.Time
	if base != nil && wal != nil && replicaThrough != nil {
		value := *wal
		if replicaThrough.Before(value) {
			value = *replicaThrough
		}
		if !value.Before(*base) {
			safe = &value
		}
	}
	return map[string]any{"last_base_backup_at": base, "wal_archived_through": wal, "replica_contiguous_through": replicaThrough, "safe_recovery_point": safe, "replication_pending": pending, "replication_needs_attention": attention, "oldest_unreplicated_at": oldest, "oldest_pending_replication_at": oldest, "last_restore_validation_at": restore, "last_restore_validation_status": restoreStatus}, nil
}
func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
