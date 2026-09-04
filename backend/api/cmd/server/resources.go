package main

// Workspace Resource Foundation. Resources are durable tenant-scoped assets;
// they deliberately do not reference Production in this phase.

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type programType struct {
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
	ProgramCount    int       `json:"program_count"`
}
type program struct {
	ID                     string    `json:"id"`
	WorkspaceID            string    `json:"workspace_id"`
	Name                   string    `json:"name"`
	ProgramTypeID          *string   `json:"program_type_id"`
	DefaultDurationSeconds *int      `json:"default_duration_seconds"`
	Tags                   []string  `json:"tags"`
	Description            string    `json:"description"`
	TechnicalNotes         string    `json:"technical_notes"`
	Origin                 string    `json:"origin"`
	Status                 string    `json:"status"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}
type person struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspace_id"`
	DisplayName  string    `json:"display_name"`
	Kind         string    `json:"kind"`
	PrimaryEmail string    `json:"primary_email"`
	PrimaryPhone string    `json:"primary_phone"`
	Bio          string    `json:"bio"`
	Skills       []string  `json:"skills"`
	Tags         []string  `json:"tags"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}
type organization struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Name        string    `json:"name"`
	Kind        string    `json:"kind"`
	City        string    `json:"city"`
	Address     string    `json:"address"`
	Description string    `json:"description"`
	Tags        []string  `json:"tags"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
type organizationContact struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspace_id"`
	OrganizationID string    `json:"organization_id"`
	PersonID       string    `json:"person_id"`
	Title          string    `json:"title"`
	IsPrimary      bool      `json:"is_primary"`
	PersonName     string    `json:"person_name"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
type venue struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Name        string    `json:"name"`
	Kind        string    `json:"kind"`
	VenueTypeID *string   `json:"venue_type_id"`
	City        string    `json:"city"`
	Address     string    `json:"address"`
	Timezone    string    `json:"timezone"`
	Description string    `json:"description"`
	Tags        []string  `json:"tags"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
type venueSpace struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspace_id"`
	VenueID        string    `json:"venue_id"`
	Name           string    `json:"name"`
	Capacity       *int      `json:"capacity"`
	TechnicalNotes string    `json:"technical_notes"`
	IsPrimary      bool      `json:"is_primary"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
type equipmentItem struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspace_id"`
	Name            string    `json:"name"`
	Category        string    `json:"category"`
	QuantityTotal   int       `json:"quantity_total"`
	Unit            string    `json:"unit"`
	Ownership       string    `json:"ownership"`
	StorageLocation string    `json:"storage_location"`
	TechnicalNotes  string    `json:"technical_notes"`
	Tags            []string  `json:"tags"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
type resourceList[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"next_cursor"`
	Total      int     `json:"total"`
}

type updateProgramPayload struct {
	Name                   *string `json:"name"`
	ProgramTypeID          *string `json:"program_type_id"`
	ProgramTypeIDPresent   bool
	DefaultDurationSeconds *int      `json:"default_duration_seconds"`
	Tags                   *[]string `json:"tags"`
	Description            *string   `json:"description"`
	TechnicalNotes         *string   `json:"technical_notes"`
	Status                 *string   `json:"status"`
}

// UnmarshalJSON keeps the distinction between an omitted type and an explicit
// null. The latter is how a client clears a program's assignment.
func (p *updateProgramPayload) UnmarshalJSON(data []byte) error {
	type payloadAlias updateProgramPayload
	var decoded payloadAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*p = updateProgramPayload(decoded)
	_, p.ProgramTypeIDPresent = fields["program_type_id"]
	return nil
}

func resourceAccess(r *http.Request) workspaceAccess { return currentWorkspaceAccess(r) }
func resourceNotFound(w http.ResponseWriter, label string) {
	errorJSON(w, http.StatusNotFound, "resource_not_found", label+"不存在")
}
func validOne(v string, allowed ...string) bool {
	for _, value := range allowed {
		if v == value {
			return true
		}
	}
	return false
}
func validName(w http.ResponseWriter, value, label string) (string, bool) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) < 1 || utf8.RuneCountInString(value) > 120 {
		errorJSON(w, 400, "invalid_input", label+"不能为空且不能超过 120 字")
		return "", false
	}
	return value, true
}
func normalizedStrings(values []string, max int) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, raw := range values {
		v := strings.TrimSpace(raw)
		if v != "" && utf8.RuneCountInString(v) <= max && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
func listLimit(r *http.Request) int {
	value, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if value < 1 {
		return 50
	}
	if value > 100 {
		return 100
	}
	return value
}
func listOffset(r *http.Request) int {
	value, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if value < 0 {
		return 0
	}
	return value
}
func arrayParam(r *http.Request, key string) []string {
	return normalizedStrings(r.URL.Query()[key], 80)
}
func statuses(r *http.Request) []string { return arrayParam(r, "status") }

type resourceQueryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func validProgramTypeColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if !(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f') && !(char >= 'A' && char <= 'F') {
			return false
		}
	}
	return true
}

func programTypeExists(ctx context.Context, query resourceQueryRower, workspaceID, typeID string, activeOnly bool) (bool, error) {
	condition := "deleted_at IS NULL"
	if activeOnly {
		condition += " AND is_active=TRUE"
	}
	var exists bool
	err := query.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM program_types WHERE id=$1 AND workspace_id=$2 AND "+condition+")", typeID, workspaceID).Scan(&exists)
	return exists, err
}

