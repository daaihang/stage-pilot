package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	command := os.Args[1]
	flags := flag.NewFlagSet(command, flag.ExitOnError)
	workspaceID := flags.String("workspace", "", "Workspace ID")
	actor := flags.String("actor", "", "Operator identifier recorded in the audit log")
	bytes := flags.Int64("bytes", 0, "Workspace quota in bytes")
	_ = flags.Parse(os.Args[2:])
	if strings.TrimSpace(*workspaceID) == "" {
		fatal("--workspace is required")
	}
	if command != "show" && strings.TrimSpace(*actor) == "" {
		fatal("--actor is required for quota changes")
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
		show(ctx, pool, *workspaceID)
	case "set":
		if *bytes < 0 {
			fatal("--bytes must be zero or greater")
		}
		change(ctx, pool, *workspaceID, *actor, bytes, false)
	case "unset":
		change(ctx, pool, *workspaceID, *actor, nil, true)
	default:
		usage()
	}
}

func show(ctx context.Context, pool *pgxpool.Pool, workspaceID string) {
	var name string
	var quotaLimit *int64
	var used, reserved, physicalUsed, physicalReserved, heldPhysical int64
	var observed *int64
	var observedAt *time.Time
	var blocked bool
	err := pool.QueryRow(ctx, `SELECT w.name,a.quota_limit_bytes,COALESCE(a.quota_used_bytes,0),COALESCE(a.quota_reserved_bytes,0),
		COALESCE(a.physical_used_bytes,0),COALESCE(a.physical_reserved_bytes,0),
		COALESCE((SELECT SUM(v.size_bytes) FROM file_retention_holds h JOIN file_versions v
			ON v.workspace_id=h.workspace_id AND v.file_id=h.file_id
			WHERE h.workspace_id=w.id AND h.released_at IS NULL AND v.object_purged_at IS NULL),0),
		a.physical_observed_bytes,a.physical_observed_at,COALESCE(a.uploads_blocked,FALSE)
		FROM workspaces w LEFT JOIN workspace_storage_accounts a ON a.workspace_id=w.id WHERE w.id=$1`, workspaceID).
		Scan(&name, &quotaLimit, &used, &reserved, &physicalUsed, &physicalReserved, &heldPhysical, &observed, &observedAt, &blocked)
	if err != nil {
		fatal("read Workspace storage account: %v", err)
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
		"workspace_id": workspaceID, "workspace_name": name, "quota_limit_bytes": quotaLimit,
		"quota_used_bytes": used, "quota_reserved_bytes": reserved,
		"physical_tracked_bytes": physicalUsed, "physical_reserved_bytes": physicalReserved,
		"held_physical_bytes":     heldPhysical,
		"physical_observed_bytes": observed, "physical_observed_at": observedAt, "uploads_blocked": blocked,
	})
}

func change(ctx context.Context, pool *pgxpool.Pool, workspaceID, actor string, quota *int64, unset bool) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		fatal("begin quota change: %v", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_accounts(workspace_id) VALUES($1) ON CONFLICT DO NOTHING`, workspaceID); err != nil {
		fatal("ensure Workspace storage account: %v", err)
	}
	var previous *int64
	err = tx.QueryRow(ctx, `SELECT quota_limit_bytes FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID).Scan(&previous)
	if errors.Is(err, pgx.ErrNoRows) {
		fatal("Workspace storage account not found; apply database migrations first")
	}
	if err != nil {
		fatal("lock Workspace storage account: %v", err)
	}
	if unset {
		quota = nil
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace_storage_accounts SET quota_limit_bytes=$2,updated_at=NOW() WHERE workspace_id=$1`, workspaceID, quota); err != nil {
		fatal("update quota: %v", err)
	}
	details, _ := json.Marshal(map[string]any{"previous_limit_bytes": previous, "new_limit_bytes": quota})
	if _, err := tx.Exec(ctx, `INSERT INTO workspace_storage_events(workspace_id,actor_label,event_type,details)
		VALUES($1,$2,'quota_limit_changed',$3::jsonb)`, workspaceID, strings.TrimSpace(actor), details); err != nil {
		fatal("record quota audit event: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		fatal("commit quota change: %v", err)
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"workspace_id": workspaceID, "quota_limit_bytes": quota})
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: storage-quota <show|set|unset> --workspace ID [--bytes N --actor OPERATOR]")
	os.Exit(2)
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
