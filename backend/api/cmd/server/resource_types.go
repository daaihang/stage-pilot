package main

// Resource type management is shared by all workspace resource libraries.
// Definitions are server-owned constants and are the only source of dynamic
// SQL identifiers; client input is never interpolated as SQL.

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type ResourceTypeDefinition struct {
	Key                string
	TableName          string
	TemplateTableName  string
	ResourceTableName  string
	ResourceTypeColumn string
	ResourceLabel      string
	UsageJSONKey       string
	DefaultColor       string
}

type resourceQueryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

var (
	programResourceTypeDefinition      = ResourceTypeDefinition{Key: "programs", TableName: "program_types", TemplateTableName: "program_type_templates", ResourceTableName: "programs", ResourceTypeColumn: "program_type_id", ResourceLabel: "节目", UsageJSONKey: "program_count", DefaultColor: "#2563eb"}
	venueResourceTypeDefinition        = ResourceTypeDefinition{Key: "venues", TableName: "venue_types", TemplateTableName: "venue_type_templates", ResourceTableName: "venues", ResourceTypeColumn: "venue_type_id", ResourceLabel: "场地", UsageJSONKey: "venue_count", DefaultColor: "#64748b"}
	personResourceTypeDefinition       = ResourceTypeDefinition{Key: "people", TableName: "person_types", TemplateTableName: "person_type_templates", ResourceTableName: "people", ResourceTypeColumn: "person_type_id", ResourceLabel: "人员", UsageJSONKey: "person_count", DefaultColor: "#2563eb"}
	organizationResourceTypeDefinition = ResourceTypeDefinition{Key: "organizations", TableName: "organization_types", TemplateTableName: "organization_type_templates", ResourceTableName: "organizations", ResourceTypeColumn: "organization_type_id", ResourceLabel: "机构", UsageJSONKey: "organization_count", DefaultColor: "#7c3aed"}
	equipmentResourceTypeDefinition    = ResourceTypeDefinition{Key: "equipment", TableName: "equipment_types", TemplateTableName: "equipment_type_templates", ResourceTableName: "equipment_items", ResourceTypeColumn: "equipment_type_id", ResourceLabel: "设备", UsageJSONKey: "equipment_count", DefaultColor: "#64748b"}
)

var allResourceTypeDefinitions = []ResourceTypeDefinition{
	programResourceTypeDefinition,
	venueResourceTypeDefinition,
	personResourceTypeDefinition,
	organizationResourceTypeDefinition,
	equipmentResourceTypeDefinition,
}

func canonicalResourceTypeDefinition(definition ResourceTypeDefinition) (ResourceTypeDefinition, bool) {
	for _, candidate := range allResourceTypeDefinitions {
		if definition.Key == candidate.Key {
			return candidate, true
		}
	}
	return ResourceTypeDefinition{}, false
}

func resourceTypeDefinitionForRequest(w http.ResponseWriter, r *http.Request) (ResourceTypeDefinition, bool) {
	definition, ok := canonicalResourceTypeDefinition(ResourceTypeDefinition{Key: strings.TrimSpace(r.PathValue("resourceType"))})
	if !ok {
		errorJSON(w, http.StatusNotFound, "resource_type_not_found", "资源类型不存在")
	}
	return definition, ok
}

func resourceTypeExists(ctx context.Context, query resourceQueryRower, definition ResourceTypeDefinition, workspaceID, typeID string, activeOnly bool) (bool, error) {
	definition, ok := canonicalResourceTypeDefinition(definition)
	if !ok {
		return false, nil
	}
	condition := "deleted_at IS NULL"
	if activeOnly {
		condition += " AND is_active=TRUE"
	}
	var exists bool
	err := query.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM "+definition.TableName+" WHERE id=$1 AND workspace_id=$2 AND "+condition+")", typeID, workspaceID).Scan(&exists)
	return exists, err
}

