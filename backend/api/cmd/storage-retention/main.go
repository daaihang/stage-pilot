package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	objectstore "github.com/daaihang/stagepilot/backend/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type options struct {
	workspaceID string
	fileID      string
	actor       string
	reason      string
	caseRef     string
	confirm     string
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	command := os.Args[1]
	flags := flag.NewFlagSet(command, flag.ExitOnError)
	opts := options{}
	flags.StringVar(&opts.workspaceID, "workspace", "", "Workspace ID")
	flags.StringVar(&opts.fileID, "file", "", "File ID")
	flags.StringVar(&opts.actor, "actor", "", "Platform operator identifier recorded in the audit log")
	flags.StringVar(&opts.reason, "reason", "", "Short reason for the retention action")
	flags.StringVar(&opts.caseRef, "case", "", "Case or ticket reference")
	flags.StringVar(&opts.confirm, "confirm", "", "Must exactly match the file ID for permanent purge")
	if err := flags.Parse(os.Args[2:]); err != nil {
		fatal("parse flags: %v", err)
	}
	if command == "check-storage" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := checkStorage(ctx); err != nil {
			fatal("check storage retention safety: %v", err)
		}
		return
	}
	if strings.TrimSpace(opts.workspaceID) == "" {
		fatal("--workspace is required")
	}
	if command != "show" && strings.TrimSpace(opts.fileID) == "" {
		fatal("--file is required")
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fatal("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		fatal("connect database: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		fatal("ping database: %v", err)
	}

	switch command {
	case "show":
		if err := show(ctx, pool, opts); err != nil {
			fatal("show retention state: %v", err)
		}
	case "hold":
		requireOperatorFields(opts)
		if err := placeHold(ctx, pool, opts); err != nil {
			fatal("place retention hold: %v", err)
		}
	case "release-hold":
		requireOperatorFields(opts)
		if err := releaseHold(ctx, pool, opts); err != nil {
			fatal("release retention hold: %v", err)
		}
	case "purge":
		requireOperatorFields(opts)
		if err := validatePurgeConfirmation(opts.fileID, opts.confirm); err != nil {
			fatal("%v", err)
		}
		if err := requestPurge(ctx, pool, opts); err != nil {
			fatal("request permanent purge: %v", err)
		}
	default:
		usage()
	}
}

func checkStorage(ctx context.Context) error {
	if strings.TrimSpace(os.Getenv("S3_ENDPOINT")) == "" {
		return fmt.Errorf("S3_ENDPOINT is required")
	}
	formalBucket := envOrDefault("S3_BUCKET", "stagepilot")
	stagingBucket := envOrDefault("S3_STAGING_BUCKET", formalBucket+"-staging")
	if formalBucket == stagingBucket {
		return fmt.Errorf("S3_STAGING_BUCKET must be separate from S3_BUCKET")
	}
	client, err := objectstore.NewMinIO(objectstore.MinIOConfig{
		Endpoint: os.Getenv("S3_ENDPOINT"), AccessKey: os.Getenv("S3_ACCESS_KEY"), SecretKey: os.Getenv("S3_SECRET_KEY"),
		Secure: os.Getenv("S3_USE_SSL") == "true", Region: envOrDefault("S3_REGION", "us-east-1"), PathStyle: os.Getenv("S3_PATH_STYLE") == "true",
	})
	if err != nil {
		return err
	}
	for _, bucket := range []string{formalBucket, stagingBucket} {
		status, err := client.BucketVersioningStatus(ctx, bucket)
		if err != nil {
			return fmt.Errorf("inspect bucket %q versioning: %w", bucket, err)
		}
		if err := validateBucketVersioningDisabled(bucket, status); err != nil {
			return err
		}
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{
		"formal_bucket": formalBucket, "staging_bucket": stagingBucket, "versioning": "disabled",
	})
}

