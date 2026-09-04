package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

var fileTypeScopes = map[string]bool{
	"workspace": true, "membership": true, "person": true, "organization": true,
	"venue": true, "venue_space": true, "equipment": true, "program": true,
	"production": true, "file_library": true,
}

type fileType struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspace_id"`
	Scope           string    `json:"scope"`
	TemplateKey     *string   `json:"template_key"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	SortOrder       int       `json:"sort_order"`
	IsSystemDefault bool      `json:"is_system_default"`
	IsActive        bool      `json:"is_active"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func validFileTypeScope(w http.ResponseWriter, scope string) bool {
	if !fileTypeScopes[scope] {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "文件类型范围无效")
		return false
	}
	return true
}

func fileTypeIsUncategorized(templateKey *string) bool {
	return templateKey != nil && strings.HasSuffix(*templateKey, ".uncategorized")
}

func fileTypeDescription(w http.ResponseWriter, value string) (string, bool) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > 500 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "文件类型描述不能超过 500 字")
		return "", false
	}
	return value, true
}

func (app *application) listFileTypes(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope != "" && !validFileTypeScope(w, scope) {
		return
	}
	where := []string{"f.workspace_id=$1", "f.deleted_at IS NULL"}
	args := []any{access.WorkspaceID}
	if scope != "" {
		args = append(args, scope)
		where = append(where, "f.scope=$"+strconv.Itoa(len(args)))
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+q+"%")
		placeholder := "$" + strconv.Itoa(len(args))
		where = append(where, "(f.name ILIKE "+placeholder+" OR f.description ILIKE "+placeholder+")")
	}
	if status := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status"))); status == "active" || status == "inactive" {
		args = append(args, status == "active")
		where = append(where, "f.is_active=$"+strconv.Itoa(len(args)))
	} else if status != "" && status != "all" {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "文件类型状态无效")
		return
	}
	sortKey := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sort")))
	if sortKey == "" {
		sortKey = "sort_order"
	}
	sortColumn, ok := map[string]string{"sort_order": "f.sort_order", "name": "f.name", "updated_at": "f.updated_at"}[sortKey]
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "文件类型排序字段无效")
		return
	}
	directionKey := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("direction")))
	if directionKey == "" {
		directionKey = "asc"
	}
	if directionKey != "asc" && directionKey != "desc" {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "文件类型排序方向无效")
		return
	}
	direction := "ASC"
	if directionKey == "desc" {
		direction = "DESC"
	}
	orderPrefix := "f.scope,"
	if scope != "" {
		orderPrefix = ""
	}
	rows, err := app.db.Query(r.Context(), `SELECT f.id,f.workspace_id,f.scope,f.template_key,f.name,f.description,f.sort_order,f.is_system_default,f.is_active,f.created_at,f.updated_at
		FROM file_types f WHERE `+strings.Join(where, " AND ")+` ORDER BY `+orderPrefix+sortColumn+` `+direction+`,f.id`, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []fileType{}
	for rows.Next() {
		var item fileType
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Scope, &item.TemplateKey, &item.Name, &item.Description, &item.SortOrder, &item.IsSystemDefault, &item.IsActive, &item.CreatedAt, &item.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resourceList[fileType]{Items: items, Total: len(items)})
}

type fileTypePayload struct {
	Scope       string  `json:"scope"`
	Name        *string `json:"name"`
	Description *string `json:"description"`
	SortOrder   *int    `json:"sort_order"`
	IsActive    *bool   `json:"is_active"`
}