// Program types
func (app *application) listProgramTypes(w http.ResponseWriter, r *http.Request) {
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
		errorJSON(w, 400, "invalid_input", "节目类型状态无效")
		return
	}
	if used := r.URL.Query().Get("has_programs"); used == "true" {
		where = append(where, "EXISTS (SELECT 1 FROM programs p WHERE p.workspace_id=t.workspace_id AND p.program_type_id=t.id AND p.deleted_at IS NULL)")
	} else if used == "false" {
		where = append(where, "NOT EXISTS (SELECT 1 FROM programs p WHERE p.workspace_id=t.workspace_id AND p.program_type_id=t.id AND p.deleted_at IS NULL)")
	} else if used != "" {
		errorJSON(w, 400, "invalid_input", "使用情况筛选无效")
		return
	}
	sortKey := strings.ToLower(r.URL.Query().Get("sort"))
	if sortKey == "" {
		sortKey = "sort_order"
	}
	sortColumn, validSort := map[string]string{"name": "t.name", "program_count": "program_count", "sort_order": "t.sort_order", "updated_at": "t.updated_at"}[sortKey]
	if !validSort {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "节目类型排序字段无效")
		return
	}
	directionKey := strings.ToLower(r.URL.Query().Get("direction"))
	if directionKey == "" {
		directionKey = "asc"
	}
	if directionKey != "asc" && directionKey != "desc" {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "节目类型排序方向无效")
		return
	}
	direction := "ASC"
	if directionKey == "desc" {
		direction = "DESC"
	}
	rows, err := app.db.Query(r.Context(), `SELECT t.id,t.workspace_id,t.system_key,t.name,t.color,t.sort_order,t.is_system_default,t.is_active,t.created_at,t.updated_at,COUNT(p.id)::int AS program_count FROM program_types t LEFT JOIN programs p ON p.workspace_id=t.workspace_id AND p.program_type_id=t.id AND p.deleted_at IS NULL WHERE `+strings.Join(where, " AND ")+` GROUP BY t.id ORDER BY `+sortColumn+` `+direction+`,t.id`, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []programType{}
	for rows.Next() {
		var item programType
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.SystemKey, &item.Name, &item.Color, &item.SortOrder, &item.IsSystemDefault, &item.IsActive, &item.CreatedAt, &item.UpdatedAt, &item.ProgramCount); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		serverError(w, rows.Err())
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
}
func (app *application) createProgramType(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name      string `json:"name"`
		Color     string `json:"color"`
		SortOrder int    `json:"sort_order"`
		IsActive  *bool  `json:"is_active"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, ok := validName(w, in.Name, "节目类型名称")
	if !ok {
		return
	}
	in.Color = strings.TrimSpace(in.Color)
	if !validProgramTypeColor(in.Color) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "颜色必须是 #RRGGBB 格式")
		return
	}
	if in.SortOrder < 0 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序值不能小于 0")
		return
	}
	access := resourceAccess(r)
	isActive := true
	if in.IsActive != nil {
		isActive = *in.IsActive
	}
	var item programType
	err := app.db.QueryRow(r.Context(), `INSERT INTO program_types(id,workspace_id,name,color,sort_order,is_active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_at,updated_at`, newID(), access.WorkspaceID, name, in.Color, in.SortOrder, isActive, access.UserID).Scan(&item.ID, &item.WorkspaceID, &item.SystemKey, &item.Name, &item.Color, &item.SortOrder, &item.IsSystemDefault, &item.IsActive, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		errorJSON(w, 400, "invalid_input", "节目类型名称已存在或无效")
		return
	}
	writeJSON(w, 201, item)
}
func (app *application) updateProgramType(w http.ResponseWriter, r *http.Request) {
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
		trimmed, ok := validName(w, *in.Name, "节目类型名称")
		if !ok {
			return
		}
		in.Name = &trimmed
	}
	if in.Color != nil {
		trimmed := strings.TrimSpace(*in.Color)
		if !validProgramTypeColor(trimmed) {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "颜色必须是 #RRGGBB 格式")
			return
		}
		in.Color = &trimmed
	}
	if in.SortOrder != nil && *in.SortOrder < 0 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序值不能小于 0")
		return
	}
	access := resourceAccess(r)
	if in.Name != nil {
		var isSystemDefault bool
		err := app.db.QueryRow(r.Context(), `SELECT is_system_default FROM program_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, r.PathValue("programTypeId"), access.WorkspaceID).Scan(&isSystemDefault)
		if err == pgx.ErrNoRows {
			resourceNotFound(w, "节目类型")
			return
		}
		if err != nil {
			serverError(w, err)
			return
		}
		if isSystemDefault {
			errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认节目类型不能改名")
			return
		}
	}
	var item programType
	err := app.db.QueryRow(r.Context(), `UPDATE program_types SET name=COALESCE($1,name),color=COALESCE($2,color),sort_order=COALESCE($3,sort_order),is_active=COALESCE($4,is_active),updated_at=NOW() WHERE id=$5 AND workspace_id=$6 AND deleted_at IS NULL RETURNING id,workspace_id,system_key,name,color,sort_order,is_system_default,is_active,created_at,updated_at`, in.Name, in.Color, in.SortOrder, in.IsActive, r.PathValue("programTypeId"), access.WorkspaceID).Scan(&item.ID, &item.WorkspaceID, &item.SystemKey, &item.Name, &item.Color, &item.SortOrder, &item.IsSystemDefault, &item.IsActive, &item.CreatedAt, &item.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "节目类型")
		return
	}
	if err != nil {
		errorJSON(w, 400, "invalid_input", "节目类型名称已存在或无效")
		return
	}
	writeJSON(w, 200, item)
}