func validateBucketVersioningDisabled(bucket, status string) error {
	if status != "" {
		return fmt.Errorf("object bucket %q must have versioning disabled (status %q)", bucket, status)
	}
	return nil
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func requireOperatorFields(opts options) {
	if err := validateOperatorFields(opts); err != nil {
		fatal("%v", err)
	}
}

func validateOperatorFields(opts options) error {
	if strings.TrimSpace(opts.actor) == "" || strings.TrimSpace(opts.reason) == "" || strings.TrimSpace(opts.caseRef) == "" {
		return fmt.Errorf("--actor, --reason, and --case are required for retention changes")
	}
	return nil
}

func validatePurgeConfirmation(fileID, confirmation string) error {
	if fileID == "" || confirmation != fileID {
		return fmt.Errorf("permanent purge requires --confirm to exactly match --file")
	}
	return nil
}

func show(ctx context.Context, db *pgxpool.Pool, opts options) error {
	if opts.fileID == "" {
		var heldBytes int64
		var activeHolds, pendingPurges, failedPurges int64
		err := db.QueryRow(ctx, `SELECT
			(SELECT COALESCE(SUM(v.size_bytes),0) FROM file_retention_holds h
			 JOIN file_versions v ON v.workspace_id=h.workspace_id AND v.file_id=h.file_id
			 WHERE h.workspace_id=$1 AND h.released_at IS NULL AND v.object_purged_at IS NULL),
			(SELECT COUNT(*) FROM file_retention_holds h WHERE h.workspace_id=$1 AND h.released_at IS NULL),
			(SELECT COUNT(*) FROM file_purge_tasks t WHERE t.workspace_id=$1 AND t.status IN ('pending','leased')),
			(SELECT COUNT(*) FROM file_purge_tasks t WHERE t.workspace_id=$1 AND t.status='pending'
			 AND t.attempts>0 AND t.available_at>NOW())`, opts.workspaceID).Scan(&heldBytes, &activeHolds, &pendingPurges, &failedPurges)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{
			"workspace_id": opts.workspaceID, "held_physical_bytes": heldBytes,
			"active_holds": activeHolds, "pending_purge_versions": pendingPurges,
			"retry_wait_versions": failedPurges,
		})
	}
	var deletedAt, purgeAfter *time.Time
	var purged, held bool
	var heldBytes int64
	var pending, leased, failed int64
	err := db.QueryRow(ctx, `SELECT f.deleted_at,f.purge_after,
		NOT EXISTS(SELECT 1 FROM file_versions v WHERE v.file_id=f.id AND v.object_purged_at IS NULL),
		EXISTS(SELECT 1 FROM file_retention_holds h WHERE h.workspace_id=f.workspace_id AND h.file_id=f.id AND h.released_at IS NULL),
		COALESCE((SELECT SUM(v.size_bytes) FROM file_versions v WHERE v.workspace_id=f.workspace_id AND v.file_id=f.id AND v.object_purged_at IS NULL),0),
		(SELECT COUNT(*) FROM file_purge_tasks t WHERE t.file_id=f.id AND t.status='pending'),
		(SELECT COUNT(*) FROM file_purge_tasks t WHERE t.file_id=f.id AND t.status='leased'),
		(SELECT COUNT(*) FROM file_purge_tasks t WHERE t.file_id=f.id AND t.status='pending' AND t.attempts>0)
		FROM files f WHERE f.workspace_id=$1 AND f.id=$2`, opts.workspaceID, opts.fileID).
		Scan(&deletedAt, &purgeAfter, &purged, &held, &heldBytes, &pending, &leased, &failed)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{
		"workspace_id": opts.workspaceID, "file_id": opts.fileID, "deleted_at": deletedAt,
		"restore_until": purgeAfter, "content_purged": purged, "retention_held": held,
		"retained_physical_bytes": heldBytes, "pending_purge_versions": pending,
		"leased_purge_versions": leased, "retrying_purge_versions": failed,
	})
}

func lockWorkspaceFile(ctx context.Context, tx pgx.Tx, opts options) (*time.Time, error) {
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_accounts(workspace_id) VALUES($1) ON CONFLICT DO NOTHING`, opts.workspaceID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, opts.workspaceID); err != nil {
		return nil, err
	}
	var deletedAt *time.Time
	err := tx.QueryRow(ctx, `SELECT deleted_at FROM files WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, opts.workspaceID, opts.fileID).Scan(&deletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("file not found in Workspace")
	}
	return deletedAt, err
}