func (app *application) createFileType(w http.ResponseWriter, r *http.Request) {
	var in fileTypePayload
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Scope = strings.TrimSpace(in.Scope)
	if !validFileTypeScope(w, in.Scope) {
		return
	}
	name := ""
	if in.Name != nil {
		var ok bool
		name, ok = validName(w, *in.Name, "文件类型名称")
		if !ok {
			return
		}
	} else {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "文件类型名称不能为空")
		return
	}
	description := ""
	if in.Description != nil {
		var ok bool
		description, ok = fileTypeDescription(w, *in.Description)
		if !ok {
			return
		}
	}
	if in.SortOrder != nil && *in.SortOrder < 0 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序值不能小于 0")
		return
	}
	access := resourceAccess(r)
	isActive := true
	if in.IsActive != nil {
		isActive = *in.IsActive
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var sortOrder int
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	} else if err := tx.QueryRow(r.Context(), `SELECT COALESCE(MAX(sort_order),-1)+1 FROM file_types WHERE workspace_id=$1 AND scope=$2 AND deleted_at IS NULL AND (template_key IS NULL OR template_key NOT LIKE '%.uncategorized')`, access.WorkspaceID, in.Scope).Scan(&sortOrder); err != nil {
		serverError(w, err)
		return
	}
	var item fileType
	err = tx.QueryRow(r.Context(), `INSERT INTO file_types(id,workspace_id,scope,name,description,sort_order,is_system_default,is_active,created_by)
		VALUES($1,$2,$3,$4,$5,$6,FALSE,$7,$8)
		RETURNING id,workspace_id,scope,template_key,name,description,sort_order,is_system_default,is_active,created_at,updated_at`, newID(), access.WorkspaceID, in.Scope, name, description, sortOrder, isActive, access.UserID).Scan(&item.ID, &item.WorkspaceID, &item.Scope, &item.TemplateKey, &item.Name, &item.Description, &item.SortOrder, &item.IsSystemDefault, &item.IsActive, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		errorJSON(w, http.StatusConflict, "duplicate_name", "当前范围内已经存在同名文件类型")
		return
	}
	if err = normalizeFileTypeScopeOrder(r.Context(), tx, access.WorkspaceID, in.Scope, nil); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.QueryRow(r.Context(), `SELECT id,workspace_id,scope,template_key,name,description,sort_order,is_system_default,is_active,created_at,updated_at
		FROM file_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, item.ID, access.WorkspaceID).Scan(&item.ID, &item.WorkspaceID, &item.Scope, &item.TemplateKey, &item.Name, &item.Description, &item.SortOrder, &item.IsSystemDefault, &item.IsActive, &item.CreatedAt, &item.UpdatedAt); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (app *application) updateFileType(w http.ResponseWriter, r *http.Request) {
	var in fileTypePayload
	if !decodeJSON(w, r, &in) {
		return
	}
	access := resourceAccess(r)
	id := r.PathValue("fileTypeId")
	var current fileType
	err := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,scope,template_key,name,description,sort_order,is_system_default,is_active,created_at,updated_at FROM file_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, access.WorkspaceID).Scan(&current.ID, &current.WorkspaceID, &current.Scope, &current.TemplateKey, &current.Name, &current.Description, &current.SortOrder, &current.IsSystemDefault, &current.IsActive, &current.CreatedAt, &current.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "文件类型")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if in.Name != nil {
		if current.IsSystemDefault || current.TemplateKey != nil {
			errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认文件类型不能改名")
			return
		}
		name, ok := validName(w, *in.Name, "文件类型名称")
		if !ok {
			return
		}
		in.Name = &name
	}
	if in.Description != nil {
		description, ok := fileTypeDescription(w, *in.Description)
		if !ok {
			return
		}
		in.Description = &description
	}
	if in.SortOrder != nil && *in.SortOrder < 0 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序值不能小于 0")
		return
	}
	if fileTypeIsUncategorized(current.TemplateKey) && in.IsActive != nil && !*in.IsActive {
		errorJSON(w, http.StatusConflict, "uncategorized_protected", "未分类必须保持启用")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var item fileType
	err = tx.QueryRow(r.Context(), `UPDATE file_types SET name=COALESCE($1,name),description=COALESCE($2,description),sort_order=COALESCE($3,sort_order),is_active=COALESCE($4,is_active),updated_at=NOW()
		WHERE id=$5 AND workspace_id=$6 AND deleted_at IS NULL
		RETURNING id,workspace_id,scope,template_key,name,description,sort_order,is_system_default,is_active,created_at,updated_at`, in.Name, in.Description, in.SortOrder, in.IsActive, id, access.WorkspaceID).Scan(&item.ID, &item.WorkspaceID, &item.Scope, &item.TemplateKey, &item.Name, &item.Description, &item.SortOrder, &item.IsSystemDefault, &item.IsActive, &item.CreatedAt, &item.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "文件类型")
		return
	}
	if err != nil {
		errorJSON(w, http.StatusConflict, "duplicate_name", "当前范围内已经存在同名文件类型")
		return
	}
	if err = normalizeFileTypeScopeOrder(r.Context(), tx, access.WorkspaceID, item.Scope, nil); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.QueryRow(r.Context(), `SELECT sort_order,is_active,updated_at FROM file_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, access.WorkspaceID).Scan(&item.SortOrder, &item.IsActive, &item.UpdatedAt); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (app *application) deleteFileType(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	id := r.PathValue("fileTypeId")
	var systemDefault bool
	var templateKey *string
	err := app.db.QueryRow(r.Context(), `SELECT is_system_default,template_key FROM file_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, access.WorkspaceID).Scan(&systemDefault, &templateKey)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "文件类型")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if systemDefault || templateKey != nil || fileTypeIsUncategorized(templateKey) {
		errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认文件类型不能删除")
		return
	}
	if _, err = app.db.Exec(r.Context(), `UPDATE file_types SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, access.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type fileTypeOrderPayload struct {
	Scope string `json:"scope"`
	Items []struct {
		ID        string `json:"id"`
		SortOrder int    `json:"sort_order"`
	} `json:"items"`
}

func validateFileTypeOrder(w http.ResponseWriter, ctx context.Context, tx pgx.Tx, workspaceID, scope string, items []struct {
	ID        string `json:"id"`
	SortOrder int    `json:"sort_order"`
}) bool {
	if len(items) == 0 || !validFileTypeScope(w, scope) {
		if len(items) == 0 {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表不能为空")
		}
		return false
	}
	seen := map[string]bool{}
	for index, item := range items {
		if item.ID == "" || seen[item.ID] || item.SortOrder < 0 || item.SortOrder != index {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "文件类型排序列表无效")
			return false
		}
		seen[item.ID] = true
	}
	rows, err := tx.Query(ctx, `SELECT id,template_key FROM file_types WHERE workspace_id=$1 AND scope=$2 AND deleted_at IS NULL FOR UPDATE`, workspaceID, scope)
	if err != nil {
		serverError(w, err)
		return false
	}
	current := map[string]*string{}
	for rows.Next() {
		var id string
		var key *string
		if err := rows.Scan(&id, &key); err != nil {
			rows.Close()
			serverError(w, err)
			return false
		}
		current[id] = key
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return false
	}
	if len(current) != len(items) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表必须包含当前范围的全部文件类型")
		return false
	}
	uncategorizedID := ""
	for _, item := range items {
		key, ok := current[item.ID]
		if !ok {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表包含未知文件类型")
			return false
		}
		if fileTypeIsUncategorized(key) {
			uncategorizedID = item.ID
		}
	}
	if uncategorizedID != "" && items[len(items)-1].ID != uncategorizedID {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "未分类必须位于排序末尾")
		return false
	}
	return true
}

