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
	UsageColumn        string
	UsageJSONKey       string
	PathValueName      string
	DefaultColor       string
	SupportsUsageQuery bool
	ProtectSystemName  bool
	UsesLegacyHandler  bool
}

var (
	programResourceTypeDefinition = ResourceTypeDefinition{
		Key: "programs", TableName: "program_types", TemplateTableName: "program_type_templates", ResourceTableName: "programs", ResourceTypeColumn: "program_type_id", ResourceLabel: "节目", UsageColumn: "program_type_id", UsageJSONKey: "program_count", PathValueName: "programTypeId", DefaultColor: "#2563eb", SupportsUsageQuery: true, ProtectSystemName: true, UsesLegacyHandler: true,
	}
	venueResourceTypeDefinition = ResourceTypeDefinition{
		Key: "venues", TableName: "venue_types", TemplateTableName: "venue_type_templates", ResourceTableName: "venues", ResourceTypeColumn: "venue_type_id", ResourceLabel: "场地", UsageColumn: "venue_type_id", UsageJSONKey: "venue_count", PathValueName: "venueTypeId", DefaultColor: "#64748b", SupportsUsageQuery: true, ProtectSystemName: true, UsesLegacyHandler: true,
	}
	personResourceTypeDefinition = ResourceTypeDefinition{
		Key: "people", TableName: "person_types", TemplateTableName: "person_type_templates", ResourceTableName: "people", ResourceTypeColumn: "person_type_id", ResourceLabel: "人员", UsageColumn: "person_type_id", UsageJSONKey: "person_count", PathValueName: "personTypeId", DefaultColor: "#2563eb", SupportsUsageQuery: true, ProtectSystemName: true,
	}
	organizationResourceTypeDefinition = ResourceTypeDefinition{
		Key: "organizations", TableName: "organization_types", TemplateTableName: "organization_type_templates", ResourceTableName: "organizations", ResourceTypeColumn: "organization_type_id", ResourceLabel: "机构", UsageColumn: "organization_type_id", UsageJSONKey: "organization_count", PathValueName: "organizationTypeId", DefaultColor: "#7c3aed", SupportsUsageQuery: true, ProtectSystemName: true,
	}
	equipmentResourceTypeDefinition = ResourceTypeDefinition{
		Key: "equipment", TableName: "equipment_types", TemplateTableName: "equipment_type_templates", ResourceTableName: "equipment_items", ResourceTypeColumn: "equipment_type_id", ResourceLabel: "设备", UsageColumn: "equipment_type_id", UsageJSONKey: "equipment_count", PathValueName: "equipmentTypeId", DefaultColor: "#64748b", SupportsUsageQuery: true, ProtectSystemName: true,
	}
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

func validResourceTypeDefinition(definition ResourceTypeDefinition) bool {
	_, ok := canonicalResourceTypeDefinition(definition)
	return ok
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

func (app *application) listResourceTypes(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	definition, ok := canonicalResourceTypeDefinition(definition)
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.UsesLegacyHandler {
		if definition.Key == "programs" {
			app.legacyListProgramTypes(w, r)
		} else {
			app.legacyListVenueTypes(w, r)
		}
		return
	}
	app.listStandardResourceTypes(w, r, definition)
}

func (app *application) createResourceType(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	definition, ok := canonicalResourceTypeDefinition(definition)
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.UsesLegacyHandler {
		if definition.Key == "programs" {
			app.legacyCreateProgramType(w, r)
		} else {
			app.legacyCreateVenueType(w, r)
		}
		return
	}
	app.createStandardResourceType(w, r, definition)
}

func (app *application) updateResourceType(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	definition, ok := canonicalResourceTypeDefinition(definition)
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.UsesLegacyHandler {
		if definition.Key == "programs" {
			app.legacyUpdateProgramType(w, r)
		} else {
			app.legacyUpdateVenueType(w, r)
		}
		return
	}
	app.updateStandardResourceType(w, r, definition)
}

func (app *application) reorderResourceTypes(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	definition, ok := canonicalResourceTypeDefinition(definition)
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.UsesLegacyHandler {
		if definition.Key == "programs" {
			app.legacyReorderProgramTypes(w, r)
		} else {
			app.legacyReorderVenueTypes(w, r)
		}
		return
	}
	app.reorderStandardResourceTypes(w, r, definition)
}

func (app *application) deleteResourceType(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	definition, ok := canonicalResourceTypeDefinition(definition)
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "资源类型无效")
		return
	}
	if definition.UsesLegacyHandler {
		if definition.Key == "programs" {
			app.legacyDeleteProgramType(w, r)
		} else {
			app.legacyDeleteVenueType(w, r)
		}
		return
	}
	app.deleteStandardResourceType(w, r, definition)
}