func resourceTypeResponse(id, workspaceID string, systemKey *string, name, color string, sortOrder int, systemDefault, active bool, createdAt, updatedAt time.Time, usageKey string, usage int) map[string]any {
	return map[string]any{
		"id": id, "workspace_id": workspaceID, "system_key": systemKey, "name": name, "color": color,
		"sort_order": sortOrder, "is_system_default": systemDefault, "is_active": active,
		"created_at": createdAt, "updated_at": updatedAt, usageKey: usage,
	}
}

func (app *application) listResourceTypes(w http.ResponseWriter, r *http.Request) {
	definition, ok := resourceTypeDefinitionForRequest(w, r)
	if !ok {
		return
	}
	access := resourceAccess(r)
	where := []string{"t.workspace_id=$1", "t.deleted_at IS NULL"}
	args := []any{access.WorkspaceID}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+q+"%")
		where = append(where, "t.name ILIKE $"+strconv.Itoa(len(args)))
	}
	if status := r.URL.Query().Get("status"); status == "active" {
		where = append(where, "t.is_active=TRUE")
	} else if status == "inactive" {
		where = append(where, "t.is_active=FALSE")
	} else if status != "" && status != "all" {
		errorJSON(w, http.StatusBadRequest, "invalid_input", definition.ResourceLabel+"类型状态无效")
		return
	}
	usageParam := "has_" + definition.Key
	if used := r.URL.Query().Get(usageParam); used == "true" {
		where = append(where, "EXISTS (SELECT 1 FROM "+definition.ResourceTableName+" r WHERE r.workspace_id=t.workspace_id AND r."+definition.ResourceTypeColumn+"=t.id AND r.deleted_at IS NULL)")
	} else if used == "false" {
		where = append(where, "NOT EXISTS (SELECT 1 FROM "+definition.ResourceTableName+" r WHERE r.workspace_id=t.workspace_id AND r."+definition.ResourceTypeColumn+"=t.id AND r.deleted_at IS NULL)")
	} else if used != "" {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "使用情况筛选无效")
		return
	}
	sort := strings.ToLower(r.URL.Query().Get("sort"))
	if sort == "" {
		sort = "sort_order"
	}
	sortColumn, valid := map[string]string{"name": "t.name", definition.UsageJSONKey: "usage_count", "sort_order": "t.sort_order", "updated_at": "t.updated_at"}[sort]
	if !valid {
		errorJSON(w, http.StatusBadRequest, "invalid_input", definition.ResourceLabel+"类型排序字段无效")
		return
	}
	direction := strings.ToLower(r.URL.Query().Get("direction"))
	if direction == "" {
		direction = "asc"
	}
	if direction != "asc" && direction != "desc" {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序方向无效")
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT t.id,t.workspace_id,t.system_key,t.name,t.color,t.sort_order,t.is_system_default,t.is_active,t.created_at,t.updated_at,COUNT(r.id)::int AS usage_count FROM `+definition.TableName+` t LEFT JOIN `+definition.ResourceTableName+` r ON r.workspace_id=t.workspace_id AND r.`+definition.ResourceTypeColumn+`=t.id AND r.deleted_at IS NULL WHERE `+strings.Join(where, " AND ")+` GROUP BY t.id ORDER BY `+sortColumn+` `+strings.ToUpper(direction)+`,t.id`, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, workspaceID, name, color string
		var systemKey *string
		var sortOrder, usage int
		var systemDefault, active bool
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &workspaceID, &systemKey, &name, &color, &sortOrder, &systemDefault, &active, &createdAt, &updatedAt, &usage); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, resourceTypeResponse(id, workspaceID, systemKey, name, color, sortOrder, systemDefault, active, createdAt, updatedAt, definition.UsageJSONKey, usage))
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (app *application) createResourceType(w http.ResponseWriter, r *http.Request) {
	definition, ok := resourceTypeDefinitionForRequest(w, r)
	if !ok {
		return
	}
	var in struct {
		Name      string `json:"name"`
		Color     string `json:"color"`
		SortOrder *int   `json:"sort_order"`
		IsActive  *bool  `json:"is_active"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, valid := validName(w, in.Name, definition.ResourceLabel+"类型名称")
	if !valid {
		return
	}
	color := strings.TrimSpace(in.Color)
	if color == "" {
		color = definition.DefaultColor
	}
	if !validProgramTypeColor(color) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "颜色必须是 #RRGGBB 格式")
		return
	}
	if in.SortOrder != nil && *in.SortOrder < 0 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序值不能小于 0")
		return
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	access := resourceAccess(r)
	sortOrder := 0
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	} else if err := app.db.QueryRow(r.Context(), "SELECT COALESCE(MAX(sort_order)+1,0) FROM "+definition.TableName+" WHERE workspace_id=$1 AND deleted_at IS NULL", access.WorkspaceID).Scan(&sortOrder); err != nil {
		serverError(w, err)
		return
	}
	var id, workspaceID, savedName, savedColor string
	var systemKey *string
	var savedOrder int
	var systemDefault, savedActive bool
	var createdAt, updatedAt time.Time
	err := app.db.QueryRow(r.Context(), `INSERT INTO `+definition.TableName+`(id,workspace_id,name,color,sort_order,is_active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_at,updated_at`, newID(), access.WorkspaceID, name, color, sortOrder, active, access.UserID).Scan(&id, &workspaceID, &systemKey, &savedName, &savedColor, &savedOrder, &systemDefault, &savedActive, &createdAt, &updatedAt)
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_input", definition.ResourceLabel+"类型名称已存在或无效")
		return
	}
	writeJSON(w, http.StatusCreated, resourceTypeResponse(id, workspaceID, systemKey, savedName, savedColor, savedOrder, systemDefault, savedActive, createdAt, updatedAt, definition.UsageJSONKey, 0))
}