func (app *application) reorderFileTypes(w http.ResponseWriter, r *http.Request) {
	var in fileTypeOrderPayload
	if !decodeJSON(w, r, &in) {
		return
	}
	access := resourceAccess(r)
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if !validateFileTypeOrder(w, r.Context(), tx, access.WorkspaceID, strings.TrimSpace(in.Scope), in.Items) {
		return
	}
	for _, item := range in.Items {
		if _, err = tx.Exec(r.Context(), `UPDATE file_types SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3 AND deleted_at IS NULL AND sort_order IS DISTINCT FROM $1`, item.SortOrder, item.ID, access.WorkspaceID); err != nil {
			serverError(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	query := r.URL.Query()
	query.Set("scope", in.Scope)
	r.URL.RawQuery = query.Encode()
	app.listFileTypes(w, r)
}

func normalizeFileTypeScopeOrder(ctx context.Context, tx pgx.Tx, workspaceID, scope string, priority map[string]int) error {
	rows, err := tx.Query(ctx, `SELECT id,template_key,sort_order FROM file_types WHERE workspace_id=$1 AND scope=$2 AND deleted_at IS NULL ORDER BY sort_order,id FOR UPDATE`, workspaceID, scope)
	if err != nil {
		return err
	}
	type row struct {
		id    string
		key   *string
		order int
	}
	items := []row{}
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.id, &item.key, &item.order); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if priority != nil {
		sort.SliceStable(items, func(i, j int) bool {
			pi, iok := priority[items[i].id]
			pj, jok := priority[items[j].id]
			if iok && jok && pi != pj {
				return pi < pj
			}
			if iok != jok {
				return iok
			}
			return items[i].order < items[j].order || (items[i].order == items[j].order && items[i].id < items[j].id)
		})
	}
	uncategorized := []row{}
	regular := []row{}
	for _, item := range items {
		if fileTypeIsUncategorized(item.key) {
			uncategorized = append(uncategorized, item)
		} else {
			regular = append(regular, item)
		}
	}
	ordered := append(regular, uncategorized...)
	for index, item := range ordered {
		if _, err := tx.Exec(ctx, `UPDATE file_types SET sort_order=$1,is_active=CASE WHEN template_key LIKE '%.uncategorized' THEN TRUE ELSE is_active END,updated_at=CASE WHEN sort_order IS DISTINCT FROM $1 OR (template_key LIKE '%.uncategorized' AND is_active IS DISTINCT FROM TRUE) THEN NOW() ELSE updated_at END WHERE id=$2 AND workspace_id=$3 AND deleted_at IS NULL`, index, item.id, workspaceID); err != nil {
			return err
		}
	}
	return nil
}

func (app *application) restoreFileTypes(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Scope string `json:"scope"`
	}
	if !decodeJSON(w, r, &in) || !validFileTypeScope(w, strings.TrimSpace(in.Scope)) {
		return
	}
	access := resourceAccess(r)
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if err = seedFileTypes(r.Context(), tx, access.WorkspaceID, access.UserID); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE file_types SET deleted_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND scope=$2 AND deleted_at IS NULL AND template_key IS NULL`, access.WorkspaceID, in.Scope); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE file_types f SET name=t.name,description=t.description,sort_order=t.sort_order,is_active=t.is_active,deleted_at=NULL,updated_at=NOW()
		FROM file_type_templates t WHERE f.workspace_id=$1 AND f.scope=$2 AND f.template_key=t.key AND t.scope=f.scope`, access.WorkspaceID, in.Scope); err != nil {
		serverError(w, err)
		return
	}
	if err = normalizeFileTypeScopeOrder(r.Context(), tx, access.WorkspaceID, in.Scope, nil); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	query := r.URL.Query()
	query.Set("scope", in.Scope)
	r.URL.RawQuery = query.Encode()
	app.listFileTypes(w, r)
}

