package main

import (
	"net/http"
	"strings"
	"time"
)

type programSheetSegmentType struct {
	ID                     string     `json:"id"`
	WorkspaceID            string     `json:"workspace_id"`
	SystemKey              *string    `json:"system_key,omitempty"`
	Name                   string     `json:"name"`
	Category               string     `json:"category"`
	Color                  string     `json:"color"`
	DefaultDurationSeconds int        `json:"default_duration_seconds"`
	CountsTowardDuration   bool       `json:"counts_toward_duration"`
	AudienceVisible        bool       `json:"audience_visible"`
	RequiresExecution      bool       `json:"requires_execution"`
	IsSystem               bool       `json:"is_system"`
	IsActive               bool       `json:"is_active"`
	SortOrder              int        `json:"sort_order"`
	Description            string     `json:"description"`
	UsageCount             int        `json:"usage_count"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
	DeletedAt              *time.Time `json:"deleted_at,omitempty"`
}

func (app *application) listProgramSheetSegmentTypes(w http.ResponseWriter, r *http.Request) {
	_, _ = app.db.Exec(r.Context(), `INSERT INTO program_sheet_segment_types (id,workspace_id,system_key,name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,is_system,is_active,sort_order,description) SELECT $1||'-'||system_key,$1,system_key,name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,true,true,sort_order,description FROM program_sheet_segment_type_templates t WHERE NOT EXISTS (SELECT 1 FROM program_sheet_segment_types x WHERE x.workspace_id=$1 AND x.system_key=t.system_key AND x.deleted_at IS NULL)`, r.PathValue("id"))
	rows, err := app.db.Query(r.Context(), `SELECT t.id,t.workspace_id,t.system_key,t.name,t.category,t.color,t.default_duration_seconds,t.counts_toward_duration,t.audience_visible,t.requires_execution,t.is_system,t.is_active,t.sort_order,t.description,t.created_at,t.updated_at,t.deleted_at,(SELECT COUNT(*) FROM program_sheet_items i JOIN program_sheets s ON s.id=i.sheet_id WHERE s.workspace_id=t.workspace_id AND i.segment_type_id=t.id) FROM program_sheet_segment_types t WHERE t.workspace_id=$1 AND t.deleted_at IS NULL ORDER BY t.sort_order,t.id`, r.PathValue("id"))
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	out := []programSheetSegmentType{}
	for rows.Next() {
		var x programSheetSegmentType
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.SystemKey, &x.Name, &x.Category, &x.Color, &x.DefaultDurationSeconds, &x.CountsTowardDuration, &x.AudienceVisible, &x.RequiresExecution, &x.IsSystem, &x.IsActive, &x.SortOrder, &x.Description, &x.CreatedAt, &x.UpdatedAt, &x.DeletedAt, &x.UsageCount); err != nil {
			serverError(w, err)
			return
		}
		out = append(out, x)
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

func (app *application) createProgramSheetSegmentType(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.PathValue("id")
	var in struct {
		Name                   string `json:"name"`
		Category               string `json:"category"`
		Color                  string `json:"color"`
		DefaultDurationSeconds int    `json:"default_duration_seconds"`
		CountsTowardDuration   bool   `json:"counts_toward_duration"`
		AudienceVisible        bool   `json:"audience_visible"`
		RequiresExecution      bool   `json:"requires_execution"`
		IsActive               bool   `json:"is_active"`
		Description            string `json:"description"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		errorJSON(w, 400, "invalid_input", "环节类型名称不能为空")
		return
	}
	if in.Category == "" {
		in.Category = "自定义"
	}
	if in.Color == "" {
		in.Color = "#64748b"
	}
	if in.DefaultDurationSeconds < 0 {
		errorJSON(w, 400, "invalid_input", "默认时长不能为负数")
		return
	}
	id := newID()
	var x programSheetSegmentType
	err := app.db.QueryRow(r.Context(), `INSERT INTO program_sheet_segment_types (id,workspace_id,name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,is_active,sort_order,description,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM program_sheet_segment_types WHERE workspace_id=$2 AND deleted_at IS NULL),$11,$12) RETURNING id,workspace_id,system_key,name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,is_system,is_active,sort_order,description,created_at,updated_at,deleted_at`, id, workspaceID, in.Name, in.Category, in.Color, in.DefaultDurationSeconds, in.CountsTowardDuration, in.AudienceVisible, in.RequiresExecution, in.IsActive, in.Description, claims(r).Subject).Scan(&x.ID, &x.WorkspaceID, &x.SystemKey, &x.Name, &x.Category, &x.Color, &x.DefaultDurationSeconds, &x.CountsTowardDuration, &x.AudienceVisible, &x.RequiresExecution, &x.IsSystem, &x.IsActive, &x.SortOrder, &x.Description, &x.CreatedAt, &x.UpdatedAt, &x.DeletedAt)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			errorJSON(w, 409, "duplicate_name", "环节类型名称已存在")
			return
		}
		serverError(w, err)
		return
	}
	writeJSON(w, 201, x)
}

