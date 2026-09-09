package main

// Program sheets are a server-owned production document.  The API deliberately
// keeps the editable document and its immutable release separate: a release is
// what share links point at, never the mutable sheet.

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

type programSheet struct {
	ID           string                   `json:"id"`
	WorkspaceID  string                   `json:"workspace_id"`
	ProductionID string                   `json:"production_id"`
	Name         string                   `json:"name"`
	Revision     int                      `json:"revision"`
	Status       string                   `json:"status"`
	ChangeNote   string                   `json:"change_note"`
	CreatedBy    string                   `json:"created_by"`
	CreatedAt    time.Time                `json:"created_at"`
	UpdatedAt    time.Time                `json:"updated_at"`
	PublishedAt  *time.Time               `json:"published_at,omitempty"`
	PublishedBy  *string                  `json:"published_by,omitempty"`
	ArchivedAt   *time.Time               `json:"archived_at,omitempty"`
	Items        []programSheetItem       `json:"items"`
	Assignments  []programSheetAssignment `json:"assignments"`
}
type programSheetItem struct {
	ID                      string    `json:"id"`
	Kind                    string    `json:"kind"`
	SortOrder               int       `json:"sort_order"`
	ProductionProgramID     *string   `json:"production_program_id,omitempty"`
	SegmentTypeID           *string   `json:"segment_type_id,omitempty"`
	TitleOverride           *string   `json:"title_override,omitempty"`
	DurationSecondsOverride *int      `json:"duration_seconds_override,omitempty"`
	CountsTowardDuration    bool      `json:"counts_toward_duration"`
	AudienceVisible         bool      `json:"audience_visible"`
	RequiresExecution       bool      `json:"requires_execution"`
	Notes                   string    `json:"notes"`
	CreatedAt               time.Time `json:"created_at"`
	UpdatedAt               time.Time `json:"updated_at"`
}
type programSheetAssignment struct {
	OccurrenceID string    `json:"occurrence_id"`
	Role         string    `json:"role"`
	AssignedBy   *string   `json:"assigned_by,omitempty"`
	AssignedAt   time.Time `json:"assigned_at"`
}
type programRelease struct {
	ID           string          `json:"id"`
	WorkspaceID  string          `json:"workspace_id"`
	ProductionID string          `json:"production_id"`
	SheetID      string          `json:"sheet_id"`
	Revision     int             `json:"revision"`
	Snapshot     json.RawMessage `json:"snapshot"`
	PublishedBy  string          `json:"published_by"`
	PublishedAt  time.Time       `json:"published_at"`
}
type programShareLink struct {
	ID             string     `json:"id"`
	ReleaseID      string     `json:"release_id"`
	AccessScope    string     `json:"access_scope"`
	LongURL        string     `json:"long_url,omitempty"`
	ShortURL       string     `json:"short_url,omitempty"`
	ShortExpiresAt time.Time  `json:"short_expires_at"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

func (app *application) requireProgramSheetPermission(permission string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var productionID string
		if err := app.db.QueryRow(r.Context(), `SELECT production_id FROM program_sheets WHERE id=$1`, r.PathValue("sheetId")).Scan(&productionID); err != nil {
			errorJSON(w, 404, "not_found", "节目单不存在")
			return
		}
		access, err := app.productionAccessFor(r.Context(), claims(r).Subject, productionID)
		if err != nil || !access.Permissions[permission] {
			errorJSON(w, 404, "not_found", "节目单不存在或无权访问")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), productionKey, access)))
	})
}

func (app *application) releaseAccess(r *http.Request, permission string) (productionAccess, error) {
	var productionID string
	if err := app.db.QueryRow(r.Context(), `SELECT production_id FROM program_sheet_releases WHERE id=$1`, r.PathValue("releaseId")).Scan(&productionID); err != nil {
		return productionAccess{}, err
	}
	access, err := app.productionAccessFor(r.Context(), claims(r).Subject, productionID)
	if err != nil || !access.Permissions[permission] {
		return productionAccess{}, pgx.ErrNoRows
	}
	return access, nil
}

func (app *application) loadProgramSheet(ctx context.Context, id string) (programSheet, error) {
	var s programSheet
	err := app.db.QueryRow(ctx, `SELECT id,workspace_id,production_id,name,revision,status,change_note,created_by,created_at,updated_at,published_at,published_by,archived_at FROM program_sheets WHERE id=$1`, id).Scan(&s.ID, &s.WorkspaceID, &s.ProductionID, &s.Name, &s.Revision, &s.Status, &s.ChangeNote, &s.CreatedBy, &s.CreatedAt, &s.UpdatedAt, &s.PublishedAt, &s.PublishedBy, &s.ArchivedAt)
	if err != nil {
		return s, err
	}
	s.Items = []programSheetItem{}
	rows, err := app.db.Query(ctx, `SELECT id,kind,sort_order,production_program_id,segment_type_id,title_override,duration_seconds_override,counts_toward_duration,audience_visible,requires_execution,notes,created_at,updated_at FROM program_sheet_items WHERE sheet_id=$1 ORDER BY sort_order,id`, id)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var i programSheetItem
		if err := rows.Scan(&i.ID, &i.Kind, &i.SortOrder, &i.ProductionProgramID, &i.SegmentTypeID, &i.TitleOverride, &i.DurationSecondsOverride, &i.CountsTowardDuration, &i.AudienceVisible, &i.RequiresExecution, &i.Notes, &i.CreatedAt, &i.UpdatedAt); err != nil {
			return s, err
		}
		s.Items = append(s.Items, i)
	}
	s.Assignments = []programSheetAssignment{}
	arows, err := app.db.Query(ctx, `SELECT occurrence_id,role,assigned_by,assigned_at FROM program_sheet_assignments WHERE sheet_id=$1 ORDER BY assigned_at,occurrence_id`, id)
	if err != nil {
		return s, err
	}
	defer arows.Close()
	for arows.Next() {
		var a programSheetAssignment
		if err := arows.Scan(&a.OccurrenceID, &a.Role, &a.AssignedBy, &a.AssignedAt); err != nil {
			return s, err
		}
		s.Assignments = append(s.Assignments, a)
	}
	return s, rows.Err()
}

func (app *application) listProductionPrograms(w http.ResponseWriter, r *http.Request) {
	productionID := r.PathValue("productionId")
	access := currentProductionAccess(r)
	rows, err := app.db.Query(r.Context(), `SELECT id,workspace_id,production_id,workspace_program_id,source_entry_id,source_kind,name,program_type_id,program_type_name,performers,duration_seconds,description,technical_notes,status,created_by,created_at,updated_at,archived_at FROM production_programs WHERE workspace_id=$1 AND production_id=$2 AND archived_at IS NULL ORDER BY updated_at DESC,id`, access.WorkspaceID, productionID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, wid, pid, wp, sourceEntry, sourceKind, name, typeID, typeName, status, createdBy string
		var performers []byte
		var duration int
		var desc, tech string
		var created, updated time.Time
		var archived *time.Time
		if err := rows.Scan(&id, &wid, &pid, &wp, &sourceEntry, &sourceKind, &name, &typeID, &typeName, &performers, &duration, &desc, &tech, &status, &createdBy, &created, &updated, &archived); err != nil {
			serverError(w, err)
			return
		}
		var pv any
		_ = json.Unmarshal(performers, &pv)
		items = append(items, map[string]any{"id": id, "workspace_id": wid, "production_id": pid, "workspace_program_id": nullIfEmpty(wp), "source_entry_id": nullIfEmpty(sourceEntry), "source_kind": sourceKind, "name": name, "program_type_id": nullIfEmpty(typeID), "program_type_name": typeName, "performers": pv, "duration_seconds": duration, "description": desc, "technical_notes": tech, "status": status, "created_by": createdBy, "created_at": created, "updated_at": updated, "archived_at": archived})
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func nullIfEmpty(v string) any {
	if v == "" {
		return nil
	}
	return v
}

func (app *application) createProductionProgram(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	var in struct {
		Name               string   `json:"name"`
		ProgramTypeID      *string  `json:"program_type_id"`
		ProgramTypeName    string   `json:"program_type_name"`
		Performers         []string `json:"performers"`
		DurationSeconds    int      `json:"duration_seconds"`
		Description        string   `json:"description"`
		TechnicalNotes     string   `json:"technical_notes"`
		SourceKind         string   `json:"source_kind"`
		WorkspaceProgramID *string  `json:"workspace_program_id"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		errorJSON(w, 400, "invalid_input", "节目名称不能为空")
		return
	}
	if in.DurationSeconds < 0 {
		errorJSON(w, 400, "invalid_input", "时长不能为负数")
		return
	}
	if in.SourceKind == "" {
		in.SourceKind = "manual"
	}
	id := newID()
	performers, _ := json.Marshal(in.Performers)
	_, err := app.db.Exec(r.Context(), `INSERT INTO production_programs (id,workspace_id,production_id,workspace_program_id,source_kind,name,program_type_id,program_type_name,performers,duration_seconds,description,technical_notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, id, access.WorkspaceID, r.PathValue("productionId"), in.WorkspaceProgramID, in.SourceKind, in.Name, in.ProgramTypeID, in.ProgramTypeName, performers, in.DurationSeconds, in.Description, in.TechnicalNotes, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"id": id})
}

func (app *application) updateProductionProgram(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	var in struct {
		Name            *string   `json:"name"`
		ProgramTypeID   *string   `json:"program_type_id"`
		ProgramTypeName *string   `json:"program_type_name"`
		Performers      *[]string `json:"performers"`
		DurationSeconds *int      `json:"duration_seconds"`
		Description     *string   `json:"description"`
		TechnicalNotes  *string   `json:"technical_notes"`
		Status          *string   `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	id := r.PathValue("programId")
	var name, typeName, desc, tech, status string
	var typeID *string
	var performers []byte
	var duration int
	err := app.db.QueryRow(r.Context(), `SELECT name,program_type_id,program_type_name,performers,duration_seconds,description,technical_notes,status FROM production_programs WHERE id=$1 AND workspace_id=$2 AND production_id=$3 AND archived_at IS NULL`, id, access.WorkspaceID, r.PathValue("productionId")).Scan(&name, &typeID, &typeName, &performers, &duration, &desc, &tech, &status)
	if err != nil {
		errorJSON(w, 404, "not_found", "节目不存在")
		return
	}
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
	}
	if in.ProgramTypeID != nil {
		typeID = in.ProgramTypeID
	}
	if in.ProgramTypeName != nil {
		typeName = *in.ProgramTypeName
	}
	if in.Performers != nil {
		performers, _ = json.Marshal(*in.Performers)
	}
	if in.DurationSeconds != nil {
		duration = *in.DurationSeconds
	}
	if in.Description != nil {
		desc = *in.Description
	}
	if in.TechnicalNotes != nil {
		tech = *in.TechnicalNotes
	}
	if in.Status != nil {
		status = *in.Status
	}
	_, err = app.db.Exec(r.Context(), `UPDATE production_programs SET name=$1,program_type_id=$2,program_type_name=$3,performers=$4,duration_seconds=$5,description=$6,technical_notes=$7,status=$8,updated_at=NOW() WHERE id=$9 AND workspace_id=$10 AND production_id=$11`, name, typeID, typeName, performers, duration, desc, tech, status, id, access.WorkspaceID, r.PathValue("productionId"))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
