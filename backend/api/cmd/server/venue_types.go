package main

import (
	"context"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type venueType struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspace_id"`
	SystemKey       *string   `json:"system_key"`
	Name            string    `json:"name"`
	Color           string    `json:"color"`
	SortOrder       int       `json:"sort_order"`
	IsSystemDefault bool      `json:"is_system_default"`
	IsActive        bool      `json:"is_active"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	VenueCount      int       `json:"venue_count"`
}

func valueOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func (app *application) resolveVenueType(ctx context.Context, workspaceID string, id *string, legacy string) (string, string, error) {
	var query string
	var arg string
	if id != nil && strings.TrimSpace(*id) != "" {
		query = `SELECT id,COALESCE(system_key,'other') FROM venue_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND is_active`
		arg = *id
	} else {
		key := legacy
		if key == "hall" {
			key = "auditorium"
		}
		if key == "" {
			key = "other"
		}
		query = `SELECT id,COALESCE(system_key,'other') FROM venue_types WHERE system_key=$1 AND workspace_id=$2 AND deleted_at IS NULL AND is_active`
		arg = key
	}
	var resolved, key string
	if err := app.db.QueryRow(ctx, query, arg, workspaceID).Scan(&resolved, &key); err != nil {
		return "", "", err
	}
	if key == "auditorium" {
		key = "hall"
	}
	return resolved, key, nil
}

func (app *application) listVenueTypes(w http.ResponseWriter, r *http.Request) {
	a := resourceAccess(r)
	where := []string{"v.workspace_id=$1", "v.deleted_at IS NULL"}
	args := []any{a.WorkspaceID}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+q+"%")
		where = append(where, "v.name ILIKE $"+strconv.Itoa(len(args)))
	}
	if s := r.URL.Query().Get("status"); s == "active" || s == "inactive" {
		args = append(args, s == "active")
		where = append(where, "v.is_active=$"+strconv.Itoa(len(args)))
	}
	rows, err := app.db.Query(r.Context(), `SELECT v.id,v.workspace_id,v.system_key,v.name,v.color,v.sort_order,v.is_system_default,v.is_active,v.created_at,v.updated_at,(SELECT count(*) FROM venues n WHERE n.workspace_id=v.workspace_id AND n.venue_type_id=v.id AND n.deleted_at IS NULL) FROM venue_types v WHERE `+strings.Join(where, " AND ")+` ORDER BY v.sort_order,v.name`, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	out := []venueType{}
	for rows.Next() {
		var x venueType
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.SystemKey, &x.Name, &x.Color, &x.SortOrder, &x.IsSystemDefault, &x.IsActive, &x.CreatedAt, &x.UpdatedAt, &x.VenueCount); err != nil {
			serverError(w, err)
			return
		}
		out = append(out, x)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, resourceList[venueType]{Items: out, Total: len(out)})
}
func (app *application) createVenueType(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name, Color string
		IsActive    *bool `json:"is_active"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, ok := validName(w, in.Name, "场地类型名称")
	if !ok {
		return
	}
	a := resourceAccess(r)
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	var x venueType
	err := app.db.QueryRow(r.Context(), `INSERT INTO venue_types(id,workspace_id,name,color,sort_order,is_active,created_by) VALUES($1,$2,$3,COALESCE(NULLIF($4,''),'#64748b'),COALESCE((SELECT max(sort_order)+1 FROM venue_types WHERE workspace_id=$2),0),$5,$6) RETURNING id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_at,updated_at`, newID(), a.WorkspaceID, name, in.Color, active, a.UserID).Scan(&x.ID, &x.WorkspaceID, &x.SystemKey, &x.Name, &x.Color, &x.SortOrder, &x.IsSystemDefault, &x.IsActive, &x.CreatedAt, &x.UpdatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "venue_types_workspace_name_unique") {
			errorJSON(w, 409, "duplicate_name", "场地类型名称已存在")
			return
		}
		serverError(w, err)
		return
	}
	writeJSON(w, 201, x)
}
func (app *application) updateVenueType(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name, Color *string
		IsActive    *bool `json:"is_active"`
		SortOrder   *int  `json:"sort_order"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	a := resourceAccess(r)
	id := r.PathValue("venueTypeId")
	if in.Name != nil {
		if _, ok := validName(w, *in.Name, "场地类型名称"); !ok {
			return
		}
	}
	_, err := app.db.Exec(r.Context(), `UPDATE venue_types SET name=COALESCE($1,name),color=COALESCE(NULLIF($2,''),color),is_active=COALESCE($3,is_active),sort_order=COALESCE($4,sort_order),updated_at=NOW() WHERE id=$5 AND workspace_id=$6 AND deleted_at IS NULL`, nullableTrimmed(in.Name), in.Color, in.IsActive, in.SortOrder, id, a.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	app.listVenueTypes(w, r)
}
func (app *application) reorderVenueTypes(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Items []struct {
			ID        string `json:"id"`
			SortOrder int    `json:"sort_order"`
		} `json:"items"`
	}
	if !decodeJSON(w, r, &in) || len(in.Items) == 0 {
		errorJSON(w, 400, "invalid_input", "排序列表不能为空")
		return
	}
	a := resourceAccess(r)
	seen := map[string]bool{}
	for index, item := range in.Items {
		if item.ID == "" || seen[item.ID] || item.SortOrder < 0 || item.SortOrder != index {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "场地类型排序列表无效")
			return
		}
		seen[item.ID] = true
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	rows, err := tx.Query(r.Context(), `SELECT id FROM venue_types WHERE workspace_id=$1 AND deleted_at IS NULL FOR UPDATE`, a.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	current := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		current[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	if len(current) != len(in.Items) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表必须包含当前工作空间的全部场地类型")
		return
	}
	for _, item := range in.Items {
		if !current[item.ID] {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表包含未知场地类型")
			return
		}
	}
	for _, item := range in.Items {
		if _, err = tx.Exec(r.Context(), `UPDATE venue_types SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3 AND deleted_at IS NULL AND sort_order IS DISTINCT FROM $1`, item.SortOrder, item.ID, a.WorkspaceID); err != nil {
			serverError(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.listVenueTypes(w, r)
}
func (app *application) deleteVenueType(w http.ResponseWriter, r *http.Request) {
	a := resourceAccess(r)
	id := r.PathValue("venueTypeId")
	var sys bool
	var count int
	if err := app.db.QueryRow(r.Context(), `SELECT is_system_default,(SELECT count(*) FROM venues n WHERE n.workspace_id=v.workspace_id AND n.venue_type_id=v.id AND n.deleted_at IS NULL) FROM venue_types v WHERE v.id=$1 AND v.workspace_id=$2 AND v.deleted_at IS NULL`, id, a.WorkspaceID).Scan(&sys, &count); err == pgx.ErrNoRows {
		resourceNotFound(w, "场地类型")
		return
	} else if err != nil {
		serverError(w, err)
		return
	}
	if sys {
		errorJSON(w, 409, "system_default_protected", "系统默认场地类型不能删除")
		return
	}
	if count > 0 {
		errorJSON(w, 409, "venue_type_in_use", "该场地类型仍被场地使用")
		return
	}
	if _, err := app.db.Exec(r.Context(), `UPDATE venue_types SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2`, id, a.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