func (app *application) updateProgramSheetSegmentType(w http.ResponseWriter, r *http.Request) {
	var in map[string]any
	if !decodeJSON(w, r, &in) {
		return
	}
	id := r.PathValue("typeId")
	workspaceID := r.PathValue("id")
	var current programSheetSegmentType
	err := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,system_key,name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,is_system,is_active,sort_order,description,created_at,updated_at,deleted_at FROM program_sheet_segment_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, workspaceID).Scan(&current.ID, &current.WorkspaceID, &current.SystemKey, &current.Name, &current.Category, &current.Color, &current.DefaultDurationSeconds, &current.CountsTowardDuration, &current.AudienceVisible, &current.RequiresExecution, &current.IsSystem, &current.IsActive, &current.SortOrder, &current.Description, &current.CreatedAt, &current.UpdatedAt, &current.DeletedAt)
	if err != nil {
		errorJSON(w, 404, "not_found", "环节类型不存在")
		return
	}
	if current.IsSystem {
		for _, k := range []string{"name", "category", "color"} {
			if _, ok := in[k]; ok {
				errorJSON(w, 409, "immutable_type", "系统环节类型不能修改名称、分类或颜色")
				return
			}
		}
	}
	name := current.Name
	if v, ok := in["name"].(string); ok {
		name = strings.TrimSpace(v)
	}
	category := current.Category
	if v, ok := in["category"].(string); ok {
		category = v
	}
	color := current.Color
	if v, ok := in["color"].(string); ok {
		color = v
	}
	active := current.IsActive
	if v, ok := in["is_active"].(bool); ok {
		active = v
	}
	counts := current.CountsTowardDuration
	if v, ok := in["counts_toward_duration"].(bool); ok {
		counts = v
	}
	audience := current.AudienceVisible
	if v, ok := in["audience_visible"].(bool); ok {
		audience = v
	}
	exec := current.RequiresExecution
	if v, ok := in["requires_execution"].(bool); ok {
		exec = v
	}
	desc := current.Description
	if v, ok := in["description"].(string); ok {
		desc = v
	}
	dur := current.DefaultDurationSeconds
	if v, ok := in["default_duration_seconds"].(float64); ok {
		dur = int(v)
	}
	if current.SystemKey != nil && *current.SystemKey == "other" {
		active = true
	}
	if name == "" || dur < 0 {
		errorJSON(w, 400, "invalid_input", "环节类型参数无效")
		return
	}
	_, err = app.db.Exec(r.Context(), `UPDATE program_sheet_segment_types SET name=$1,category=$2,color=$3,default_duration_seconds=$4,counts_toward_duration=$5,audience_visible=$6,requires_execution=$7,is_active=$8,description=$9,updated_at=CASE WHEN (name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,is_active,description) IS DISTINCT FROM ($1,$2,$3,$4,$5,$6,$7,$8,$9) THEN NOW() ELSE updated_at END WHERE id=$10 AND workspace_id=$11 AND deleted_at IS NULL`, name, category, color, dur, counts, audience, exec, active, desc, id, workspaceID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			errorJSON(w, 409, "duplicate_name", "环节类型名称已存在")
			return
		}
		serverError(w, err)
		return
	}
	app.writeSegmentTypeByID(w, r, id, workspaceID)
}

func (app *application) writeSegmentTypeByID(w http.ResponseWriter, r *http.Request, id, workspaceID string) {
	var x programSheetSegmentType
	err := app.db.QueryRow(r.Context(), `SELECT t.id,t.workspace_id,t.system_key,t.name,t.category,t.color,t.default_duration_seconds,t.counts_toward_duration,t.audience_visible,t.requires_execution,t.is_system,t.is_active,t.sort_order,t.description,t.created_at,t.updated_at,t.deleted_at,(SELECT COUNT(*) FROM program_sheet_items i JOIN program_sheets s ON s.id=i.sheet_id WHERE s.workspace_id=$2 AND i.segment_type_id=t.id) FROM program_sheet_segment_types t WHERE t.id=$1 AND t.workspace_id=$2 AND t.deleted_at IS NULL`, id, workspaceID).Scan(&x.ID, &x.WorkspaceID, &x.SystemKey, &x.Name, &x.Category, &x.Color, &x.DefaultDurationSeconds, &x.CountsTowardDuration, &x.AudienceVisible, &x.RequiresExecution, &x.IsSystem, &x.IsActive, &x.SortOrder, &x.Description, &x.CreatedAt, &x.UpdatedAt, &x.DeletedAt, &x.UsageCount)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}