type fileTypeMigrationItem struct {
	LegacyID        string  `json:"legacy_id"`
	TemplateKey     *string `json:"template_key"`
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	SortOrder       int     `json:"sort_order"`
	IsSystemDefault bool    `json:"is_system_default"`
	IsActive        bool    `json:"is_active"`
	DeletedAt       *string `json:"deleted_at"`
}

func (app *application) migrateFileTypes(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Scopes map[string][]fileTypeMigrationItem `json:"scopes"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in.Scopes) == 0 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "迁移数据不能为空")
		return
	}
	access := resourceAccess(r)
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	migrated, skipped := 0, 0
	warnings := []string{}
	for scope, items := range in.Scopes {
		if !fileTypeScopes[scope] {
			warnings = append(warnings, fmt.Sprintf("忽略未知范围 %s", scope))
			skipped += len(items)
			continue
		}
		if err = seedFileTypes(r.Context(), tx, access.WorkspaceID, access.UserID); err != nil {
			serverError(w, err)
			return
		}
		rows, queryErr := tx.Query(r.Context(), `SELECT id,template_key,name FROM file_types WHERE workspace_id=$1 AND scope=$2 AND deleted_at IS NULL FOR UPDATE`, access.WorkspaceID, scope)
		if queryErr != nil {
			serverError(w, queryErr)
			return
		}
		type existing struct {
			id   string
			key  *string
			name string
		}
		existingByKey := map[string]existing{}
		existingByName := map[string]existing{}
		allExisting := []existing{}
		for rows.Next() {
			var item existing
			if queryErr = rows.Scan(&item.id, &item.key, &item.name); queryErr != nil {
				rows.Close()
				serverError(w, queryErr)
				return
			}
			allExisting = append(allExisting, item)
			if item.key != nil {
				existingByKey[*item.key] = item
			} else {
				existingByName[strings.ToLower(strings.TrimSpace(item.name))] = item
			}
		}
		rows.Close()
		if queryErr = rows.Err(); queryErr != nil {
			serverError(w, queryErr)
			return
		}
		priority := map[string]int{}
		seenNames := map[string]bool{}
		for index, legacy := range items {
			if legacy.DeletedAt != nil || strings.TrimSpace(legacy.Name) == "" {
				skipped++
				continue
			}
			name := strings.TrimSpace(legacy.Name)
			if utf8.RuneCountInString(name) > 120 || utf8.RuneCountInString(strings.TrimSpace(legacy.Description)) > 500 {
				warnings = append(warnings, fmt.Sprintf("忽略无效文件类型 %s/%s", scope, name))
				skipped++
				continue
			}
			nameKey := strings.ToLower(name)
			if seenNames[nameKey] {
				warnings = append(warnings, fmt.Sprintf("忽略重复文件类型 %s/%s", scope, name))
				skipped++
				continue
			}
			seenNames[nameKey] = true
			if legacy.IsSystemDefault {
				if legacy.TemplateKey == nil || !strings.HasPrefix(*legacy.TemplateKey, scope+".") {
					warnings = append(warnings, fmt.Sprintf("忽略未知系统模板 %s/%s", scope, name))
					skipped++
					continue
				}
				current, ok := existingByKey[*legacy.TemplateKey]
				if !ok {
					warnings = append(warnings, fmt.Sprintf("找不到系统模板 %s", *legacy.TemplateKey))
					skipped++
					continue
				}
				active := legacy.IsActive
				if fileTypeIsUncategorized(legacy.TemplateKey) {
					active = true
				}
				if _, queryErr = tx.Exec(r.Context(), `UPDATE file_types SET description=$1,is_active=$2,sort_order=$3,updated_at=NOW() WHERE id=$4 AND workspace_id=$5 AND deleted_at IS NULL`, strings.TrimSpace(legacy.Description), active, legacy.SortOrder, current.id, access.WorkspaceID); queryErr != nil {
					serverError(w, queryErr)
					return
				}
				priority[current.id] = index
				migrated++
				continue
			}
			current, found := existingByName[nameKey]
			active := legacy.IsActive
			if found {
				if _, queryErr = tx.Exec(r.Context(), `UPDATE file_types SET description=$1,is_active=$2,sort_order=$3,updated_at=NOW() WHERE id=$4 AND workspace_id=$5 AND deleted_at IS NULL AND template_key IS NULL`, strings.TrimSpace(legacy.Description), active, legacy.SortOrder, current.id, access.WorkspaceID); queryErr != nil {
					serverError(w, queryErr)
					return
				}
				priority[current.id] = index
				migrated++
				continue
			}
			var id string
			if queryErr = tx.QueryRow(r.Context(), `INSERT INTO file_types(id,workspace_id,scope,name,description,sort_order,is_system_default,is_active,created_by) VALUES($1,$2,$3,$4,$5,$6,FALSE,$7,$8) RETURNING id`, newID(), access.WorkspaceID, scope, name, strings.TrimSpace(legacy.Description), legacy.SortOrder, active, access.UserID).Scan(&id); queryErr != nil {
				warnings = append(warnings, fmt.Sprintf("无法导入文件类型 %s/%s", scope, name))
				skipped++
				continue
			}
			priority[id] = index
			migrated++
		}
		// Keep cloud-only custom rows, but place them after the imported local
		// snapshot by assigning a large temporary order before normalization.
		for index, item := range allExisting {
			if item.key == nil {
				if _, imported := priority[item.id]; !imported {
					if _, queryErr = tx.Exec(r.Context(), `UPDATE file_types SET sort_order=$1 WHERE id=$2 AND workspace_id=$3 AND deleted_at IS NULL`, 100000+index, item.id, access.WorkspaceID); queryErr != nil {
						serverError(w, queryErr)
						return
					}
				}
			}
		}
		if queryErr = normalizeFileTypeScopeOrder(r.Context(), tx, access.WorkspaceID, scope, priority); queryErr != nil {
			serverError(w, queryErr)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "migrated", "migrated": migrated, "skipped": skipped, "warnings": warnings})
}
