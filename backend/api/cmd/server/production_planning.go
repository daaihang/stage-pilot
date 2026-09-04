package main

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type productionPlanningRecord struct {
	ID                   string     `json:"id"`
	WorkspaceID          string     `json:"workspace_id"`
	ProductionID         string     `json:"production_id"`
	OccurrenceID         *string    `json:"occurrence_id,omitempty"`
	Name                 string     `json:"name"`
	Kind                 string     `json:"kind"`
	Timezone             string     `json:"timezone"`
	ScheduledStartAt     *time.Time `json:"scheduled_start_at"`
	ScheduledEndAt       *time.Time `json:"scheduled_end_at"`
	ActualStartAt        *time.Time `json:"actual_start_at"`
	ActualEndAt          *time.Time `json:"actual_end_at"`
	Status               string     `json:"status"`
	ProductionLocationID *string    `json:"production_location_id"`
	VenueName            *string    `json:"venue_name,omitempty"`
	SpaceName            *string    `json:"space_name,omitempty"`
	Notes                string     `json:"notes"`
	CreatedBy            string     `json:"created_by"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}
type planningPatch struct {
	Name                 *string      `json:"name"`
	Kind                 *string      `json:"kind"`
	Timezone             *string      `json:"timezone"`
	ScheduledStartAt     optionalTime `json:"scheduled_start_at"`
	ScheduledEndAt       optionalTime `json:"scheduled_end_at"`
	Status               *string      `json:"status"`
	ProductionLocationID *string      `json:"production_location_id"`
	Notes                *string      `json:"notes"`
	OccurrenceID         *string      `json:"occurrence_id"`
}

func planningTable(r *http.Request) (string, string, bool) {
	if strings.Contains(r.URL.Path, "/rehearsals") {
		return "rehearsal_sessions", "sessionId", true
	}
	return "production_occurrences", "occurrenceId", false
}
func validPlanningKind(kind string, rehearsal bool) bool {
	if rehearsal {
		return kind == "rehearsal" || kind == "technical" || kind == "dress" || kind == "cue_to_cue" || kind == "other"
	}
	return kind == "preview" || kind == "performance" || kind == "encore" || kind == "other"
}
func validPlanningStatus(status string) bool {
	return status == "planned" || status == "live" || status == "completed" || status == "canceled"
}
func planningSelect(table string) string {
	occurrence := "NULL::text"
	if table == "rehearsal_sessions" {
		occurrence = "r.occurrence_id"
	}
	return `SELECT r.id,r.workspace_id,r.production_id,` + occurrence + `,r.name,r.kind,r.timezone,r.scheduled_start_at,r.scheduled_end_at,r.actual_start_at,r.actual_end_at,r.status,r.production_location_id,v.name,s.name,r.notes,r.created_by,r.created_at,r.updated_at FROM ` + table + ` r LEFT JOIN production_locations l ON l.id=r.production_location_id AND l.workspace_id=r.workspace_id AND l.production_id=r.production_id LEFT JOIN venues v ON v.id=l.venue_id AND v.workspace_id=l.workspace_id LEFT JOIN venue_spaces s ON s.id=l.venue_space_id AND s.workspace_id=l.workspace_id WHERE r.workspace_id=$1 AND r.production_id=$2`
}
func scanPlanning(row interface{ Scan(...any) error }) (productionPlanningRecord, error) {
	var x productionPlanningRecord
	err := row.Scan(&x.ID, &x.WorkspaceID, &x.ProductionID, &x.OccurrenceID, &x.Name, &x.Kind, &x.Timezone, &x.ScheduledStartAt, &x.ScheduledEndAt, &x.ActualStartAt, &x.ActualEndAt, &x.Status, &x.ProductionLocationID, &x.VenueName, &x.SpaceName, &x.Notes, &x.CreatedBy, &x.CreatedAt, &x.UpdatedAt)
	return x, err
}
func (app *application) planningRequiresStart(ctx context.Context, workspaceID, productionID string) bool {
	var required bool
	err := app.db.QueryRow(ctx, `SELECT COALESCE(p.require_actual_start_before_completion,w.require_actual_start_before_completion,TRUE) FROM productions x JOIN workspaces w ON w.id=x.workspace_id LEFT JOIN production_settings p ON p.production_id=x.id WHERE x.id=$1 AND x.workspace_id=$2`, productionID, workspaceID).Scan(&required)
	return err != nil || required
}
func validatePlanningInput(w http.ResponseWriter, name, kind, timezone string, start, end *time.Time, rehearsal bool) bool {
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 120 {
		errorJSON(w, 400, "invalid_input", "名称不能为空且不能超过 120 字")
		return false
	}
	if !validPlanningKind(kind, rehearsal) {
		errorJSON(w, 400, "invalid_input", "类型无效")
		return false
	}
	if !validProductionTimezone(timezone) {
		errorJSON(w, 400, "invalid_input", "时区无效，需要 IANA 时区名称")
		return false
	}
	if start != nil && end != nil && end.Before(*start) {
		errorJSON(w, 400, "invalid_input", "结束时间不能早于开始时间")
		return false
	}
	return true
}
func (app *application) validPlanningLocation(w http.ResponseWriter, r *http.Request, a productionAccess, id *string) bool {
	if id == nil {
		return true
	}
	var ok bool
	if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM production_locations WHERE id=$1 AND workspace_id=$2 AND production_id=$3)`, *id, a.WorkspaceID, a.ProductionID).Scan(&ok); err != nil {
		serverError(w, err)
		return false
	}
	if !ok {
		errorJSON(w, 400, "invalid_location", "活动地点无效")
		return false
	}
	return true
}
func (app *application) validPlanningOccurrence(w http.ResponseWriter, r *http.Request, a productionAccess, id *string) bool {
	if id == nil {
		return true
	}
	var ok bool
	if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM production_occurrences WHERE id=$1 AND workspace_id=$2 AND production_id=$3)`, *id, a.WorkspaceID, a.ProductionID).Scan(&ok); err != nil {
		serverError(w, err)
		return false
	}
	if !ok {
		errorJSON(w, 400, "invalid_occurrence", "关联场次无效")
		return false
	}
	return true
}
func (app *application) listPlanning(w http.ResponseWriter, r *http.Request) {
	table, _, _ := planningTable(r)
	a := currentProductionAccess(r)
	rows, err := app.db.Query(r.Context(), planningSelect(table)+` ORDER BY COALESCE(r.scheduled_start_at,r.created_at),r.created_at,r.id`, a.WorkspaceID, a.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	result := []productionPlanningRecord{}
	for rows.Next() {
		x, e := scanPlanning(rows)
		if e != nil {
			serverError(w, e)
			return
		}
		result = append(result, x)
	}
	if err = rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (app *application) getPlanning(w http.ResponseWriter, r *http.Request) {
	table, key, _ := planningTable(r)
	a := currentProductionAccess(r)
	x, err := scanPlanning(app.db.QueryRow(r.Context(), planningSelect(table)+` AND r.id=$3`, a.WorkspaceID, a.ProductionID, r.PathValue(key)))
	if err == sql.ErrNoRows {
		errorJSON(w, 404, "not_found", "记录不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}
func (app *application) createPlanning(w http.ResponseWriter, r *http.Request) {
	table, _, rehearsal := planningTable(r)
	a := currentProductionAccess(r)
	var in struct {
		Name                 string     `json:"name"`
		Kind                 string     `json:"kind"`
		Timezone             string     `json:"timezone"`
		ScheduledStartAt     *time.Time `json:"scheduled_start_at"`
		ScheduledEndAt       *time.Time `json:"scheduled_end_at"`
		ProductionLocationID *string    `json:"production_location_id"`
		Notes                string     `json:"notes"`
		OccurrenceID         *string    `json:"occurrence_id"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	activityTimezone, err := app.productionTimezone(r.Context(), a.WorkspaceID, a.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	in.Timezone = activityTimezone
	if in.Kind == "" {
		if rehearsal {
			in.Kind = "rehearsal"
		} else {
			in.Kind = "performance"
		}
	}
	if !validatePlanningInput(w, in.Name, in.Kind, in.Timezone, in.ScheduledStartAt, in.ScheduledEndAt, rehearsal) {
		return
	}
	if !app.validPlanningLocation(w, r, a, in.ProductionLocationID) {
		return
	}
	if rehearsal && !app.validPlanningOccurrence(w, r, a, in.OccurrenceID) {
		return
	}
	id := newID()
	var q string
	var args []any
	if rehearsal {
		q = `INSERT INTO rehearsal_sessions(id,workspace_id,production_id,occurrence_id,name,kind,timezone,scheduled_start_at,scheduled_end_at,status,production_location_id,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'planned',$10,$11,$12)`
		args = []any{id, a.WorkspaceID, a.ProductionID, in.OccurrenceID, strings.TrimSpace(in.Name), in.Kind, in.Timezone, in.ScheduledStartAt, in.ScheduledEndAt, in.ProductionLocationID, strings.TrimSpace(in.Notes), claims(r).Subject}
	} else {
		q = `INSERT INTO production_occurrences(id,workspace_id,production_id,name,kind,timezone,scheduled_start_at,scheduled_end_at,status,production_location_id,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9,$10,$11)`
		args = []any{id, a.WorkspaceID, a.ProductionID, strings.TrimSpace(in.Name), in.Kind, in.Timezone, in.ScheduledStartAt, in.ScheduledEndAt, in.ProductionLocationID, strings.TrimSpace(in.Notes), claims(r).Subject}
	}
	if _, err := app.db.Exec(r.Context(), q, args...); err != nil {
		serverError(w, err)
		return
	}
	x, err := scanPlanning(app.db.QueryRow(r.Context(), planningSelect(table)+` AND r.id=$3`, a.WorkspaceID, a.ProductionID, id))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, x)
}
func (app *application) updatePlanning(w http.ResponseWriter, r *http.Request) {
	table, key, rehearsal := planningTable(r)
	a := currentProductionAccess(r)
	id := r.PathValue(key)
	var in planningPatch
	if !decodeJSON(w, r, &in) {
		return
	}
	current, err := scanPlanning(app.db.QueryRow(r.Context(), planningSelect(table)+` AND r.id=$3`, a.WorkspaceID, a.ProductionID, id))
	if err == sql.ErrNoRows {
		errorJSON(w, 404, "not_found", "记录不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	activityTimezone, err := app.productionTimezone(r.Context(), a.WorkspaceID, a.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	name, kind, tz := current.Name, current.Kind, current.Timezone
	if in.Name != nil {
		name = *in.Name
	}
	if in.Kind != nil {
		kind = *in.Kind
	}
	tz = activityTimezone
	start, end := current.ScheduledStartAt, current.ScheduledEndAt
	if in.ScheduledStartAt.Present {
		start = in.ScheduledStartAt.Value
	}
	if in.ScheduledEndAt.Present {
		end = in.ScheduledEndAt.Value
	}
	if !validatePlanningInput(w, name, kind, tz, start, end, rehearsal) {
		return
	}
	if in.ProductionLocationID != nil && !app.validPlanningLocation(w, r, a, in.ProductionLocationID) {
		return
	}
	if rehearsal && in.OccurrenceID != nil && !app.validPlanningOccurrence(w, r, a, in.OccurrenceID) {
		return
	}
	status := current.Status
	if in.Status != nil {
		status = *in.Status
	}
	if !validPlanningStatus(status) {
		errorJSON(w, 400, "invalid_input", "状态无效")
		return
	}
	if (current.Status == "completed" || current.Status == "canceled") && status != current.Status {
		errorJSON(w, http.StatusConflict, "invalid_transition", "已结束或已取消的记录不能恢复")
		return
	}
	if status == "live" && current.Status != "planned" && current.Status != "live" {
		errorJSON(w, http.StatusConflict, "invalid_transition", "当前状态不能开始")
		return
	}
	if status == "planned" && current.Status != "planned" {
		errorJSON(w, http.StatusConflict, "invalid_transition", "当前状态不能返回计划中")
		return
	}
	if status == "completed" && current.Status != "completed" && app.planningRequiresStart(r.Context(), a.WorkspaceID, a.ProductionID) && current.Status != "live" {
		errorJSON(w, 409, "invalid_transition", "必须先开始记录才能结束")
		return
	}
	actualStart, actualEnd := current.ActualStartAt, current.ActualEndAt
	if status == "live" && current.Status != "live" {
		now := time.Now().UTC()
		actualStart = &now
	}
	if status == "completed" && current.Status != "completed" {
		now := time.Now().UTC()
		actualEnd = &now
	}
	if status == "planned" {
		actualStart, actualEnd = nil, nil
	}
	notes, location := current.Notes, current.ProductionLocationID
	if in.Notes != nil {
		notes = *in.Notes
	}
	if in.ProductionLocationID != nil {
		location = in.ProductionLocationID
	}
	var q string
	var args []any
	if rehearsal {
		occ := current.OccurrenceID
		if in.OccurrenceID != nil {
			occ = in.OccurrenceID
		}
		q = `UPDATE rehearsal_sessions SET name=$1,kind=$2,timezone=$3,scheduled_start_at=$4,scheduled_end_at=$5,status=$6,production_location_id=$7,notes=$8,actual_start_at=$9,actual_end_at=$10,occurrence_id=$11,updated_at=NOW() WHERE id=$12 AND workspace_id=$13 AND production_id=$14`
		args = []any{name, kind, tz, start, end, status, location, notes, actualStart, actualEnd, occ, id, a.WorkspaceID, a.ProductionID}
	} else {
		q = `UPDATE production_occurrences SET name=$1,kind=$2,timezone=$3,scheduled_start_at=$4,scheduled_end_at=$5,status=$6,production_location_id=$7,notes=$8,actual_start_at=$9,actual_end_at=$10,updated_at=NOW() WHERE id=$11 AND workspace_id=$12 AND production_id=$13`
		args = []any{name, kind, tz, start, end, status, location, notes, actualStart, actualEnd, id, a.WorkspaceID, a.ProductionID}
	}
	if _, err = app.db.Exec(r.Context(), q, args...); err != nil {
		serverError(w, err)
		return
	}
	x, err := scanPlanning(app.db.QueryRow(r.Context(), planningSelect(table)+` AND r.id=$3`, a.WorkspaceID, a.ProductionID, id))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}