func (app *application) deleteProgramSheetSegmentType(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("typeId")
	var system bool
	var usage int
	err := app.db.QueryRow(r.Context(), `SELECT is_system,(SELECT COUNT(*) FROM program_sheet_items WHERE segment_type_id=$1) FROM program_sheet_segment_types WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, r.PathValue("id")).Scan(&system, &usage)
	if err != nil {
		errorJSON(w, 404, "not_found", "环节类型不存在")
		return
	}
	if system || usage > 0 {
		errorJSON(w, 409, "type_in_use", "系统类型或已使用类型不能删除，请先停用")
		return
	}
	_, err = app.db.Exec(r.Context(), `UPDATE program_sheet_segment_types SET deleted_at=NOW(),is_active=false,updated_at=NOW() WHERE id=$1`, id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (app *application) reorderProgramSheetSegmentTypes(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Items []struct {
			ID        string `json:"id"`
			SortOrder int    `json:"sort_order"`
		} `json:"items"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	ws := r.PathValue("id")
	rows, err := app.db.Query(r.Context(), `SELECT id FROM program_sheet_segment_types WHERE workspace_id=$1 AND deleted_at IS NULL`, ws)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	known := map[string]bool{}
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		known[id] = true
	}
	seen := map[string]bool{}
	for _, x := range in.Items {
		if x.SortOrder < 0 || seen[x.ID] || !known[x.ID] {
			errorJSON(w, 400, "invalid_order", "环节类型排序必须包含当前工作空间全部类型且不能重复")
			return
		}
		seen[x.ID] = true
	}
	if len(seen) != len(known) {
		errorJSON(w, 400, "invalid_order", "环节类型排序必须包含当前工作空间全部类型")
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	for _, x := range in.Items {
		if _, err = tx.Exec(r.Context(), `UPDATE program_sheet_segment_types SET sort_order=$1,updated_at=CASE WHEN sort_order IS DISTINCT FROM $1 THEN NOW() ELSE updated_at END WHERE id=$2 AND workspace_id=$3`, x.SortOrder, x.ID, ws); err != nil {
			serverError(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.listProgramSheetSegmentTypes(w, r)
}

func (app *application) restoreProgramSheetSegmentTypes(w http.ResponseWriter, r *http.Request) {
	ws := r.PathValue("id")
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), `UPDATE program_sheet_segment_types SET deleted_at=CASE WHEN is_system THEN NULL ELSE NOW() END,is_active=CASE WHEN is_system THEN true ELSE false END,updated_at=NOW() WHERE workspace_id=$1`, ws); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO program_sheet_segment_types (id,workspace_id,system_key,name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,is_system,is_active,sort_order,description) SELECT $1||system_key,$1,system_key,name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,true,true,sort_order,description FROM program_sheet_segment_type_templates WHERE NOT EXISTS (SELECT 1 FROM program_sheet_segment_types x WHERE x.workspace_id=$1 AND x.system_key=program_sheet_segment_type_templates.system_key AND x.deleted_at IS NULL)`, ws); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.listProgramSheetSegmentTypes(w, r)
}

func (app *application) migrateProgramSheetSegmentTypes(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Items []struct {
			SystemKey              *string `json:"system_key"`
			Name                   string  `json:"name"`
			Category               string  `json:"category"`
			Color                  string  `json:"color"`
			DefaultDurationSeconds int     `json:"default_duration_seconds"`
			CountsTowardDuration   bool    `json:"counts_toward_duration"`
			AudienceVisible        bool    `json:"audience_visible"`
			RequiresExecution      bool    `json:"requires_execution"`
			IsActive               bool    `json:"is_active"`
			SortOrder              int     `json:"sort_order"`
			Description            string  `json:"description"`
		} `json:"items"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	ws := r.PathValue("id")
	for _, x := range in.Items {
		if strings.TrimSpace(x.Name) == "" {
			continue
		}
		_, err := app.db.Exec(r.Context(), `INSERT INTO program_sheet_segment_types (id,workspace_id,system_key,name,category,color,default_duration_seconds,counts_toward_duration,audience_visible,requires_execution,is_system,is_active,sort_order,description,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12,$13,$14) ON CONFLICT DO NOTHING`, newID(), ws, x.SystemKey, strings.TrimSpace(x.Name), x.Category, x.Color, x.DefaultDurationSeconds, x.CountsTowardDuration, x.AudienceVisible, x.RequiresExecution, x.IsActive, x.SortOrder, x.Description, claims(r).Subject)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				continue
			}
			serverError(w, err)
			return
		}
	}
	app.restoreProgramSheetSegmentTypes(w, r)
}