func resourceTypeResponse(id, workspaceID string, systemKey *string, name, color string, sortOrder int, systemDefault, active bool, createdAt, updatedAt time.Time, usageKey string, usage int) map[string]any {
	return map[string]any{
		"id": id, "workspace_id": workspaceID, "system_key": systemKey, "name": name, "color": color,
		"sort_order": sortOrder, "is_system_default": systemDefault, "is_active": active,
		"created_at": createdAt, "updated_at": updatedAt, usageKey: usage,
	}
}

func (app *application) listStandardResourceTypes(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
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
		errorJSON(w, 400, "invalid_input", definition.ResourceLabel+"类型状态无效")
		return
	}
	usageParam := "has_" + definition.Key
	if used := r.URL.Query().Get(usageParam); used == "true" {
		where = append(where, "EXISTS (SELECT 1 FROM "+definition.ResourceTableName+" r WHERE r.workspace_id=t.workspace_id AND r."+definition.ResourceTypeColumn+"=t.id AND r.deleted_at IS NULL)")
	} else if used == "false" {
		where = append(where, "NOT EXISTS (SELECT 1 FROM "+definition.ResourceTableName+" r WHERE r.workspace_id=t.workspace_id AND r."+definition.ResourceTypeColumn+"=t.id AND r.deleted_at IS NULL)")
	} else if used != "" {
		errorJSON(w, 400, "invalid_input", "使用情况筛选无效")
		return
	}
	sort := strings.ToLower(r.URL.Query().Get("sort"))
	if sort == "" {
		sort = "sort_order"
	}
	sortColumn, valid := map[string]string{"name": "t.name", definition.UsageJSONKey: "usage_count", "sort_order": "t.sort_order", "updated_at": "t.updated_at"}[sort]
	if !valid {
		errorJSON(w, 400, "invalid_input", definition.ResourceLabel+"类型排序字段无效")
		return
	}
	direction := strings.ToLower(r.URL.Query().Get("direction"))
	if direction == "" {
		direction = "asc"
	}
	if direction != "asc" && direction != "desc" {
		errorJSON(w, 400, "invalid_input", "排序方向无效")
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT t.id,t.workspace_id,t.system_key,t.name,t.color,t.sort_order,t.is_system_default,t.is_active,t.created_at,t.updated_at,COUNT(r.id)::int FROM `+definition.TableName+` t LEFT JOIN `+definition.ResourceTableName+` r ON r.workspace_id=t.workspace_id AND r.`+definition.ResourceTypeColumn+`=t.id AND r.deleted_at IS NULL WHERE `+strings.Join(where, " AND ")+` GROUP BY t.id ORDER BY `+sortColumn+` `+strings.ToUpper(direction)+`,t.id`, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, ws, name, color string
		var createdAt, updatedAt time.Time
		var key *string
		var order, usage int
		var systemDefault, active bool
		if err := rows.Scan(&id, &ws, &key, &name, &color, &order, &systemDefault, &active, &createdAt, &updatedAt, &usage); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, resourceTypeResponse(id, ws, key, name, color, order, systemDefault, active, createdAt, updatedAt, definition.UsageJSONKey, usage))
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
}

func (app *application) createStandardResourceType(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	var in struct {
		Name      string `json:"name"`
		Color     string `json:"color"`
		SortOrder *int   `json:"sort_order"`
		IsActive  *bool  `json:"is_active"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, ok := validName(w, in.Name, definition.ResourceLabel+"类型名称")
	if !ok {
		return
	}
	color := strings.TrimSpace(in.Color)
	if color == "" {
		color = definition.DefaultColor
	}
	if !validProgramTypeColor(color) {
		errorJSON(w, 400, "invalid_input", "颜色必须是 #RRGGBB 格式")
		return
	}
	if in.SortOrder != nil && *in.SortOrder < 0 {
		errorJSON(w, 400, "invalid_input", "排序值不能小于 0")
		return
	}
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	access := resourceAccess(r)
	var sortOrder int
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	} else if err := app.db.QueryRow(r.Context(), "SELECT COALESCE(MAX(sort_order)+1,0) FROM "+definition.TableName+" WHERE workspace_id=$1 AND deleted_at IS NULL", access.WorkspaceID).Scan(&sortOrder); err != nil {
		serverError(w, err)
		return
	}
	var id, ws, nameOut, colorOut string
	var createdAt, updatedAt time.Time
	var key *string
	var order int
	var systemDefault, isActive bool
	err := app.db.QueryRow(r.Context(), `INSERT INTO `+definition.TableName+`(id,workspace_id,name,color,sort_order,is_active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_at,updated_at`, newID(), access.WorkspaceID, name, color, sortOrder, active, access.UserID).Scan(&id, &ws, &key, &nameOut, &colorOut, &order, &systemDefault, &isActive, &createdAt, &updatedAt)
	if err != nil {
		errorJSON(w, 400, "invalid_input", definition.ResourceLabel+"类型名称已存在或无效")
		return
	}
	writeJSON(w, 201, resourceTypeResponse(id, ws, key, nameOut, colorOut, order, systemDefault, isActive, createdAt, updatedAt, definition.UsageJSONKey, 0))
}