func (app *application) reorderProgramTypes(w http.ResponseWriter, r *http.Request) {
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
	access := resourceAccess(r)
	seen := map[string]bool{}
	for _, item := range in.Items {
		if item.ID == "" || seen[item.ID] || item.SortOrder < 0 {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "节目类型排序列表无效")
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
	rows, err := tx.Query(r.Context(), `SELECT id FROM program_types WHERE workspace_id=$1 AND deleted_at IS NULL FOR UPDATE`, access.WorkspaceID)
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
		errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表必须包含当前工作空间的全部节目类型")
		return
	}
	for _, item := range in.Items {
		if !current[item.ID] {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "排序列表包含未知节目类型")
			return
		}
	}
	for _, item := range in.Items {
		if _, err = tx.Exec(r.Context(), `UPDATE program_types SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3 AND deleted_at IS NULL AND sort_order IS DISTINCT FROM $1`, item.SortOrder, item.ID, access.WorkspaceID); err != nil {
			serverError(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.listProgramTypes(w, r)
}

func (app *application) deleteProgramType(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Strategy          string `json:"strategy"`
		ReplacementTypeID string `json:"replacement_type_id"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !validOne(in.Strategy, "delete", "move", "unassign") {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "删除策略无效")
		return
	}
	access := resourceAccess(r)
	typeID := r.PathValue("programTypeId")
	var isSystemDefault bool
	if err := app.db.QueryRow(r.Context(), `SELECT is_system_default FROM program_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, typeID, access.WorkspaceID).Scan(&isSystemDefault); err == pgx.ErrNoRows {
		resourceNotFound(w, "节目类型")
		return
	} else if err != nil {
		serverError(w, err)
		return
	} else if isSystemDefault {
		errorJSON(w, http.StatusConflict, "system_default_protected", "系统默认节目类型不能删除")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var sourceActive bool
	if in.Strategy == "move" {
		// A move touches two type rows. Lock both in a stable order so concurrent
		// moves in opposite directions cannot deadlock on source/target order.
		rows, queryErr := tx.Query(r.Context(), `SELECT id,is_active FROM program_types WHERE workspace_id=$1 AND deleted_at IS NULL AND id=ANY($2) ORDER BY id FOR UPDATE`, access.WorkspaceID, []string{typeID, in.ReplacementTypeID})
		if queryErr != nil {
			serverError(w, queryErr)
			return
		}
		lockedTypes := map[string]bool{}
		for rows.Next() {
			var id string
			var active bool
			if queryErr = rows.Scan(&id, &active); queryErr != nil {
				rows.Close()
				serverError(w, queryErr)
				return
			}
			lockedTypes[id] = active
		}
		if queryErr = rows.Err(); queryErr != nil {
			rows.Close()
			serverError(w, queryErr)
			return
		}
		rows.Close()
		var ok bool
		sourceActive, ok = lockedTypes[typeID]
		if !ok {
			resourceNotFound(w, "节目类型")
			return
		}
		if in.ReplacementTypeID == "" || in.ReplacementTypeID == typeID || !lockedTypes[in.ReplacementTypeID] {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "请选择其他启用中的目标类型")
			return
		}
	} else if err = tx.QueryRow(r.Context(), `SELECT is_active FROM program_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE`, typeID, access.WorkspaceID).Scan(&sourceActive); err == pgx.ErrNoRows {
		resourceNotFound(w, "节目类型")
		return
	} else if err != nil {
		serverError(w, err)
		return
	}
	// Lock live references before counting or changing them. This keeps the
	// count, migration/unassignment, and soft delete in one consistent view.
	programRows, err := tx.Query(r.Context(), `SELECT id FROM programs WHERE workspace_id=$1 AND program_type_id=$2 AND deleted_at IS NULL FOR UPDATE`, access.WorkspaceID, typeID)
	if err != nil {
		serverError(w, err)
		return
	}
	for programRows.Next() {
		var programID string
		if err = programRows.Scan(&programID); err != nil {
			programRows.Close()
			serverError(w, err)
			return
		}
	}
	if err = programRows.Err(); err != nil {
		programRows.Close()
		serverError(w, err)
		return
	}
	programRows.Close()
	var count int
	if err = tx.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM programs WHERE workspace_id=$1 AND program_type_id=$2 AND deleted_at IS NULL`, access.WorkspaceID, typeID).Scan(&count); err != nil {
		serverError(w, err)
		return
	}
	if in.Strategy == "delete" && count > 0 {
		errorJSONWithFields(w, http.StatusConflict, "program_type_in_use", "该节目类型仍被节目使用", map[string]any{"program_count": count})
		return
	}
	if in.Strategy == "move" {
		if _, err = tx.Exec(r.Context(), `UPDATE programs SET program_type_id=$1,updated_at=NOW() WHERE workspace_id=$2 AND program_type_id=$3 AND deleted_at IS NULL`, in.ReplacementTypeID, access.WorkspaceID, typeID); err != nil {
			serverError(w, err)
			return
		}
	}
	if in.Strategy == "unassign" {
		if _, err = tx.Exec(r.Context(), `UPDATE programs SET program_type_id=NULL,updated_at=NOW() WHERE workspace_id=$1 AND program_type_id=$2 AND deleted_at IS NULL`, access.WorkspaceID, typeID); err != nil {
			serverError(w, err)
			return
		}
	}
	if _, err = tx.Exec(r.Context(), `UPDATE program_types SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, typeID, access.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted", "strategy": in.Strategy, "program_count": count})
}

func (app *application) listPrograms(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	types := arrayParam(r, "type_id")
	ss := statuses(r)
	tags := arrayParam(r, "tag")
	min, _ := strconv.Atoi(r.URL.Query().Get("min_duration_seconds"))
	max, _ := strconv.Atoi(r.URL.Query().Get("max_duration_seconds"))
	offset, limit := listOffset(r), listLimit(r)
	where := []string{"workspace_id=$1", "deleted_at IS NULL"}
	args := []any{access.WorkspaceID}
	add := func(clause string, value any) {
		args = append(args, value)
		placeholder := strconv.Itoa(len(args))
		if strings.HasSuffix(clause, "ANY") {
			where = append(where, clause+"($"+placeholder+")")
		} else if strings.HasSuffix(clause, "&&") {
			where = append(where, clause+"$"+placeholder)
		} else {
			where = append(where, clause+"=$"+placeholder)
		}
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		where = append(where, "(name ILIKE $"+strconv.Itoa(len(args))+" OR description ILIKE $"+strconv.Itoa(len(args))+")")
	}
	if len(types) > 0 {
		hasUnassigned := false
		typeIDs := make([]string, 0, len(types))
		for _, typeID := range types {
			if typeID == "unassigned" {
				hasUnassigned = true
			} else {
				typeIDs = append(typeIDs, typeID)
			}
		}
		if hasUnassigned && len(typeIDs) > 0 {
			args = append(args, typeIDs)
			where = append(where, "(program_type_id = ANY($"+strconv.Itoa(len(args)+0)+") OR program_type_id IS NULL)")
		} else if hasUnassigned {
			where = append(where, "program_type_id IS NULL")
		} else if len(typeIDs) > 0 {
			add("program_type_id = ANY", typeIDs)
		}
	}
	if len(ss) > 0 {
		add("status = ANY", ss)
	}
	if len(tags) > 0 {
		add("tags &&", tags)
	}
	if r.URL.Query().Get("min_duration_seconds") != "" {
		add("default_duration_seconds >=", min)
	}
	if r.URL.Query().Get("max_duration_seconds") != "" {
		add("default_duration_seconds <=", max)
	}
	base := strings.Join(where, " AND ")
	var total int
	if err := app.db.QueryRow(r.Context(), "SELECT count(*) FROM programs WHERE "+base, args...).Scan(&total); err != nil {
		serverError(w, err)
		return
	}
	args = append(args, limit, offset)
	rows, err := app.db.Query(r.Context(), `SELECT id,workspace_id,name,program_type_id,default_duration_seconds,tags,description,technical_notes,origin,status,created_at,updated_at FROM programs WHERE `+base+` ORDER BY updated_at DESC,id DESC LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []program{}
	for rows.Next() {
		var x program
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.ProgramTypeID, &x.DefaultDurationSeconds, &x.Tags, &x.Description, &x.TechnicalNotes, &x.Origin, &x.Status, &x.CreatedAt, &x.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, x)
	}
	if rows.Err() != nil {
		serverError(w, rows.Err())
		return
	}
	var next *string
	if offset+len(items) < total {
		s := strconv.Itoa(offset + len(items))
		next = &s
	}
	writeJSON(w, 200, resourceList[program]{items, next, total})
}
func (app *application) createProgram(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name                   string   `json:"name"`
		ProgramTypeID          *string  `json:"program_type_id"`
		DefaultDurationSeconds *int     `json:"default_duration_seconds"`
		Tags                   []string `json:"tags"`
		Description            string   `json:"description"`
		TechnicalNotes         string   `json:"technical_notes"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, ok := validName(w, in.Name, "节目名称")
	if !ok {
		return
	}
	if in.DefaultDurationSeconds != nil && *in.DefaultDurationSeconds < 0 {
		errorJSON(w, 400, "invalid_input", "时长不能小于 0")
		return
	}
	access := resourceAccess(r)
	if in.ProgramTypeID != nil {
		exists, err := programTypeExists(r.Context(), app.db, access.WorkspaceID, *in.ProgramTypeID, true)
		if err != nil {
			serverError(w, err)
			return
		}
		if !exists {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "节目类型无效、未启用或不属于当前工作空间")
			return
		}
	}
	var item program
	err := app.db.QueryRow(r.Context(), `INSERT INTO programs(id,workspace_id,name,program_type_id,default_duration_seconds,tags,description,technical_notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,workspace_id,name,program_type_id,default_duration_seconds,tags,description,technical_notes,origin,status,created_at,updated_at`, newID(), access.WorkspaceID, name, in.ProgramTypeID, in.DefaultDurationSeconds, normalizedStrings(in.Tags, 40), strings.TrimSpace(in.Description), strings.TrimSpace(in.TechnicalNotes), access.UserID).Scan(&item.ID, &item.WorkspaceID, &item.Name, &item.ProgramTypeID, &item.DefaultDurationSeconds, &item.Tags, &item.Description, &item.TechnicalNotes, &item.Origin, &item.Status, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		errorJSON(w, 400, "invalid_input", "节目类型无效或不属于当前工作空间")
		return
	}
	writeJSON(w, 201, item)
}
func (app *application) getProgram(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	var x program
	err := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,name,program_type_id,default_duration_seconds,tags,description,technical_notes,origin,status,created_at,updated_at FROM programs WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, r.PathValue("programId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.ProgramTypeID, &x.DefaultDurationSeconds, &x.Tags, &x.Description, &x.TechnicalNotes, &x.Origin, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "节目")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}
func (app *application) updateProgram(w http.ResponseWriter, r *http.Request) {
	var in updateProgramPayload
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name != nil {
		if _, ok := validName(w, *in.Name, "节目名称"); !ok {
			return
		}
	}
	if in.DefaultDurationSeconds != nil && *in.DefaultDurationSeconds < 0 {
		errorJSON(w, 400, "invalid_input", "时长不能小于 0")
		return
	}
	if in.Status != nil && !validOne(*in.Status, "active", "archived") {
		errorJSON(w, 400, "invalid_input", "节目状态无效")
		return
	}
	access := resourceAccess(r)
	if in.ProgramTypeIDPresent && in.ProgramTypeID != nil {
		exists, err := programTypeExists(r.Context(), app.db, access.WorkspaceID, *in.ProgramTypeID, false)
		if err != nil {
			serverError(w, err)
			return
		}
		if !exists {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "节目类型无效或不属于当前工作空间")
			return
		}
	}
	var tags any
	if in.Tags != nil {
		tags = normalizedStrings(*in.Tags, 40)
	}
	var x program
	err := app.db.QueryRow(r.Context(), `UPDATE programs SET name=COALESCE($1,name),program_type_id=CASE WHEN $10 THEN $2 ELSE program_type_id END,default_duration_seconds=COALESCE($3,default_duration_seconds),tags=COALESCE($4,tags),description=COALESCE($5,description),technical_notes=COALESCE($6,technical_notes),status=COALESCE($7,status),archived_at=CASE WHEN COALESCE($7,status)='archived' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$8 AND workspace_id=$9 AND deleted_at IS NULL RETURNING id,workspace_id,name,program_type_id,default_duration_seconds,tags,description,technical_notes,origin,status,created_at,updated_at`, nullableTrimmed(in.Name), in.ProgramTypeID, in.DefaultDurationSeconds, tags, nullableTrimmed(in.Description), nullableTrimmed(in.TechnicalNotes), in.Status, r.PathValue("programId"), access.WorkspaceID, in.ProgramTypeIDPresent).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.ProgramTypeID, &x.DefaultDurationSeconds, &x.Tags, &x.Description, &x.TechnicalNotes, &x.Origin, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "节目")
		return
	}
	if err != nil {
		errorJSON(w, 400, "invalid_input", "节目类型无效或不属于当前工作空间")
		return
	}
	writeJSON(w, 200, x)
}