func (app *application) updateResourceType(w http.ResponseWriter, r *http.Request) {
	definition, ok := resourceTypeDefinitionForRequest(w, r)
	if !ok {
		return
	}
	var in struct {
		Name      *string `json:"name"`
		Color     *string `json:"color"`
		SortOrder *int    `json:"sort_order"`
		IsActive  *bool   `json:"is_active"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name != nil {
		name, valid := validName(w, *in.Name, definition.ResourceLabel+"类型名称")
		if !valid {
			return
		}
		in.Name = &name
	}
	if in.Color != nil {
		color := strings.TrimSpace(*in.Color)
		if !validProgramTypeColor(color) {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "颜色必须是 #RRGGBB 格式")
			return
		}
		in.Color = &color
	}
	if in.SortOrder != nil && *in.SortOrder < 0 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序值不能小于 0")
		return
	}
	access := resourceAccess(r)
	id := r.PathValue("typeId")
	var systemDefault bool
	if err := app.db.QueryRow(r.Context(), "SELECT is_system_default FROM "+definition.TableName+" WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", id, access.WorkspaceID).Scan(&systemDefault); err == pgx.ErrNoRows {
		resourceNotFound(w, definition.ResourceLabel+"类型")
		return
	} else if err != nil {
		serverError(w, err)
		return
	}
	if systemDefault && (in.Name != nil || in.Color != nil || in.SortOrder != nil) {
		errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认"+definition.ResourceLabel+"类型只能启用或停用")
		return
	}
	var idOut, workspaceID, savedName, savedColor string
	var systemKey *string
	var savedOrder int
	var savedSystemDefault, savedActive bool
	var createdAt, updatedAt time.Time
	err := app.db.QueryRow(r.Context(), `UPDATE `+definition.TableName+` SET name=COALESCE($1,name),color=COALESCE($2,color),sort_order=COALESCE($3,sort_order),is_active=COALESCE($4,is_active),updated_at=NOW() WHERE id=$5 AND workspace_id=$6 AND deleted_at IS NULL RETURNING id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_at,updated_at`, in.Name, in.Color, in.SortOrder, in.IsActive, id, access.WorkspaceID).Scan(&idOut, &workspaceID, &systemKey, &savedName, &savedColor, &savedOrder, &savedSystemDefault, &savedActive, &createdAt, &updatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, definition.ResourceLabel+"类型")
		return
	}
	if err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid_input", definition.ResourceLabel+"类型名称已存在或无效")
		return
	}
	var usage int
	if err := app.db.QueryRow(r.Context(), "SELECT count(*) FROM "+definition.ResourceTableName+" WHERE workspace_id=$1 AND "+definition.ResourceTypeColumn+"=$2 AND deleted_at IS NULL", workspaceID, idOut).Scan(&usage); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resourceTypeResponse(idOut, workspaceID, systemKey, savedName, savedColor, savedOrder, savedSystemDefault, savedActive, createdAt, updatedAt, definition.UsageJSONKey, usage))
}

func (app *application) reorderResourceTypes(w http.ResponseWriter, r *http.Request) {
	definition, ok := resourceTypeDefinitionForRequest(w, r)
	if !ok {
		return
	}
	var in struct {
		Items []struct {
			ID        string `json:"id"`
			SortOrder int    `json:"sort_order"`
		} `json:"items"`
	}
	if !decodeJSON(w, r, &in) || len(in.Items) == 0 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表不能为空")
		return
	}
	seen := map[string]bool{}
	for _, item := range in.Items {
		if item.ID == "" || seen[item.ID] || item.SortOrder < 0 {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "类型排序列表无效")
			return
		}
		seen[item.ID] = true
	}
	access := resourceAccess(r)
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	rows, err := tx.Query(r.Context(), "SELECT id,sort_order,is_system_default FROM "+definition.TableName+" WHERE workspace_id=$1 AND deleted_at IS NULL FOR UPDATE", access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	current := map[string]struct {
		sortOrder     int
		systemDefault bool
	}{}
	for rows.Next() {
		var id string
		var sortOrder int
		var systemDefault bool
		if err := rows.Scan(&id, &sortOrder, &systemDefault); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		current[id] = struct {
			sortOrder     int
			systemDefault bool
		}{sortOrder, systemDefault}
	}
	rows.Close()
	if len(current) != len(in.Items) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表必须包含当前工作空间的全部类型")
		return
	}
	for _, item := range in.Items {
		entry, exists := current[item.ID]
		if !exists {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表包含未知类型")
			return
		}
		if entry.systemDefault && entry.sortOrder != item.SortOrder {
			errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认"+definition.ResourceLabel+"类型不能修改排序")
			return
		}
	}
	for _, item := range in.Items {
		if current[item.ID].sortOrder == item.SortOrder {
			continue
		}
		if _, err = tx.Exec(r.Context(), "UPDATE "+definition.TableName+" SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3 AND deleted_at IS NULL", item.SortOrder, item.ID, access.WorkspaceID); err != nil {
			serverError(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.listResourceTypes(w, r)
}

func (app *application) deleteResourceType(w http.ResponseWriter, r *http.Request) {
	definition, ok := resourceTypeDefinitionForRequest(w, r)
	if !ok {
		return
	}
	var in struct {
		Strategy          string `json:"strategy"`
		ReplacementTypeID string `json:"replacement_type_id"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !validOne(in.Strategy, "move", "other", "deactivate", "delete") {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "删除策略无效")
		return
	}
	access := resourceAccess(r)
	sourceID := r.PathValue("typeId")
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	type state struct {
		systemDefault bool
		active        bool
		systemKey     *string
	}
	locked := map[string]state{}
	ids := []string{sourceID}
	if in.Strategy == "move" {
		ids = append(ids, strings.TrimSpace(in.ReplacementTypeID))
	}
	query := "SELECT id,is_system_default,is_active,system_key FROM " + definition.TableName + " WHERE workspace_id=$1 AND deleted_at IS NULL AND (id=ANY($2)"
	if in.Strategy == "other" {
		query += " OR system_key='other'"
	}
	query += ") ORDER BY id FOR UPDATE"
	rows, err := tx.Query(r.Context(), query, access.WorkspaceID, ids)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var id string
		var item state
		if err = rows.Scan(&id, &item.systemDefault, &item.active, &item.systemKey); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		locked[id] = item
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		serverError(w, err)
		return
	}
	rows.Close()
	source, found := locked[sourceID]
	if !found {
		resourceNotFound(w, definition.ResourceLabel+"类型")
		return
	}
	if source.systemDefault && in.Strategy != "deactivate" {
		errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认"+definition.ResourceLabel+"类型只能启用或停用")
		return
	}
	if in.Strategy == "deactivate" {
		if _, err = tx.Exec(r.Context(), "UPDATE "+definition.TableName+" SET is_active=FALSE,updated_at=NOW() WHERE id=$1 AND workspace_id=$2", sourceID, access.WorkspaceID); err != nil {
			serverError(w, err)
			return
		}
		if err = tx.Commit(r.Context()); err != nil {
			serverError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "deactivated", "strategy": in.Strategy, "affected_count": 0})
		return
	}
	targetID := ""
	if in.Strategy == "move" {
		targetID = strings.TrimSpace(in.ReplacementTypeID)
		target, targetFound := locked[targetID]
		if targetID == "" || targetID == sourceID || !targetFound || !target.active {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "请选择当前工作空间内其他启用类型")
			return
		}
	} else if in.Strategy == "other" {
		for id, candidate := range locked {
			if candidate.systemKey != nil && *candidate.systemKey == "other" {
				targetID = id
				break
			}
		}
		if targetID == "" || targetID == sourceID {
			errorJSON(w, http.StatusConflict, "other_type_unavailable", "当前工作空间缺少可用的“其他”类型")
			return
		}
	}
	resourceRows, err := tx.Query(r.Context(), "SELECT id FROM "+definition.ResourceTableName+" WHERE workspace_id=$1 AND "+definition.ResourceTypeColumn+"=$2 AND deleted_at IS NULL FOR UPDATE", access.WorkspaceID, sourceID)
	if err != nil {
		serverError(w, err)
		return
	}
	affected := 0
	for resourceRows.Next() {
		var id string
		if err = resourceRows.Scan(&id); err != nil {
			resourceRows.Close()
			serverError(w, err)
			return
		}
		affected++
	}
	if err = resourceRows.Err(); err != nil {
		resourceRows.Close()
		serverError(w, err)
		return
	}
	resourceRows.Close()
	if in.Strategy == "delete" && affected > 0 {
		errorJSONWithFields(w, http.StatusConflict, "resource_type_in_use", "该"+definition.ResourceLabel+"类型仍被资源使用", map[string]any{definition.UsageJSONKey: affected, "affected_count": affected})
		return
	}
	if targetID != "" {
		if _, err = tx.Exec(r.Context(), "UPDATE "+definition.ResourceTableName+" SET "+definition.ResourceTypeColumn+"=$1,updated_at=NOW() WHERE workspace_id=$2 AND "+definition.ResourceTypeColumn+"=$3 AND deleted_at IS NULL", targetID, access.WorkspaceID, sourceID); err != nil {
			serverError(w, err)
			return
		}
	}
	if _, err = tx.Exec(r.Context(), "UPDATE "+definition.TableName+" SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", sourceID, access.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "strategy": in.Strategy, "affected_count": affected, definition.UsageJSONKey: affected})
}

func seedResourceTypes(ctx context.Context, tx pgx.Tx, workspaceID, createdBy string) error {
	for _, definition := range allResourceTypeDefinitions {
		_, err := tx.Exec(ctx, `INSERT INTO `+definition.TableName+` (id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_by)
			SELECT md5($1 || ':' || t.key),$1,t.key,t.name,t.color,t.sort_order,TRUE,t.is_active,$2
			FROM `+definition.TemplateTableName+` t
			WHERE NOT EXISTS (SELECT 1 FROM `+definition.TableName+` existing WHERE existing.workspace_id=$1 AND existing.system_key=t.key AND existing.deleted_at IS NULL)`, workspaceID, createdBy)
		if err != nil {
			return err
		}
	}
	return nil
}