func (app *application) updateStandardResourceType(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
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
		name, ok := validName(w, *in.Name, definition.ResourceLabel+"类型名称")
		if !ok {
			return
		}
		in.Name = &name
	}
	if in.Color != nil {
		color := strings.TrimSpace(*in.Color)
		if !validProgramTypeColor(color) {
			errorJSON(w, 400, "invalid_input", "颜色必须是 #RRGGBB 格式")
			return
		}
		in.Color = &color
	}
	if in.SortOrder != nil && *in.SortOrder < 0 {
		errorJSON(w, 400, "invalid_input", "排序值不能小于 0")
		return
	}
	access := resourceAccess(r)
	id := r.PathValue(definition.PathValueName)
	var currentSystemDefault bool
	if err := app.db.QueryRow(r.Context(), "SELECT is_system_default FROM "+definition.TableName+" WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL", id, access.WorkspaceID).Scan(&currentSystemDefault); err == pgx.ErrNoRows {
		resourceNotFound(w, definition.ResourceLabel+"类型")
		return
	} else if err != nil {
		serverError(w, err)
		return
	}
	if currentSystemDefault {
		if in.Name != nil || in.Color != nil || in.SortOrder != nil {
			errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认"+definition.ResourceLabel+"类型不能修改")
			return
		}
		if in.IsActive != nil && !*in.IsActive {
			errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认"+definition.ResourceLabel+"类型不能停用，只能启用")
			return
		}
	}
	var idOut, ws, nameOut, colorOut string
	var createdAt, updatedAt time.Time
	var key *string
	var order int
	var systemDefault, active bool
	err := app.db.QueryRow(r.Context(), `UPDATE `+definition.TableName+` SET name=COALESCE($1,name),color=COALESCE($2,color),sort_order=COALESCE($3,sort_order),is_active=COALESCE($4,is_active),updated_at=NOW() WHERE id=$5 AND workspace_id=$6 AND deleted_at IS NULL RETURNING id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_at,updated_at`, in.Name, in.Color, in.SortOrder, in.IsActive, id, access.WorkspaceID).Scan(&idOut, &ws, &key, &nameOut, &colorOut, &order, &systemDefault, &active, &createdAt, &updatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, definition.ResourceLabel+"类型")
		return
	}
	if err != nil {
		errorJSON(w, 400, "invalid_input", definition.ResourceLabel+"类型名称已存在或无效")
		return
	}
	writeJSON(w, 200, resourceTypeResponse(idOut, ws, key, nameOut, colorOut, order, systemDefault, active, createdAt, updatedAt, definition.UsageJSONKey, 0))
}

func (app *application) reorderStandardResourceTypes(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
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
	seen := map[string]bool{}
	for _, item := range in.Items {
		if item.ID == "" || seen[item.ID] || item.SortOrder < 0 {
			errorJSON(w, 400, "invalid_input", "类型排序列表无效")
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
		}{sortOrder: sortOrder, systemDefault: systemDefault}
	}
	rows.Close()
	if len(current) != len(in.Items) {
		errorJSON(w, 400, "invalid_input", "排序列表必须包含当前工作空间的全部类型")
		return
	}
	for _, item := range in.Items {
		entry, exists := current[item.ID]
		if !exists {
			errorJSON(w, 400, "invalid_input", "排序列表包含未知类型")
			return
		}
		if entry.systemDefault && entry.sortOrder != item.SortOrder {
			errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认"+definition.ResourceLabel+"类型不能修改排序")
			return
		}
	}
	for _, item := range in.Items {
		if _, err = tx.Exec(r.Context(), "UPDATE "+definition.TableName+" SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3 AND deleted_at IS NULL", item.SortOrder, item.ID, access.WorkspaceID); err != nil {
			serverError(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.listStandardResourceTypes(w, r, definition)
}

func (app *application) deleteStandardResourceType(w http.ResponseWriter, r *http.Request, definition ResourceTypeDefinition) {
	access := resourceAccess(r)
	id := r.PathValue(definition.PathValueName)
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var systemDefault bool
	if err = tx.QueryRow(r.Context(), "SELECT is_system_default FROM "+definition.TableName+" WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE", id, access.WorkspaceID).Scan(&systemDefault); err == pgx.ErrNoRows {
		resourceNotFound(w, definition.ResourceLabel+"类型")
		return
	} else if err != nil {
		serverError(w, err)
		return
	}
	if systemDefault {
		errorJSON(w, 409, "system_default_protected", "系统默认"+definition.ResourceLabel+"类型不能删除")
		return
	}
	command, err := tx.Exec(r.Context(), "UPDATE "+definition.ResourceTableName+" SET "+definition.ResourceTypeColumn+"=NULL,updated_at=NOW() WHERE workspace_id=$1 AND "+definition.ResourceTypeColumn+"=$2 AND deleted_at IS NULL", access.WorkspaceID, id)
	if err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), "UPDATE "+definition.TableName+" SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2", id, access.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"status": "deleted", "unassigned_count": command.RowsAffected()})
}