// People, organizations, venues and equipment share concise CRUD handlers.
// Their list APIs deliberately use only static SQL fragments and validated values.

func (app *application) listPeople(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	kinds := arrayParam(r, "kind")
	ss := statuses(r)
	skills := arrayParam(r, "skill")
	tags := arrayParam(r, "tag")
	where := []string{"workspace_id=$1", "deleted_at IS NULL"}
	args := []any{access.WorkspaceID}
	add := func(c string, v any) {
		args = append(args, v)
		p := strconv.Itoa(len(args))
		if strings.HasSuffix(c, "ANY") {
			where = append(where, c+"($"+p+")")
		} else if strings.HasSuffix(c, "&&") {
			where = append(where, c+"$"+p)
		} else {
			where = append(where, c+"=$"+p)
		}
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		where = append(where, "(display_name ILIKE $"+strconv.Itoa(len(args))+" OR primary_email ILIKE $"+strconv.Itoa(len(args))+" OR primary_phone ILIKE $"+strconv.Itoa(len(args))+")")
	}
	if len(kinds) > 0 {
		add("kind = ANY", kinds)
	}
	if len(ss) > 0 {
		add("status = ANY", ss)
	}
	if len(skills) > 0 {
		add("skills &&", skills)
	}
	if len(tags) > 0 {
		add("tags &&", tags)
	}
	app.writePeopleList(w, r, where, args)
}
func (app *application) writePeopleList(w http.ResponseWriter, r *http.Request, where []string, args []any) {
	base := strings.Join(where, " AND ")
	var total int
	if err := app.db.QueryRow(r.Context(), "SELECT count(*) FROM people WHERE "+base, args...).Scan(&total); err != nil {
		serverError(w, err)
		return
	}
	offset, limit := listOffset(r), listLimit(r)
	args = append(args, limit, offset)
	rows, err := app.db.Query(r.Context(), `SELECT id,workspace_id,display_name,kind,primary_email,primary_phone,bio,skills,tags,status,created_at,updated_at FROM people WHERE `+base+` ORDER BY updated_at DESC,id DESC LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []person{}
	for rows.Next() {
		var x person
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.DisplayName, &x.Kind, &x.PrimaryEmail, &x.PrimaryPhone, &x.Bio, &x.Skills, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, x)
	}
	var next *string
	if offset+len(items) < total {
		s := strconv.Itoa(offset + len(items))
		next = &s
	}
	writeJSON(w, 200, resourceList[person]{items, next, total})
}
func (app *application) createPerson(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DisplayName  string   `json:"display_name"`
		Kind         string   `json:"kind"`
		PrimaryEmail string   `json:"primary_email"`
		PrimaryPhone string   `json:"primary_phone"`
		Bio          string   `json:"bio"`
		Skills       []string `json:"skills"`
		Tags         []string `json:"tags"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, ok := validName(w, in.DisplayName, "人员姓名")
	if !ok {
		return
	}
	if !validOne(in.Kind, "artist", "crew", "contact") {
		errorJSON(w, 400, "invalid_input", "人员类别无效")
		return
	}
	access := resourceAccess(r)
	var x person
	err := app.db.QueryRow(r.Context(), `INSERT INTO people(id,workspace_id,display_name,kind,primary_email,primary_phone,bio,skills,tags,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,workspace_id,display_name,kind,primary_email,primary_phone,bio,skills,tags,status,created_at,updated_at`, newID(), access.WorkspaceID, name, in.Kind, strings.TrimSpace(in.PrimaryEmail), strings.TrimSpace(in.PrimaryPhone), strings.TrimSpace(in.Bio), normalizedStrings(in.Skills, 40), normalizedStrings(in.Tags, 40), access.UserID).Scan(&x.ID, &x.WorkspaceID, &x.DisplayName, &x.Kind, &x.PrimaryEmail, &x.PrimaryPhone, &x.Bio, &x.Skills, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, x)
}
func (app *application) getPerson(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	var x person
	err := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,display_name,kind,primary_email,primary_phone,bio,skills,tags,status,created_at,updated_at FROM people WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, r.PathValue("personId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.DisplayName, &x.Kind, &x.PrimaryEmail, &x.PrimaryPhone, &x.Bio, &x.Skills, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "人员")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}
func (app *application) updatePerson(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DisplayName  *string   `json:"display_name"`
		Kind         *string   `json:"kind"`
		PrimaryEmail *string   `json:"primary_email"`
		PrimaryPhone *string   `json:"primary_phone"`
		Bio          *string   `json:"bio"`
		Skills       *[]string `json:"skills"`
		Tags         *[]string `json:"tags"`
		Status       *string   `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.DisplayName != nil {
		if _, ok := validName(w, *in.DisplayName, "人员姓名"); !ok {
			return
		}
	}
	if in.Kind != nil && !validOne(*in.Kind, "artist", "crew", "contact") {
		errorJSON(w, 400, "invalid_input", "人员类别无效")
		return
	}
	if in.Status != nil && !validOne(*in.Status, "active", "archived") {
		errorJSON(w, 400, "invalid_input", "人员状态无效")
		return
	}
	var skills, tags any
	if in.Skills != nil {
		skills = normalizedStrings(*in.Skills, 40)
	}
	if in.Tags != nil {
		tags = normalizedStrings(*in.Tags, 40)
	}
	access := resourceAccess(r)
	var x person
	err := app.db.QueryRow(r.Context(), `UPDATE people SET display_name=COALESCE($1,display_name),kind=COALESCE($2,kind),primary_email=COALESCE($3,primary_email),primary_phone=COALESCE($4,primary_phone),bio=COALESCE($5,bio),skills=COALESCE($6,skills),tags=COALESCE($7,tags),status=COALESCE($8,status),archived_at=CASE WHEN COALESCE($8,status)='archived' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$9 AND workspace_id=$10 AND deleted_at IS NULL RETURNING id,workspace_id,display_name,kind,primary_email,primary_phone,bio,skills,tags,status,created_at,updated_at`, nullableTrimmed(in.DisplayName), in.Kind, nullableTrimmed(in.PrimaryEmail), nullableTrimmed(in.PrimaryPhone), nullableTrimmed(in.Bio), skills, tags, in.Status, r.PathValue("personId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.DisplayName, &x.Kind, &x.PrimaryEmail, &x.PrimaryPhone, &x.Bio, &x.Skills, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "人员")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}

func (app *application) listOrganizations(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	kinds := arrayParam(r, "kind")
	cities := arrayParam(r, "city")
	ss := statuses(r)
	tags := arrayParam(r, "tag")
	where := []string{"workspace_id=$1", "deleted_at IS NULL"}
	args := []any{access.WorkspaceID}
	add := func(c string, v any) {
		args = append(args, v)
		p := strconv.Itoa(len(args))
		if strings.HasSuffix(c, "ANY") {
			where = append(where, c+"($"+p+")")
		} else if strings.HasSuffix(c, "&&") {
			where = append(where, c+"$"+p)
		} else {
			where = append(where, c+"=$"+p)
		}
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		where = append(where, "(name ILIKE $"+strconv.Itoa(len(args))+" OR description ILIKE $"+strconv.Itoa(len(args))+")")
	}
	if len(kinds) > 0 {
		add("kind = ANY", kinds)
	}
	if len(cities) > 0 {
		add("city = ANY", cities)
	}
	if len(ss) > 0 {
		add("status = ANY", ss)
	}
	if len(tags) > 0 {
		add("tags &&", tags)
	}
	app.writeOrganizationsList(w, r, where, args)
}
func (app *application) writeOrganizationsList(w http.ResponseWriter, r *http.Request, where []string, args []any) {
	base := strings.Join(where, " AND ")
	var total int
	if err := app.db.QueryRow(r.Context(), "SELECT count(*) FROM organizations WHERE "+base, args...).Scan(&total); err != nil {
		serverError(w, err)
		return
	}
	offset, limit := listOffset(r), listLimit(r)
	args = append(args, limit, offset)
	rows, err := app.db.Query(r.Context(), `SELECT id,workspace_id,name,kind,city,address,description,tags,status,created_at,updated_at FROM organizations WHERE `+base+` ORDER BY updated_at DESC,id DESC LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []organization{}
	for rows.Next() {
		var x organization
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Kind, &x.City, &x.Address, &x.Description, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, x)
	}
	var next *string
	if offset+len(items) < total {
		s := strconv.Itoa(offset + len(items))
		next = &s
	}
	writeJSON(w, 200, resourceList[organization]{items, next, total})
}
func (app *application) createOrganization(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string   `json:"name"`
		Kind        string   `json:"kind"`
		City        string   `json:"city"`
		Address     string   `json:"address"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, ok := validName(w, in.Name, "机构名称")
	if !ok {
		return
	}
	if !validOne(in.Kind, "organizer", "partner", "sponsor", "supplier", "school", "ensemble", "other") {
		errorJSON(w, 400, "invalid_input", "机构类别无效")
		return
	}
	access := resourceAccess(r)
	var x organization
	err := app.db.QueryRow(r.Context(), `INSERT INTO organizations(id,workspace_id,name,kind,city,address,description,tags,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,workspace_id,name,kind,city,address,description,tags,status,created_at,updated_at`, newID(), access.WorkspaceID, name, in.Kind, strings.TrimSpace(in.City), strings.TrimSpace(in.Address), strings.TrimSpace(in.Description), normalizedStrings(in.Tags, 40), access.UserID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Kind, &x.City, &x.Address, &x.Description, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, x)
}
func (app *application) getOrganization(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	var x organization
	err := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,name,kind,city,address,description,tags,status,created_at,updated_at FROM organizations WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, r.PathValue("organizationId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Kind, &x.City, &x.Address, &x.Description, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "机构")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}
func (app *application) updateOrganization(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        *string   `json:"name"`
		Kind        *string   `json:"kind"`
		City        *string   `json:"city"`
		Address     *string   `json:"address"`
		Description *string   `json:"description"`
		Tags        *[]string `json:"tags"`
		Status      *string   `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name != nil {
		if _, ok := validName(w, *in.Name, "机构名称"); !ok {
			return
		}
	}
	if in.Kind != nil && !validOne(*in.Kind, "organizer", "partner", "sponsor", "supplier", "school", "ensemble", "other") {
		errorJSON(w, 400, "invalid_input", "机构类别无效")
		return
	}
	if in.Status != nil && !validOne(*in.Status, "active", "archived") {
		errorJSON(w, 400, "invalid_input", "机构状态无效")
		return
	}
	var tags any
	if in.Tags != nil {
		tags = normalizedStrings(*in.Tags, 40)
	}
	access := resourceAccess(r)
	var x organization
	err := app.db.QueryRow(r.Context(), `UPDATE organizations SET name=COALESCE($1,name),kind=COALESCE($2,kind),city=COALESCE($3,city),address=COALESCE($4,address),description=COALESCE($5,description),tags=COALESCE($6,tags),status=COALESCE($7,status),archived_at=CASE WHEN COALESCE($7,status)='archived' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$8 AND workspace_id=$9 AND deleted_at IS NULL RETURNING id,workspace_id,name,kind,city,address,description,tags,status,created_at,updated_at`, nullableTrimmed(in.Name), in.Kind, nullableTrimmed(in.City), nullableTrimmed(in.Address), nullableTrimmed(in.Description), tags, in.Status, r.PathValue("organizationId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Kind, &x.City, &x.Address, &x.Description, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "机构")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}

func (app *application) listVenues(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	kinds := arrayParam(r, "kind")
	typeIDs := arrayParam(r, "venue_type_id")
	cities := arrayParam(r, "city")
	ss := statuses(r)
	tags := arrayParam(r, "tag")
	where := []string{"workspace_id=$1", "deleted_at IS NULL"}
	args := []any{access.WorkspaceID}
	add := func(c string, v any) {
		args = append(args, v)
		p := strconv.Itoa(len(args))
		if strings.HasSuffix(c, "ANY") {
			where = append(where, c+"($"+p+")")
		} else if strings.HasSuffix(c, "&&") {
			where = append(where, c+"$"+p)
		} else {
			where = append(where, c+"=$"+p)
		}
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		where = append(where, "(name ILIKE $"+strconv.Itoa(len(args))+" OR address ILIKE $"+strconv.Itoa(len(args))+")")
	}
	if len(kinds) > 0 {
		add("kind = ANY", kinds)
	}
	if len(typeIDs) > 0 {
		add("venue_type_id = ANY", typeIDs)
	}
	if len(cities) > 0 {
		add("city = ANY", cities)
	}
	if len(ss) > 0 {
		add("status = ANY", ss)
	}
	if len(tags) > 0 {
		add("tags &&", tags)
	}
	base := strings.Join(where, " AND ")
	var total int
	if err := app.db.QueryRow(r.Context(), "SELECT count(*) FROM venues WHERE "+base, args...).Scan(&total); err != nil {
		serverError(w, err)
		return
	}
	offset, limit := listOffset(r), listLimit(r)
	args = append(args, limit, offset)
	rows, err := app.db.Query(r.Context(), `SELECT id,workspace_id,name,kind,venue_type_id,city,address,timezone,description,tags,status,created_at,updated_at FROM venues WHERE `+base+` ORDER BY updated_at DESC,id DESC LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []venue{}
	for rows.Next() {
		var x venue
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Kind, &x.VenueTypeID, &x.City, &x.Address, &x.Timezone, &x.Description, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, x)
	}
	var next *string
	if offset+len(items) < total {
		s := strconv.Itoa(offset + len(items))
		next = &s
	}
	writeJSON(w, 200, resourceList[venue]{items, next, total})
}
func (app *application) createVenue(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string   `json:"name"`
		Kind        string   `json:"kind"`
		VenueTypeID *string  `json:"venue_type_id"`
		City        string   `json:"city"`
		Address     string   `json:"address"`
		Timezone    string   `json:"timezone"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, ok := validName(w, in.Name, "场地名称")
	if !ok {
		return
	}
	if in.VenueTypeID == nil && !validOne(in.Kind, "theatre", "hall", "club", "outdoor", "other") {
		errorJSON(w, 400, "invalid_input", "场地类型无效")
		return
	}
	if in.Timezone != "" && !validProductionTimezone(in.Timezone) {
		errorJSON(w, 400, "invalid_input", "场地时区无效")
		return
	}
	if in.Timezone == "" {
		in.Timezone = "Asia/Shanghai"
	}
	access := resourceAccess(r)
	venueTypeID, kind, err := app.resolveVenueType(r.Context(), access.WorkspaceID, in.VenueTypeID, in.Kind)
	if err != nil {
		errorJSON(w, 400, "invalid_input", "场地类型无效、未启用或不属于当前工作空间")
		return
	}
	var x venue
	err = app.db.QueryRow(r.Context(), `INSERT INTO venues(id,workspace_id,name,kind,venue_type_id,city,address,timezone,description,tags,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,workspace_id,name,kind,venue_type_id,city,address,timezone,description,tags,status,created_at,updated_at`, newID(), access.WorkspaceID, name, kind, venueTypeID, strings.TrimSpace(in.City), strings.TrimSpace(in.Address), in.Timezone, strings.TrimSpace(in.Description), normalizedStrings(in.Tags, 40), access.UserID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Kind, &x.VenueTypeID, &x.City, &x.Address, &x.Timezone, &x.Description, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, x)
}
func (app *application) getVenue(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	var x venue
	err := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,name,kind,venue_type_id,city,address,timezone,description,tags,status,created_at,updated_at FROM venues WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, r.PathValue("venueId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Kind, &x.VenueTypeID, &x.City, &x.Address, &x.Timezone, &x.Description, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "场地")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}
func (app *application) updateVenue(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        *string   `json:"name"`
		Kind        *string   `json:"kind"`
		VenueTypeID *string   `json:"venue_type_id"`
		City        *string   `json:"city"`
		Address     *string   `json:"address"`
		Timezone    *string   `json:"timezone"`
		Description *string   `json:"description"`
		Tags        *[]string `json:"tags"`
		Status      *string   `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name != nil {
		if _, ok := validName(w, *in.Name, "场地名称"); !ok {
			return
		}
	}
	if in.Timezone != nil && !validProductionTimezone(*in.Timezone) {
		errorJSON(w, 400, "invalid_input", "场地时区无效")
		return
	}
	if in.Status != nil && !validOne(*in.Status, "active", "archived") {
		errorJSON(w, 400, "invalid_input", "场地状态无效")
		return
	}
	var tags any
	if in.Tags != nil {
		tags = normalizedStrings(*in.Tags, 40)
	}
	access := resourceAccess(r)
	var venueTypeID *string
	var resolvedLegacyKind *string
	if in.VenueTypeID != nil || in.Kind != nil {
		resolved, resolvedKind, resolveErr := app.resolveVenueType(r.Context(), access.WorkspaceID, in.VenueTypeID, valueOrEmpty(in.Kind))
		if resolveErr != nil {
			errorJSON(w, 400, "invalid_input", "场地类型无效、未启用或不属于当前工作空间")
			return
		}
		venueTypeID = &resolved
		resolvedLegacyKind = &resolvedKind
	}
	var x venue
	legacyKind := resolvedLegacyKind
	err := app.db.QueryRow(r.Context(), `UPDATE venues SET name=COALESCE($1,name),kind=COALESCE($2,kind),venue_type_id=COALESCE($3,venue_type_id),city=COALESCE($4,city),address=COALESCE($5,address),timezone=COALESCE($6,timezone),description=COALESCE($7,description),tags=COALESCE($8,tags),status=COALESCE($9,status),archived_at=CASE WHEN COALESCE($9,status)='archived' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$10 AND workspace_id=$11 AND deleted_at IS NULL RETURNING id,workspace_id,name,kind,venue_type_id,city,address,timezone,description,tags,status,created_at,updated_at`, nullableTrimmed(in.Name), legacyKind, venueTypeID, nullableTrimmed(in.City), nullableTrimmed(in.Address), in.Timezone, nullableTrimmed(in.Description), tags, in.Status, r.PathValue("venueId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Kind, &x.VenueTypeID, &x.City, &x.Address, &x.Timezone, &x.Description, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "场地")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}

func (app *application) listEquipment(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	categories := arrayParam(r, "category")
	ownerships := arrayParam(r, "ownership")
	ss := statuses(r)
	tags := arrayParam(r, "tag")
	where := []string{"workspace_id=$1", "deleted_at IS NULL"}
	args := []any{access.WorkspaceID}
	add := func(c string, v any) {
		args = append(args, v)
		p := strconv.Itoa(len(args))
		if strings.HasSuffix(c, "ANY") {
			where = append(where, c+"($"+p+")")
		} else if strings.HasSuffix(c, "&&") {
			where = append(where, c+"$"+p)
		} else {
			where = append(where, c+"=$"+p)
		}
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		where = append(where, "(name ILIKE $"+strconv.Itoa(len(args))+" OR storage_location ILIKE $"+strconv.Itoa(len(args))+")")
	}
	if len(categories) > 0 {
		add("category = ANY", categories)
	}
	if len(ownerships) > 0 {
		add("ownership = ANY", ownerships)
	}
	if len(ss) > 0 {
		add("status = ANY", ss)
	}
	if len(tags) > 0 {
		add("tags &&", tags)
	}
	base := strings.Join(where, " AND ")
	var total int
	if err := app.db.QueryRow(r.Context(), "SELECT count(*) FROM equipment_items WHERE "+base, args...).Scan(&total); err != nil {
		serverError(w, err)
		return
	}
	offset, limit := listOffset(r), listLimit(r)
	args = append(args, limit, offset)
	rows, err := app.db.Query(r.Context(), `SELECT id,workspace_id,name,category,quantity_total,unit,ownership,storage_location,technical_notes,tags,status,created_at,updated_at FROM equipment_items WHERE `+base+` ORDER BY updated_at DESC,id DESC LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []equipmentItem{}
	for rows.Next() {
		var x equipmentItem
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Category, &x.QuantityTotal, &x.Unit, &x.Ownership, &x.StorageLocation, &x.TechnicalNotes, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, x)
	}
	var next *string
	if offset+len(items) < total {
		s := strconv.Itoa(offset + len(items))
		next = &s
	}
	writeJSON(w, 200, resourceList[equipmentItem]{items, next, total})
}
func (app *application) createEquipment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name            string   `json:"name"`
		Category        string   `json:"category"`
		QuantityTotal   int      `json:"quantity_total"`
		Unit            string   `json:"unit"`
		Ownership       string   `json:"ownership"`
		StorageLocation string   `json:"storage_location"`
		TechnicalNotes  string   `json:"technical_notes"`
		Tags            []string `json:"tags"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, ok := validName(w, in.Name, "设备名称")
	if !ok {
		return
	}
	if !validOne(in.Category, "audio", "lighting", "video", "stage", "power", "other") || !validOne(in.Ownership, "owned", "rented") || in.QuantityTotal < 0 {
		errorJSON(w, 400, "invalid_input", "设备类别、归属或数量无效")
		return
	}
	if strings.TrimSpace(in.Unit) == "" {
		in.Unit = "件"
	}
	access := resourceAccess(r)
	var x equipmentItem
	err := app.db.QueryRow(r.Context(), `INSERT INTO equipment_items(id,workspace_id,name,category,quantity_total,unit,ownership,storage_location,technical_notes,tags,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,workspace_id,name,category,quantity_total,unit,ownership,storage_location,technical_notes,tags,status,created_at,updated_at`, newID(), access.WorkspaceID, name, in.Category, in.QuantityTotal, strings.TrimSpace(in.Unit), in.Ownership, strings.TrimSpace(in.StorageLocation), strings.TrimSpace(in.TechnicalNotes), normalizedStrings(in.Tags, 40), access.UserID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Category, &x.QuantityTotal, &x.Unit, &x.Ownership, &x.StorageLocation, &x.TechnicalNotes, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, x)
}
func (app *application) getEquipment(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	var x equipmentItem
	err := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,name,category,quantity_total,unit,ownership,storage_location,technical_notes,tags,status,created_at,updated_at FROM equipment_items WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, r.PathValue("equipmentId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Category, &x.QuantityTotal, &x.Unit, &x.Ownership, &x.StorageLocation, &x.TechnicalNotes, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "设备")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}
func (app *application) updateEquipment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name            *string   `json:"name"`
		Category        *string   `json:"category"`
		QuantityTotal   *int      `json:"quantity_total"`
		Unit            *string   `json:"unit"`
		Ownership       *string   `json:"ownership"`
		StorageLocation *string   `json:"storage_location"`
		TechnicalNotes  *string   `json:"technical_notes"`
		Tags            *[]string `json:"tags"`
		Status          *string   `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name != nil {
		if _, ok := validName(w, *in.Name, "设备名称"); !ok {
			return
		}
	}
	if in.Category != nil && !validOne(*in.Category, "audio", "lighting", "video", "stage", "power", "other") {
		errorJSON(w, 400, "invalid_input", "设备类别无效")
		return
	}
	if in.Ownership != nil && !validOne(*in.Ownership, "owned", "rented") {
		errorJSON(w, 400, "invalid_input", "设备归属无效")
		return
	}
	if in.QuantityTotal != nil && *in.QuantityTotal < 0 {
		errorJSON(w, 400, "invalid_input", "设备数量不能小于 0")
		return
	}
	if in.Status != nil && !validOne(*in.Status, "active", "maintenance", "archived") {
		errorJSON(w, 400, "invalid_input", "设备状态无效")
		return
	}
	var tags any
	if in.Tags != nil {
		tags = normalizedStrings(*in.Tags, 40)
	}
	access := resourceAccess(r)
	var x equipmentItem
	err := app.db.QueryRow(r.Context(), `UPDATE equipment_items SET name=COALESCE($1,name),category=COALESCE($2,category),quantity_total=COALESCE($3,quantity_total),unit=COALESCE($4,unit),ownership=COALESCE($5,ownership),storage_location=COALESCE($6,storage_location),technical_notes=COALESCE($7,technical_notes),tags=COALESCE($8,tags),status=COALESCE($9,status),archived_at=CASE WHEN COALESCE($9,status)='archived' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$10 AND workspace_id=$11 AND deleted_at IS NULL RETURNING id,workspace_id,name,category,quantity_total,unit,ownership,storage_location,technical_notes,tags,status,created_at,updated_at`, nullableTrimmed(in.Name), in.Category, in.QuantityTotal, nullableTrimmed(in.Unit), in.Ownership, nullableTrimmed(in.StorageLocation), nullableTrimmed(in.TechnicalNotes), tags, in.Status, r.PathValue("equipmentId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.Name, &x.Category, &x.QuantityTotal, &x.Unit, &x.Ownership, &x.StorageLocation, &x.TechnicalNotes, &x.Tags, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "设备")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}

func (app *application) listOrganizationContacts(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	rows, err := app.db.Query(r.Context(), `SELECT c.id,c.workspace_id,c.organization_id,c.person_id,c.title,c.is_primary,p.display_name,c.created_at,c.updated_at FROM organization_contacts c JOIN people p ON p.id=c.person_id AND p.workspace_id=c.workspace_id WHERE c.workspace_id=$1 AND c.organization_id=$2 AND c.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY c.is_primary DESC,p.display_name,c.id`, access.WorkspaceID, r.PathValue("organizationId"))
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []organizationContact{}
	for rows.Next() {
		var x organizationContact
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.OrganizationID, &x.PersonID, &x.Title, &x.IsPrimary, &x.PersonName, &x.CreatedAt, &x.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, x)
	}
	writeJSON(w, 200, items)
}
func (app *application) createOrganizationContact(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PersonID  string `json:"person_id"`
		Title     string `json:"title"`
		IsPrimary bool   `json:"is_primary"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.PersonID) == "" {
		errorJSON(w, 400, "invalid_input", "请选择人员")
		return
	}
	access := resourceAccess(r)
	orgID := r.PathValue("organizationId")
	var x organizationContact
	err := app.db.QueryRow(r.Context(), `INSERT INTO organization_contacts(id,workspace_id,organization_id,person_id,title,is_primary,created_by) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM organizations WHERE id=$3 AND workspace_id=$2 AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM people WHERE id=$4 AND workspace_id=$2 AND deleted_at IS NULL) RETURNING id,workspace_id,organization_id,person_id,title,is_primary,(SELECT display_name FROM people WHERE id=person_id),created_at,updated_at`, newID(), access.WorkspaceID, orgID, strings.TrimSpace(in.PersonID), strings.TrimSpace(in.Title), in.IsPrimary, access.UserID).Scan(&x.ID, &x.WorkspaceID, &x.OrganizationID, &x.PersonID, &x.Title, &x.IsPrimary, &x.PersonName, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		errorJSON(w, 404, "resource_not_found", "机构或人员不存在")
		return
	}
	if err != nil {
		errorJSON(w, 400, "invalid_input", "该人员已是机构联系人")
		return
	}
	writeJSON(w, 201, x)
}
func (app *application) updateOrganizationContact(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title     *string `json:"title"`
		IsPrimary *bool   `json:"is_primary"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	access := resourceAccess(r)
	var x organizationContact
	err := app.db.QueryRow(r.Context(), `UPDATE organization_contacts SET title=COALESCE($1,title),is_primary=COALESCE($2,is_primary),updated_at=NOW() WHERE id=$3 AND organization_id=$4 AND workspace_id=$5 AND deleted_at IS NULL RETURNING id,workspace_id,organization_id,person_id,title,is_primary,(SELECT display_name FROM people WHERE id=person_id),created_at,updated_at`, nullableTrimmed(in.Title), in.IsPrimary, r.PathValue("contactId"), r.PathValue("organizationId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.OrganizationID, &x.PersonID, &x.Title, &x.IsPrimary, &x.PersonName, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "联系人关联")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}

func (app *application) listVenueSpaces(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	rows, err := app.db.Query(r.Context(), `SELECT id,workspace_id,venue_id,name,capacity,technical_notes,is_primary,status,created_at,updated_at FROM venue_spaces WHERE workspace_id=$1 AND venue_id=$2 AND deleted_at IS NULL ORDER BY is_primary DESC,name,id`, access.WorkspaceID, r.PathValue("venueId"))
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []venueSpace{}
	for rows.Next() {
		var x venueSpace
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.VenueID, &x.Name, &x.Capacity, &x.TechnicalNotes, &x.IsPrimary, &x.Status, &x.CreatedAt, &x.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, x)
	}
	writeJSON(w, 200, items)
}
func (app *application) createVenueSpace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name           string `json:"name"`
		Capacity       *int   `json:"capacity"`
		TechnicalNotes string `json:"technical_notes"`
		IsPrimary      bool   `json:"is_primary"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name, ok := validName(w, in.Name, "空间名称")
	if !ok {
		return
	}
	if in.Capacity != nil && *in.Capacity < 0 {
		errorJSON(w, 400, "invalid_input", "容量不能小于 0")
		return
	}
	access := resourceAccess(r)
	var x venueSpace
	err := app.db.QueryRow(r.Context(), `INSERT INTO venue_spaces(id,workspace_id,venue_id,name,capacity,technical_notes,is_primary,created_by) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS(SELECT 1 FROM venues WHERE id=$3 AND workspace_id=$2 AND deleted_at IS NULL) RETURNING id,workspace_id,venue_id,name,capacity,technical_notes,is_primary,status,created_at,updated_at`, newID(), access.WorkspaceID, r.PathValue("venueId"), name, in.Capacity, strings.TrimSpace(in.TechnicalNotes), in.IsPrimary, access.UserID).Scan(&x.ID, &x.WorkspaceID, &x.VenueID, &x.Name, &x.Capacity, &x.TechnicalNotes, &x.IsPrimary, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "场地")
		return
	}
	if err != nil {
		errorJSON(w, 400, "invalid_input", "空间名称已存在或无效")
		return
	}
	writeJSON(w, 201, x)
}
func (app *application) updateVenueSpace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name           *string `json:"name"`
		Capacity       *int    `json:"capacity"`
		TechnicalNotes *string `json:"technical_notes"`
		IsPrimary      *bool   `json:"is_primary"`
		Status         *string `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name != nil {
		if _, ok := validName(w, *in.Name, "空间名称"); !ok {
			return
		}
	}
	if in.Capacity != nil && *in.Capacity < 0 {
		errorJSON(w, 400, "invalid_input", "容量不能小于 0")
		return
	}
	if in.Status != nil && !validOne(*in.Status, "active", "archived") {
		errorJSON(w, 400, "invalid_input", "空间状态无效")
		return
	}
	access := resourceAccess(r)
	var x venueSpace
	err := app.db.QueryRow(r.Context(), `UPDATE venue_spaces SET name=COALESCE($1,name),capacity=COALESCE($2,capacity),technical_notes=COALESCE($3,technical_notes),is_primary=COALESCE($4,is_primary),status=COALESCE($5,status),updated_at=NOW() WHERE id=$6 AND venue_id=$7 AND workspace_id=$8 AND deleted_at IS NULL RETURNING id,workspace_id,venue_id,name,capacity,technical_notes,is_primary,status,created_at,updated_at`, nullableTrimmed(in.Name), in.Capacity, nullableTrimmed(in.TechnicalNotes), in.IsPrimary, in.Status, r.PathValue("spaceId"), r.PathValue("venueId"), access.WorkspaceID).Scan(&x.ID, &x.WorkspaceID, &x.VenueID, &x.Name, &x.Capacity, &x.TechnicalNotes, &x.IsPrimary, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "场地空间")
		return
	}
	if err != nil {
		errorJSON(w, 400, "invalid_input", "空间名称已存在或无效")
		return
	}
	writeJSON(w, 200, x)
}

func (app *application) softDeleteResource(w http.ResponseWriter, r *http.Request, table, idParam, label string) {
	access := resourceAccess(r)
	id := r.PathValue(idParam)
	tag, err := app.db.Exec(r.Context(), `UPDATE `+table+` SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		resourceNotFound(w, label)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
func (app *application) deleteProgram(w http.ResponseWriter, r *http.Request) {
	app.softDeleteResource(w, r, "programs", "programId", "节目")
}
func (app *application) deletePerson(w http.ResponseWriter, r *http.Request) {
	app.softDeleteResource(w, r, "people", "personId", "人员")
}
func (app *application) deleteOrganization(w http.ResponseWriter, r *http.Request) {
	app.softDeleteResource(w, r, "organizations", "organizationId", "机构")
}
func (app *application) deleteVenue(w http.ResponseWriter, r *http.Request) {
	app.softDeleteResource(w, r, "venues", "venueId", "场地")
}
func (app *application) deleteEquipment(w http.ResponseWriter, r *http.Request) {
	app.softDeleteResource(w, r, "equipment_items", "equipmentId", "设备")
}
func (app *application) deleteOrganizationContact(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	tag, err := app.db.Exec(r.Context(), `UPDATE organization_contacts SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND workspace_id=$3 AND deleted_at IS NULL`, r.PathValue("contactId"), r.PathValue("organizationId"), access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		resourceNotFound(w, "联系人关联")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
func (app *application) deleteVenueSpace(w http.ResponseWriter, r *http.Request) {
	access := resourceAccess(r)
	tag, err := app.db.Exec(r.Context(), `UPDATE venue_spaces SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND venue_id=$2 AND workspace_id=$3 AND deleted_at IS NULL`, r.PathValue("spaceId"), r.PathValue("venueId"), access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		resourceNotFound(w, "场地空间")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