func (app *application) archiveProductionProgram(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	tag, err := app.db.Exec(r.Context(), `UPDATE production_programs SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND production_id=$3 AND archived_at IS NULL`, r.PathValue("programId"), access.WorkspaceID, r.PathValue("productionId"))
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		errorJSON(w, 404, "not_found", "节目不存在")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (app *application) listProgramSheets(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	rows, err := app.db.Query(r.Context(), `SELECT id FROM program_sheets WHERE workspace_id=$1 AND production_id=$2 ORDER BY revision DESC`, access.WorkspaceID, r.PathValue("productionId"))
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	result := []programSheet{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) != nil {
			serverError(w, fmt.Errorf("scan"))
			return
		}
		s, e := app.loadProgramSheet(r.Context(), id)
		if e != nil {
			serverError(w, e)
			return
		}
		result = append(result, s)
	}
	writeJSON(w, 200, map[string]any{"items": result})
}

func (app *application) getProgramSheet(w http.ResponseWriter, r *http.Request) {
	s, err := app.loadProgramSheet(r.Context(), r.PathValue("sheetId"))
	if err != nil {
		errorJSON(w, 404, "not_found", "节目单不存在")
		return
	}
	if _, err = app.productionAccessFor(r.Context(), claims(r).Subject, s.ProductionID); err != nil {
		errorJSON(w, 404, "not_found", "节目单不存在")
		return
	}
	writeJSON(w, 200, s)
}
func (app *application) createProgramSheet(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	var in struct {
		Name       string `json:"name"`
		ChangeNote string `json:"change_note"`
		Revision   int    `json:"revision"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		errorJSON(w, 400, "invalid_input", "节目单名称不能为空")
		return
	}
	if in.Revision <= 0 {
		_ = app.db.QueryRow(r.Context(), `SELECT COALESCE(MAX(revision),0)+1 FROM program_sheets WHERE production_id=$1`, r.PathValue("productionId")).Scan(&in.Revision)
	}
	id := newID()
	_, err := app.db.Exec(r.Context(), `INSERT INTO program_sheets (id,workspace_id,production_id,name,revision,change_note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, access.WorkspaceID, r.PathValue("productionId"), in.Name, in.Revision, in.ChangeNote, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	s, _ := app.loadProgramSheet(r.Context(), id)
	writeJSON(w, 201, s)
}

func (app *application) migrateProgramSheets(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	var in struct {
		State struct {
			ProductionPrograms []struct {
				ID              string   `json:"id"`
				Name            string   `json:"name"`
				ProgramTypeID   *string  `json:"programTypeId"`
				ProgramTypeName string   `json:"programTypeName"`
				Performers      []string `json:"performers"`
				DurationSeconds int      `json:"durationSeconds"`
				Description     string   `json:"description"`
				TechnicalNotes  string   `json:"technicalNotes"`
				SourceKind      string   `json:"sourceKind"`
			} `json:"productionPrograms"`
			Sheets []struct {
				ID          string                   `json:"id"`
				Name        string                   `json:"name"`
				Revision    int                      `json:"revision"`
				Status      string                   `json:"status"`
				ChangeNote  string                   `json:"changeNote"`
				Items       []programSheetItem       `json:"items"`
				Assignments []programSheetAssignment `json:"assignments"`
			} `json:"sheets"`
		} `json:"state"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	productionID := r.PathValue("productionId")
	var existing int
	if err := app.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM program_sheets WHERE production_id=$1`, productionID).Scan(&existing); err != nil {
		serverError(w, err)
		return
	}
	if existing > 0 {
		writeJSON(w, 200, map[string]any{"migrated": false, "reason": "server_data_exists"})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	programIDs := map[string]string{}
	for _, p := range in.State.ProductionPrograms {
		id := p.ID
		if id == "" {
			id = newID()
		}
		programIDs[p.ID] = id
		performers, _ := json.Marshal(p.Performers)
		if _, err = tx.Exec(r.Context(), `INSERT INTO production_programs (id,workspace_id,production_id,source_kind,name,program_type_id,program_type_name,performers,duration_seconds,description,technical_notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`, id, access.WorkspaceID, productionID, p.SourceKind, p.Name, p.ProgramTypeID, p.ProgramTypeName, performers, p.DurationSeconds, p.Description, p.TechnicalNotes, claims(r).Subject); err != nil {
			serverError(w, err)
			return
		}
	}
	for _, sheet := range in.State.Sheets {
		sheetID := sheet.ID
		if sheetID == "" {
			sheetID = newID()
		}
		revision := sheet.Revision
		if revision <= 0 {
			revision = 1
		}
		if _, err = tx.Exec(r.Context(), `INSERT INTO program_sheets (id,workspace_id,production_id,name,revision,status,change_note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, sheetID, access.WorkspaceID, productionID, strings.TrimSpace(sheet.Name), revision, sheet.Status, sheet.ChangeNote, claims(r).Subject); err != nil {
			serverError(w, err)
			return
		}
		for index, item := range sheet.Items {
			itemID := item.ID
			if itemID == "" {
				itemID = newID()
			}
			programID := item.ProductionProgramID
			if programID != nil {
				if mapped, ok := programIDs[*programID]; ok {
					programID = &mapped
				}
			}
			if _, err = tx.Exec(r.Context(), `INSERT INTO program_sheet_items (id,workspace_id,production_id,sheet_id,kind,sort_order,production_program_id,segment_type_id,title_override,duration_seconds_override,counts_toward_duration,audience_visible,requires_execution,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`, itemID, access.WorkspaceID, productionID, sheetID, item.Kind, index, programID, item.SegmentTypeID, item.TitleOverride, item.DurationSecondsOverride, item.CountsTowardDuration, item.AudienceVisible, item.RequiresExecution, item.Notes); err != nil {
				serverError(w, err)
				return
			}
		}
		for _, assignment := range sheet.Assignments {
			if _, err = tx.Exec(r.Context(), `INSERT INTO program_sheet_assignments (sheet_id,occurrence_id,role,assigned_by) VALUES ($1,$2,'official',$3) ON CONFLICT DO NOTHING`, sheetID, assignment.OccurrenceID, claims(r).Subject); err != nil {
				serverError(w, err)
				return
			}
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"migrated": true, "sheets": len(in.State.Sheets)})
}
func (app *application) updateProgramSheet(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        *string                  `json:"name"`
		ChangeNote  *string                  `json:"change_note"`
		Status      *string                  `json:"status"`
		Items       []programSheetItem       `json:"items"`
		Assignments []programSheetAssignment `json:"assignments"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	s, err := app.loadProgramSheet(r.Context(), r.PathValue("sheetId"))
	if err != nil {
		errorJSON(w, 404, "not_found", "节目单不存在")
		return
	}
	if s.Status == "published" || s.Status == "archived" {
		errorJSON(w, 409, "immutable_sheet", "正式或归档节目单不可直接修改")
		return
	}
	name, note, status := s.Name, s.ChangeNote, s.Status
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
	}
	if in.ChangeNote != nil {
		note = *in.ChangeNote
	}
	if in.Status != nil {
		status = *in.Status
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `UPDATE program_sheets SET name=$1,change_note=$2,status=$3,updated_at=NOW() WHERE id=$4`, name, note, status, s.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if in.Items != nil {
		if _, err = tx.Exec(r.Context(), `DELETE FROM program_sheet_items WHERE sheet_id=$1`, s.ID); err != nil {
			serverError(w, err)
			return
		}
		for index, item := range in.Items {
			if _, err = tx.Exec(r.Context(), `INSERT INTO program_sheet_items (id,workspace_id,production_id,sheet_id,kind,sort_order,production_program_id,segment_type_id,title_override,duration_seconds_override,counts_toward_duration,audience_visible,requires_execution,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, item.ID, s.WorkspaceID, s.ProductionID, s.ID, item.Kind, index, item.ProductionProgramID, item.SegmentTypeID, item.TitleOverride, item.DurationSecondsOverride, item.CountsTowardDuration, item.AudienceVisible, item.RequiresExecution, item.Notes); err != nil {
				serverError(w, err)
				return
			}
		}
	}
	if in.Assignments != nil {
		if _, err = tx.Exec(r.Context(), `DELETE FROM program_sheet_assignments WHERE sheet_id=$1`, s.ID); err != nil {
			serverError(w, err)
			return
		}
		for _, assignment := range in.Assignments {
			if _, err = tx.Exec(r.Context(), `INSERT INTO program_sheet_assignments (sheet_id,occurrence_id,role,assigned_by) VALUES ($1,$2,$3,$4)`, s.ID, assignment.OccurrenceID, "official", claims(r).Subject); err != nil {
				serverError(w, err)
				return
			}
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	s, _ = app.loadProgramSheet(r.Context(), s.ID)
	writeJSON(w, 200, s)
}

func (app *application) orderProgramSheetItems(w http.ResponseWriter, r *http.Request) {
	s, err := app.loadProgramSheet(r.Context(), r.PathValue("sheetId"))
	if err != nil {
		errorJSON(w, 404, "not_found", "节目单不存在")
		return
	}
	if s.Status == "published" || s.Status == "archived" {
		errorJSON(w, 409, "immutable_sheet", "节目单不可排序")
		return
	}
	var in struct {
		Items []struct {
			ID        string `json:"id"`
			SortOrder int    `json:"sort_order"`
		} `json:"items"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	seen := map[string]bool{}
	if len(in.Items) != len(s.Items) {
		errorJSON(w, 400, "invalid_order", "必须提交完整条目顺序")
		return
	}
	for _, item := range in.Items {
		if seen[item.ID] || item.SortOrder < 0 {
			errorJSON(w, 400, "invalid_order", "条目顺序无效")
			return
		}
		seen[item.ID] = true
	}
	tx, e := app.db.Begin(r.Context())
	if e != nil {
		serverError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	for _, item := range in.Items {
		_, e = tx.Exec(r.Context(), `UPDATE program_sheet_items SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND sort_order IS DISTINCT FROM $1`, item.SortOrder, item.ID)
		if e != nil {
			serverError(w, e)
			return
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		serverError(w, e)
		return
	}
	s, _ = app.loadProgramSheet(r.Context(), s.ID)
	writeJSON(w, 200, s)
}
func (app *application) copyProgramSheet(w http.ResponseWriter, r *http.Request) {
	src, e := app.loadProgramSheet(r.Context(), r.PathValue("sheetId"))
	if e != nil {
		errorJSON(w, 404, "not_found", "节目单不存在")
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		in.Name = src.Name + " 副本"
	}
	access := currentProductionAccess(r)
	var newRev int
	_ = app.db.QueryRow(r.Context(), `SELECT COALESCE(MAX(revision),0)+1 FROM program_sheets WHERE production_id=$1`, src.ProductionID).Scan(&newRev)
	tx, e := app.db.Begin(r.Context())
	if e != nil {
		serverError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := newID()
	if _, e = tx.Exec(r.Context(), `INSERT INTO program_sheets (id,workspace_id,production_id,name,revision,change_note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, access.WorkspaceID, src.ProductionID, in.Name, "复制自 "+src.Name, claims(r).Subject); e != nil {
		serverError(w, e)
		return
	}
	for _, item := range src.Items {
		if _, e = tx.Exec(r.Context(), `INSERT INTO program_sheet_items (id,workspace_id,production_id,sheet_id,kind,sort_order,production_program_id,segment_type_id,title_override,duration_seconds_override,counts_toward_duration,audience_visible,requires_execution,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, newID(), access.WorkspaceID, src.ProductionID, id, item.Kind, item.SortOrder, item.ProductionProgramID, item.SegmentTypeID, item.TitleOverride, item.DurationSecondsOverride, item.CountsTowardDuration, item.AudienceVisible, item.RequiresExecution, item.Notes); e != nil {
			serverError(w, e)
			return
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		serverError(w, e)
		return
	}
	s, _ := app.loadProgramSheet(r.Context(), id)
	writeJSON(w, 201, s)
}
func (app *application) archiveProgramSheet(w http.ResponseWriter, r *http.Request) {
	tag, e := app.db.Exec(r.Context(), `UPDATE program_sheets SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND status<>'archived'`, r.PathValue("sheetId"))
	if e != nil {
		serverError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		errorJSON(w, 404, "not_found", "节目单不存在")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (app *application) getProgramSheetOccurrences(w http.ResponseWriter, r *http.Request) {
	rows, e := app.db.Query(r.Context(), `SELECT occurrence_id,role,assigned_by,assigned_at FROM program_sheet_assignments WHERE sheet_id=$1 ORDER BY assigned_at`, r.PathValue("sheetId"))
	if e != nil {
		serverError(w, e)
		return
	}
	defer rows.Close()
	out := []programSheetAssignment{}
	for rows.Next() {
		var a programSheetAssignment
		if e = rows.Scan(&a.OccurrenceID, &a.Role, &a.AssignedBy, &a.AssignedAt); e != nil {
			serverError(w, e)
			return
		}
		out = append(out, a)
	}
	writeJSON(w, 200, map[string]any{"items": out})
}
func (app *application) putProgramSheetOccurrences(w http.ResponseWriter, r *http.Request) {
	s, e := app.loadProgramSheet(r.Context(), r.PathValue("sheetId"))
	if e != nil {
		errorJSON(w, 404, "not_found", "节目单不存在")
		return
	}
	if s.Status == "published" || s.Status == "archived" {
		errorJSON(w, 409, "immutable_sheet", "节目单不可修改场次关联")
		return
	}
	var in struct {
		OccurrenceIDs []string `json:"occurrence_ids"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	tx, e := app.db.Begin(r.Context())
	if e != nil {
		serverError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), `DELETE FROM program_sheet_assignments WHERE sheet_id=$1`, s.ID); e != nil {
		serverError(w, e)
		return
	}
	for _, id := range in.OccurrenceIDs {
		if _, e = tx.Exec(r.Context(), `INSERT INTO program_sheet_assignments (sheet_id,occurrence_id,assigned_by) VALUES ($1,$2,$3)`, s.ID, id, claims(r).Subject); e != nil {
			serverError(w, e)
			return
		}
	}
	if e = tx.Commit(r.Context()); e != nil {
		serverError(w, e)
		return
	}
	s, _ = app.loadProgramSheet(r.Context(), s.ID)
	writeJSON(w, 200, s)
}

func (app *application) publishProgramSheet(w http.ResponseWriter, r *http.Request) {
	s, e := app.loadProgramSheet(r.Context(), r.PathValue("sheetId"))
	if e != nil {
		errorJSON(w, 404, "not_found", "节目单不存在")
		return
	}
	if s.Status == "archived" {
		errorJSON(w, 409, "invalid_status", "归档节目单不能发布")
		return
	}
	if len(s.Items) == 0 {
		errorJSON(w, 400, "invalid_sheet", "节目单至少需要一个条目")
		return
	}
	snapshot, _ := json.Marshal(map[string]any{"id": s.ID, "name": s.Name, "revision": s.Revision, "items": s.Items, "assignments": s.Assignments, "published_at": time.Now().UTC()})
	tx, e := app.db.Begin(r.Context())
	if e != nil {
		serverError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	now := time.Now().UTC()
	if _, e = tx.Exec(r.Context(), `UPDATE program_sheets SET status='published',published_at=$1,published_by=$2,updated_at=$1 WHERE id=$3`, now, claims(r).Subject, s.ID); e != nil {
		serverError(w, e)
		return
	}
	rid := newID()
	if _, e = tx.Exec(r.Context(), `INSERT INTO program_sheet_releases (id,workspace_id,production_id,sheet_id,revision,snapshot,published_by,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, rid, s.WorkspaceID, s.ProductionID, s.ID, s.Revision, snapshot, claims(r).Subject, now); e != nil {
		serverError(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		serverError(w, e)
		return
	}
	writeJSON(w, 201, map[string]any{"release": map[string]any{"id": rid, "sheet_id": s.ID, "revision": s.Revision, "snapshot": json.RawMessage(snapshot), "published_at": now}})
}
func (app *application) listProgramReleases(w http.ResponseWriter, r *http.Request) {
	rows, e := app.db.Query(r.Context(), `SELECT id,workspace_id,production_id,sheet_id,revision,snapshot,published_by,published_at FROM program_sheet_releases WHERE sheet_id=$1 ORDER BY published_at DESC`, r.PathValue("sheetId"))
	if e != nil {
		serverError(w, e)
		return
	}
	defer rows.Close()
	out := []programRelease{}
	for rows.Next() {
		var p programRelease
		if e = rows.Scan(&p.ID, &p.WorkspaceID, &p.ProductionID, &p.SheetID, &p.Revision, &p.Snapshot, &p.PublishedBy, &p.PublishedAt); e != nil {
			serverError(w, e)
			return
		}
		out = append(out, p)
	}
	writeJSON(w, 200, map[string]any{"items": out})
}
func (app *application) getProgramRelease(w http.ResponseWriter, r *http.Request) {
	var p programRelease
	e := app.db.QueryRow(r.Context(), `SELECT id,workspace_id,production_id,sheet_id,revision,snapshot,published_by,published_at FROM program_sheet_releases WHERE id=$1`, r.PathValue("releaseId")).Scan(&p.ID, &p.WorkspaceID, &p.ProductionID, &p.SheetID, &p.Revision, &p.Snapshot, &p.PublishedBy, &p.PublishedAt)
	if e != nil {
		errorJSON(w, 404, "not_found", "发布版本不存在")
		return
	}
	if _, e = app.productionAccessFor(r.Context(), claims(r).Subject, p.ProductionID); e != nil {
		errorJSON(w, 404, "not_found", "发布版本不存在")
		return
	}
	writeJSON(w, 200, p)
}

const shareAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

func randomShareToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func randomShortCode() string {
	b := make([]byte, 10)
	_, _ = rand.Read(b)
	out := make([]byte, 10)
	for i, v := range b {
		out[i] = shareAlphabet[int(v)&31]
	}
	return string(out[:5]) + "-" + string(out[5:10])
}
func shareURL(r *http.Request, path string) string {
	origin := envOrDefault("PUBLIC_WEB_ORIGIN", "")
	if origin == "" {
		origin = "https://app.example.com"
	}
	return strings.TrimRight(origin, "/") + path
}
func (app *application) listShareLinks(w http.ResponseWriter, r *http.Request) {
	if _, err := app.releaseAccess(r, productionShare); err != nil {
		errorJSON(w, 404, "not_found", "发布版本不存在或无权管理分享")
		return
	}
	rows, e := app.db.Query(r.Context(), `SELECT id,release_id,access_scope,short_expires_at,expires_at,revoked_at,created_at FROM program_sheet_share_links WHERE release_id=$1 ORDER BY created_at DESC`, r.PathValue("releaseId"))
	if e != nil {
		serverError(w, e)
		return
	}
	defer rows.Close()
	out := []programShareLink{}
	for rows.Next() {
		var x programShareLink
		if e = rows.Scan(&x.ID, &x.ReleaseID, &x.AccessScope, &x.ShortExpiresAt, &x.ExpiresAt, &x.RevokedAt, &x.CreatedAt); e != nil {
			serverError(w, e)
			return
		}
		out = append(out, x)
	}
	writeJSON(w, 200, map[string]any{"items": out})
}
func (app *application) createShareLink(w http.ResponseWriter, r *http.Request) {
	if _, err := app.releaseAccess(r, productionShare); err != nil {
		errorJSON(w, 404, "not_found", "发布版本不存在或无权管理分享")
		return
	}
	var in struct {
		AccessScope string `json:"access_scope"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.AccessScope != "members" && in.AccessScope != "link" {
		errorJSON(w, 400, "invalid_input", "分享范围无效")
		return
	}
	var workspace, prod string
	var rev int
	var published time.Time
	e := app.db.QueryRow(r.Context(), `SELECT workspace_id,production_id,revision,published_at FROM program_sheet_releases WHERE id=$1`, r.PathValue("releaseId")).Scan(&workspace, &prod, &rev, &published)
	if e != nil {
		errorJSON(w, 404, "not_found", "发布版本不存在")
		return
	}
	long := randomShareToken(32)
	short := randomShortCode()
	now := time.Now().UTC()
	shortExp := now.Add(30 * 24 * time.Hour)
	id := newID()
	_, e = app.db.Exec(r.Context(), `INSERT INTO program_sheet_share_links (id,workspace_id,production_id,release_id,access_scope,long_token_hash,short_code_hash,short_expires_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, workspace, prod, r.PathValue("releaseId"), in.AccessScope, tokenHash(long), tokenHash(short), shortExp, claims(r).Subject)
	if e != nil {
		serverError(w, e)
		return
	}
	writeJSON(w, 201, programShareLink{ID: id, ReleaseID: r.PathValue("releaseId"), AccessScope: in.AccessScope, LongURL: shareURL(r, "/share/program-sheet/"+long), ShortURL: shareURL(r, "/s/ps/"+short), ShortExpiresAt: shortExp, CreatedAt: now})
}
func (app *application) revokeShareLink(w http.ResponseWriter, r *http.Request) {
	var releaseID string
	if err := app.db.QueryRow(r.Context(), `SELECT release_id FROM program_sheet_share_links WHERE id=$1`, r.PathValue("linkId")).Scan(&releaseID); err != nil {
		errorJSON(w, 404, "not_found", "分享链接不存在")
		return
	}
	if _, err := app.productionAccessFor(r.Context(), claims(r).Subject, func() string {
		var p string
		_ = app.db.QueryRow(r.Context(), `SELECT production_id FROM program_sheet_releases WHERE id=$1`, releaseID).Scan(&p)
		return p
	}()); err != nil {
		errorJSON(w, 404, "not_found", "无权管理分享")
		return
	}
	tag, e := app.db.Exec(r.Context(), `UPDATE program_sheet_share_links SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL`, r.PathValue("linkId"))
	if e != nil {
		serverError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		errorJSON(w, 404, "not_found", "分享链接不存在或已撤销")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
func (app *application) rotateShareLink(w http.ResponseWriter, r *http.Request) {
	var release, scope string
	e := app.db.QueryRow(r.Context(), `SELECT release_id,access_scope FROM program_sheet_share_links WHERE id=$1 AND revoked_at IS NULL`, r.PathValue("linkId")).Scan(&release, &scope)
	if e != nil {
		errorJSON(w, 404, "not_found", "分享链接不存在")
		return
	}
	var workspace, production string
	if e = app.db.QueryRow(r.Context(), `SELECT workspace_id,production_id FROM program_sheet_releases WHERE id=$1`, release).Scan(&workspace, &production); e != nil {
		errorJSON(w, 404, "not_found", "发布版本不存在")
		return
	}
	if access, err := app.productionAccessFor(r.Context(), claims(r).Subject, production); err != nil || !access.Permissions[productionShare] {
		errorJSON(w, 404, "not_found", "无权管理分享")
		return
	}
	long, short, now, shortExp := randomShareToken(32), randomShortCode(), time.Now().UTC(), time.Now().UTC().Add(30*24*time.Hour)
	newIDValue := newID()
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), `UPDATE program_sheet_share_links SET revoked_at=$1 WHERE id=$2`, now, r.PathValue("linkId")); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO program_sheet_share_links (id,workspace_id,production_id,release_id,access_scope,long_token_hash,short_code_hash,short_expires_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, newIDValue, workspace, production, release, scope, tokenHash(long), tokenHash(short), shortExp, claims(r).Subject); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, programShareLink{ID: newIDValue, ReleaseID: release, AccessScope: scope, LongURL: shareURL(r, "/share/program-sheet/"+long), ShortURL: shareURL(r, "/s/ps/"+short), ShortExpiresAt: shortExp, CreatedAt: now})
}

func (app *application) publicProgramSheetShare(w http.ResponseWriter, r *http.Request) {
	if !app.allowWindow(r, "program-sheet-share:"+requestClientIP(r), 60, time.Minute) {
		errorJSON(w, http.StatusTooManyRequests, "too_many_requests", "分享链接访问过于频繁")
		return
	}
	token := r.PathValue("token")
	if token == "" {
		token = r.PathValue("shortCode")
	}
	var release, scope string
	var shortExp, exp *time.Time
	var revoked *time.Time
	var id string
	hash := tokenHash(token)
	e := app.db.QueryRow(r.Context(), `SELECT id,release_id,access_scope,short_expires_at,expires_at,revoked_at FROM program_sheet_share_links WHERE long_token_hash=$1 OR short_code_hash=$1`, hash).Scan(&id, &release, &scope, &shortExp, &exp, &revoked)
	if e != nil || revoked != nil || (shortExp != nil && shortExp.Before(time.Now())) || (exp != nil && exp.Before(time.Now())) {
		errorJSON(w, 404, "share_unavailable", "分享链接不存在或已失效")
		return
	}
	if scope == "members" {
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if raw == "" {
			errorJSON(w, 401, "unauthorized", "此分享链接需要登录")
			return
		}
		var c authClaims
		if _, e := app.parseClaims(raw, &c); e != nil {
			errorJSON(w, 401, "unauthorized", "需要登录")
			return
		}
		var prod string
		if e = app.db.QueryRow(r.Context(), `SELECT production_id FROM program_sheet_releases WHERE id=$1`, release).Scan(&prod); e != nil {
			errorJSON(w, 404, "share_unavailable", "发布版本不存在")
			return
		}
		if _, e = app.productionAccessFor(r.Context(), c.Subject, prod); e != nil {
			errorJSON(w, 403, "forbidden", "当前账号没有活动访问权限")
			return
		}
	}
	var snapshot json.RawMessage
	e = app.db.QueryRow(r.Context(), `SELECT r.snapshot FROM program_sheet_releases r JOIN program_sheets s ON s.id=r.sheet_id WHERE r.id=$1 AND s.status='published'`, release).Scan(&snapshot)
	if e != nil {
		errorJSON(w, 404, "share_unavailable", "发布版本不存在")
		return
	}
	var doc map[string]any
	if json.Unmarshal(snapshot, &doc) != nil {
		serverError(w, fmt.Errorf("bad snapshot"))
		return
	}
	if items, ok := doc["items"].([]any); ok {
		safe := make([]any, 0, len(items))
		for _, raw := range items {
			if item, ok := raw.(map[string]any); ok && item["audience_visible"] != false {
				delete(item, "notes")
				delete(item, "requires_execution")
				safe = append(safe, item)
			}
		}
		doc["items"] = safe
	}
	_, _ = app.db.Exec(r.Context(), `UPDATE program_sheet_share_links SET last_accessed_at=NOW() WHERE id=$1`, id)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeJSON(w, 200, doc)
}

func (app *application) parseClaims(raw string, c *authClaims) (*jwt.Token, error) {
	return jwt.ParseWithClaims(raw, c, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("bad signing method")
		}
		return app.jwtSecret, nil
	})
}