func (app *application) listProgramTypes(w http.ResponseWriter, r *http.Request) {
	app.listResourceTypes(w, r, programResourceTypeDefinition)
}
func (app *application) createProgramType(w http.ResponseWriter, r *http.Request) {
	app.createResourceType(w, r, programResourceTypeDefinition)
}
func (app *application) updateProgramType(w http.ResponseWriter, r *http.Request) {
	app.updateResourceType(w, r, programResourceTypeDefinition)
}
func (app *application) reorderProgramTypes(w http.ResponseWriter, r *http.Request) {
	app.reorderResourceTypes(w, r, programResourceTypeDefinition)
}
func (app *application) deleteProgramType(w http.ResponseWriter, r *http.Request) {
	app.deleteResourceType(w, r, programResourceTypeDefinition)
}
func (app *application) listVenueTypes(w http.ResponseWriter, r *http.Request) {
	app.listResourceTypes(w, r, venueResourceTypeDefinition)
}
func (app *application) createVenueType(w http.ResponseWriter, r *http.Request) {
	app.createResourceType(w, r, venueResourceTypeDefinition)
}
func (app *application) updateVenueType(w http.ResponseWriter, r *http.Request) {
	app.updateResourceType(w, r, venueResourceTypeDefinition)
}
func (app *application) reorderVenueTypes(w http.ResponseWriter, r *http.Request) {
	app.reorderResourceTypes(w, r, venueResourceTypeDefinition)
}
func (app *application) deleteVenueType(w http.ResponseWriter, r *http.Request) {
	app.deleteResourceType(w, r, venueResourceTypeDefinition)
}
func (app *application) listPersonTypes(w http.ResponseWriter, r *http.Request) {
	app.listResourceTypes(w, r, personResourceTypeDefinition)
}
func (app *application) createPersonType(w http.ResponseWriter, r *http.Request) {
	app.createResourceType(w, r, personResourceTypeDefinition)
}
func (app *application) updatePersonType(w http.ResponseWriter, r *http.Request) {
	app.updateResourceType(w, r, personResourceTypeDefinition)
}
func (app *application) reorderPersonTypes(w http.ResponseWriter, r *http.Request) {
	app.reorderResourceTypes(w, r, personResourceTypeDefinition)
}
func (app *application) deletePersonType(w http.ResponseWriter, r *http.Request) {
	app.deleteResourceType(w, r, personResourceTypeDefinition)
}
func (app *application) listOrganizationTypes(w http.ResponseWriter, r *http.Request) {
	app.listResourceTypes(w, r, organizationResourceTypeDefinition)
}
func (app *application) createOrganizationType(w http.ResponseWriter, r *http.Request) {
	app.createResourceType(w, r, organizationResourceTypeDefinition)
}
func (app *application) updateOrganizationType(w http.ResponseWriter, r *http.Request) {
	app.updateResourceType(w, r, organizationResourceTypeDefinition)
}
func (app *application) reorderOrganizationTypes(w http.ResponseWriter, r *http.Request) {
	app.reorderResourceTypes(w, r, organizationResourceTypeDefinition)
}
func (app *application) deleteOrganizationType(w http.ResponseWriter, r *http.Request) {
	app.deleteResourceType(w, r, organizationResourceTypeDefinition)
}
func (app *application) listEquipmentTypes(w http.ResponseWriter, r *http.Request) {
	app.listResourceTypes(w, r, equipmentResourceTypeDefinition)
}
func (app *application) createEquipmentType(w http.ResponseWriter, r *http.Request) {
	app.createResourceType(w, r, equipmentResourceTypeDefinition)
}
func (app *application) updateEquipmentType(w http.ResponseWriter, r *http.Request) {
	app.updateResourceType(w, r, equipmentResourceTypeDefinition)
}
func (app *application) reorderEquipmentTypes(w http.ResponseWriter, r *http.Request) {
	app.reorderResourceTypes(w, r, equipmentResourceTypeDefinition)
}
func (app *application) deleteEquipmentType(w http.ResponseWriter, r *http.Request) {
	app.deleteResourceType(w, r, equipmentResourceTypeDefinition)
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