func placeHold(ctx context.Context, db *pgxpool.Pool, opts options) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := lockWorkspaceFile(ctx, tx, opts); err != nil {
		return err
	}
	var versions int64
	var purged bool
	var leased bool
	if err := tx.QueryRow(ctx, `SELECT COUNT(*),COALESCE(BOOL_OR(object_purged_at IS NOT NULL),FALSE)
		FROM file_versions WHERE workspace_id=$1 AND file_id=$2`, opts.workspaceID, opts.fileID).Scan(&versions, &purged); err != nil {
		return err
	}
	if versions == 0 || purged {
		return fmt.Errorf("cannot guarantee retention: file has no versions or some version content is already purged")
	}
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM file_purge_tasks WHERE file_id=$1 AND status='leased')`, opts.fileID).Scan(&leased); err != nil {
		return err
	}
	if leased {
		return fmt.Errorf("purge is already in progress")
	}
	var active bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM file_retention_holds WHERE workspace_id=$1 AND file_id=$2 AND released_at IS NULL)`, opts.workspaceID, opts.fileID).Scan(&active); err != nil {
		return err
	}
	if active {
		return fmt.Errorf("file already has an active retention hold")
	}
	if _, err := tx.Exec(ctx, `UPDATE file_purge_tasks SET status='cancelled',lease_owner='',lease_until=NULL,
		last_error='cancelled_by_retention_hold',updated_at=NOW()
		WHERE workspace_id=$1 AND file_id=$2 AND status='pending'`, opts.workspaceID, opts.fileID); err != nil {
		return err
	}
	holdID, err := newID()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO file_retention_holds(id,workspace_id,file_id,actor_label,reason,case_reference)
		VALUES($1,$2,$3,$4,$5,$6)`, holdID, opts.workspaceID, opts.fileID, strings.TrimSpace(opts.actor), strings.TrimSpace(opts.reason), strings.TrimSpace(opts.caseRef)); err != nil {
		return err
	}
	if err := appendEvent(ctx, tx, opts, "retention_hold_placed", "file", opts.fileID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func releaseHold(ctx context.Context, db *pgxpool.Pool, opts options) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := lockWorkspaceFile(ctx, tx, opts); err != nil {
		return err
	}
	var holdID string
	err = tx.QueryRow(ctx, `SELECT id FROM file_retention_holds WHERE workspace_id=$1 AND file_id=$2 AND released_at IS NULL FOR UPDATE`, opts.workspaceID, opts.fileID).Scan(&holdID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("file has no active retention hold")
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE file_retention_holds SET released_at=NOW(),released_by=$2,release_reason=$3,release_case_reference=$4 WHERE id=$1`, holdID, strings.TrimSpace(opts.actor), strings.TrimSpace(opts.reason), strings.TrimSpace(opts.caseRef)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE file_purge_tasks t SET status='pending',available_at=NOW(),lease_owner='',lease_until=NULL,
		last_error='',updated_at=NOW()
		FROM files f WHERE t.workspace_id=$1 AND t.file_id=$2 AND f.workspace_id=t.workspace_id AND f.id=t.file_id
		AND t.status='cancelled' AND (
			t.cause='operator_requested' OR
			(t.cause='retention_expired' AND f.deleted_at IS NOT NULL
			 AND COALESCE(f.purge_after,f.deleted_at+INTERVAL '30 days')<=NOW())
		)`, opts.workspaceID, opts.fileID); err != nil {
		return err
	}
	if err := appendEvent(ctx, tx, opts, "retention_hold_released", "file", opts.fileID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func requestPurge(ctx context.Context, db *pgxpool.Pool, opts options) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	deletedAt, err := lockWorkspaceFile(ctx, tx, opts)
	if err != nil {
		return err
	}
	if deletedAt == nil {
		return fmt.Errorf("only a soft-deleted file may be permanently purged")
	}
	var held bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM file_retention_holds WHERE workspace_id=$1 AND file_id=$2 AND released_at IS NULL)`, opts.workspaceID, opts.fileID).Scan(&held); err != nil {
		return err
	}
	if held {
		return fmt.Errorf("file is protected by an active retention hold")
	}
	if err := appendEvent(ctx, tx, opts, "permanent_purge_requested", "file", opts.fileID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO file_purge_tasks(workspace_id,file_id,version_id,cause,actor_label,reason,case_reference)
		SELECT v.workspace_id,v.file_id,v.id,'operator_requested',$3,$4,$5
		FROM file_versions v WHERE v.workspace_id=$1 AND v.file_id=$2 AND v.object_purged_at IS NULL
		ON CONFLICT(version_id) DO UPDATE SET cause='operator_requested',actor_label=EXCLUDED.actor_label,
			reason=EXCLUDED.reason,case_reference=EXCLUDED.case_reference,status='pending',available_at=NOW(),
			lease_owner='',lease_until=NULL,last_error='',updated_at=NOW()
		WHERE file_purge_tasks.status IN ('pending','cancelled')`, opts.workspaceID, opts.fileID, strings.TrimSpace(opts.actor), strings.TrimSpace(opts.reason), strings.TrimSpace(opts.caseRef))
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func appendEvent(ctx context.Context, tx pgx.Tx, opts options, eventType, refType, refID string) error {
	details, err := json.Marshal(map[string]string{"reason": strings.TrimSpace(opts.reason), "case_reference": strings.TrimSpace(opts.caseRef)})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO workspace_storage_events(workspace_id,actor_label,event_type,reference_type,reference_id,details)
		VALUES($1,$2,$3,$4,$5,$6::jsonb)`, opts.workspaceID, strings.TrimSpace(opts.actor), eventType, refType, refID, details)
	return err
}

func newID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "ret_" + hex.EncodeToString(value[:]), nil
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: storage-retention <check-storage|show|hold|release-hold|purge> [--workspace ID --file ID --actor OPERATOR --reason TEXT --case REF --confirm FILE_ID]")
	os.Exit(2)
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
