package main

import (
	"net/http"
	"strings"
	"time"
)

func (app *application) listMyWorkspaceStorage(w http.ResponseWriter, r *http.Request) {
	rows, err := app.db.Query(r.Context(), `SELECT w.id,w.name,a.quota_limit_bytes,
		COALESCE(a.quota_used_bytes,0),COALESCE(a.quota_reserved_bytes,0),
		COALESCE(a.physical_used_bytes,0),COALESCE(a.physical_reserved_bytes,0),a.physical_observed_bytes,a.physical_observed_at,
		COALESCE(a.uploads_blocked,FALSE)
		FROM workspace_memberships m JOIN workspaces w ON w.id=m.workspace_id AND w.deleted_at IS NULL
		LEFT JOIN workspace_storage_accounts a ON a.workspace_id=w.id
		WHERE m.user_id=$1 AND m.status='active' ORDER BY w.name,w.id`, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name string
		var quotaLimit *int64
		var used, reserved, tracked, physicalReserved int64
		var observed *int64
		var observedAt *time.Time
		var blocked bool
		if err := rows.Scan(&id, &name, &quotaLimit, &used, &reserved, &tracked, &physicalReserved, &observed, &observedAt, &blocked); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, map[string]any{
			"workspace_id": id, "workspace_name": name,
			"quota_limit_bytes": quotaLimit, "quota_used_bytes": used,
			"quota_reserved_bytes":   reserved,
			"physical_tracked_bytes": tracked, "physical_reserved_bytes": physicalReserved,
			"physical_observed_bytes": observed,
			"physical_observed_at":    observedAt,
			"physical_limit_bytes":    app.storagePhysicalLimit(), "uploads_blocked": blocked,
		})
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (app *application) storagePhysicalLimit() int64 {
	if app.storage == nil {
		return 0
	}
	return app.storage.physicalMaxBytes
}

func (app *application) listDeletedFiles(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	productionValue := strings.TrimSpace(r.URL.Query().Get("production_id"))
	var productionID *string
	if productionValue != "" && productionValue != "workspace" {
		productionID = &productionValue
	}
	if !app.authorizeFileScope(w, r, workspaceID, productionID, "delete") {
		return
	}
	query := `SELECT f.id,f.filename,f.content_type,f.size_bytes,f.deleted_at,f.purge_after,
		NOT EXISTS(SELECT 1 FROM file_versions v WHERE v.file_id=f.id AND v.object_purged_at IS NULL) AS content_purged
		FROM files f WHERE f.workspace_id=$1 AND f.deleted_at IS NOT NULL AND f.access_mode='library'
		`
	args := []any{workspaceID}
	if productionID == nil {
		query += ` AND f.production_id IS NULL`
	} else {
		query += ` AND f.production_id=$2`
		args = append(args, *productionID)
	}
	query += ` ORDER BY f.deleted_at DESC,f.id`
	rows, err := app.db.Query(r.Context(), query, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, filename, contentType string
		var size int64
		var deletedAt time.Time
		var purgeAfter *time.Time
		var purged bool
		if err := rows.Scan(&id, &filename, &contentType, &size, &deletedAt, &purgeAfter, &purged); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, map[string]any{"id": id, "filename": filename, "content_type": contentType,
			"size_bytes": size, "deleted_at": deletedAt, "content_purged": purged,
			"restore_until": purgeAfter})
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (app *application) restoreFile(w http.ResponseWriter, r *http.Request) {
	workspaceID, fileID := r.PathValue("id"), r.PathValue("fileId")
	var productionID *string
	err := app.db.QueryRow(r.Context(), `SELECT production_id FROM files WHERE id=$1 AND workspace_id=$2
		AND access_mode='library' AND deleted_at IS NOT NULL`, fileID, workspaceID).Scan(&productionID)
	if err != nil || !app.authorizeFileScope(w, r, workspaceID, productionID, "delete") {
		if err != nil {
			errorJSON(w, http.StatusNotFound, "file_not_found", "回收站文件不存在")
		}
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if err := ensureWorkspaceStorageAccount(r.Context(), tx, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `SELECT 1 FROM workspace_storage_accounts WHERE workspace_id=$1 FOR UPDATE`, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	var deletedAt time.Time
	var purgeAfter *time.Time
	var purged bool
	err = tx.QueryRow(r.Context(), `SELECT f.deleted_at,f.purge_after,NOT EXISTS(SELECT 1 FROM file_versions v
		WHERE v.file_id=f.id AND v.object_purged_at IS NULL)
		FROM files f WHERE f.id=$1 AND f.workspace_id=$2 AND f.deleted_at IS NOT NULL FOR UPDATE`, fileID, workspaceID).Scan(&deletedAt, &purgeAfter, &purged)
	if err != nil || purged || purgeAfter == nil || !purgeAfter.After(time.Now()) {
		errorJSON(w, http.StatusConflict, "restore_window_expired", "文件已超过恢复期限，内容已清除或无法恢复")
		return
	}
	if err := chargeRestoredFileTx(r.Context(), tx, workspaceID, fileID, claims(r).Subject); err != nil {
		if !writeFileStorageError(w, err) {
			serverError(w, err)
		}
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE files SET deleted_at=NULL,purge_after=NULL,updated_at=NOW()
		WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NOT NULL`, fileID, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"file_id": fileID, "status": "restored"})
}
