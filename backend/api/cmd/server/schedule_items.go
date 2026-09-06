package main

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var scheduleItemTypes = map[string]bool{
	"load_in": true, "crew_call": true, "technical_check": true, "rehearsal": true,
	"doors": true, "performance": true, "break": true, "strike": true, "travel": true, "other": true,
}

type scheduleItemLocation struct {
	ID        string  `json:"production_location_id"`
	VenueName string  `json:"venue_name"`
	SpaceName *string `json:"space_name,omitempty"`
	Role      string  `json:"role"`
	SortOrder int     `json:"sort_order"`
	venueID   string
	spaceID   *string
}

type scheduleConflict struct {
	RecordID   string     `json:"record_id"`
	RecordType string     `json:"record_type"`
	Title      string     `json:"title"`
	StartAt    *time.Time `json:"scheduled_start_at"`
	EndAt      *time.Time `json:"scheduled_end_at"`
	LocationID string     `json:"production_location_id"`
	VenueName  string     `json:"venue_name"`
	SpaceName  *string    `json:"space_name,omitempty"`
	venueID    string
	spaceID    *string
}

type scheduleItemRecord struct {
	ID                 string                 `json:"id"`
	WorkspaceID        string                 `json:"workspace_id"`
	ProductionID       string                 `json:"production_id"`
	ContextType        string                 `json:"context_type"`
	OccurrenceID       *string                `json:"occurrence_id"`
	RehearsalSessionID *string                `json:"rehearsal_session_id"`
	Title              string                 `json:"title"`
	ItemType           string                 `json:"item_type"`
	Timezone           string                 `json:"timezone"`
	ScheduledStartAt   *time.Time             `json:"scheduled_start_at"`
	ScheduledEndAt     *time.Time             `json:"scheduled_end_at"`
	ActualStartAt      *time.Time             `json:"actual_start_at"`
	ActualEndAt        *time.Time             `json:"actual_end_at"`
	Status             string                 `json:"status"`
	Notes              string                 `json:"notes"`
	CreatedBy          string                 `json:"created_by"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
	Locations          []scheduleItemLocation `json:"locations"`
	Conflicts          []scheduleConflict     `json:"conflicts"`
}

type scheduleItemPatchInput struct {
	Title                 *string      `json:"title"`
	ItemType              *string      `json:"item_type"`
	ContextType           *string      `json:"context_type"`
	OccurrenceID          *string      `json:"occurrence_id"`
	RehearsalSessionID    *string      `json:"rehearsal_session_id"`
	ScheduledStartAt      optionalTime `json:"scheduled_start_at"`
	ScheduledEndAt        optionalTime `json:"scheduled_end_at"`
	Status                *string      `json:"status"`
	Notes                 *string      `json:"notes"`
	ProductionLocationIDs *[]string    `json:"production_location_ids"`
}

func scheduleItemSelect() string {
	return `SELECT s.id,s.workspace_id,s.production_id,s.context_type,s.occurrence_id,s.rehearsal_session_id,s.title,s.item_type,p.timezone,s.scheduled_start_at,s.scheduled_end_at,s.actual_start_at,s.actual_end_at,s.status,s.notes,s.created_by,s.created_at,s.updated_at FROM schedule_items s JOIN productions p ON p.id=s.production_id AND p.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND s.production_id=$2`
}

func scanScheduleItem(row interface{ Scan(...any) error }) (scheduleItemRecord, error) {
	var x scheduleItemRecord
	err := row.Scan(&x.ID, &x.WorkspaceID, &x.ProductionID, &x.ContextType, &x.OccurrenceID, &x.RehearsalSessionID, &x.Title, &x.ItemType, &x.Timezone, &x.ScheduledStartAt, &x.ScheduledEndAt, &x.ActualStartAt, &x.ActualEndAt, &x.Status, &x.Notes, &x.CreatedBy, &x.CreatedAt, &x.UpdatedAt)
	return x, err
}

func (app *application) hydrateScheduleItem(ctx context.Context, x *scheduleItemRecord) error {
	rows, err := app.db.Query(ctx, `SELECT l.production_location_id,v.name,s.name,l.role,l.sort_order,p.venue_id,p.venue_space_id FROM schedule_item_locations l JOIN production_locations p ON p.id=l.production_location_id AND p.workspace_id=l.workspace_id AND p.production_id=l.production_id JOIN venues v ON v.id=p.venue_id AND v.workspace_id=p.workspace_id LEFT JOIN venue_spaces s ON s.id=p.venue_space_id AND s.workspace_id=p.workspace_id WHERE l.schedule_item_id=$1 AND l.workspace_id=$2 AND l.production_id=$3 ORDER BY l.sort_order,l.production_location_id`, x.ID, x.WorkspaceID, x.ProductionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var l scheduleItemLocation
		if err := rows.Scan(&l.ID, &l.VenueName, &l.SpaceName, &l.Role, &l.SortOrder, &l.venueID, &l.spaceID); err != nil {
			return err
		}
		x.Locations = append(x.Locations, l)
	}
	return rows.Err()
}

func (app *application) loadScheduleLocations(ctx context.Context, workspaceID, productionID string, ids []string) ([]scheduleItemLocation, error) {
	if len(ids) == 0 {
		return []scheduleItemLocation{}, nil
	}
	rows, err := app.db.Query(ctx, `SELECT p.id,v.name,s.name,p.venue_id,p.venue_space_id FROM production_locations p JOIN venues v ON v.id=p.venue_id AND v.workspace_id=p.workspace_id LEFT JOIN venue_spaces s ON s.id=p.venue_space_id AND s.workspace_id=p.workspace_id WHERE p.workspace_id=$1 AND p.production_id=$2 AND p.id = ANY($3) ORDER BY p.sort_order,p.id`, workspaceID, productionID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []scheduleItemLocation{}
	for rows.Next() {
		var item scheduleItemLocation
		if err := rows.Scan(&item.ID, &item.VenueName, &item.SpaceName, &item.venueID, &item.spaceID); err != nil {
			return nil, err
		}
		item.Role = "primary"
		item.SortOrder = len(result)
		result = append(result, item)
	}
	return result, rows.Err()
}

func writeScheduleConflicts(w http.ResponseWriter, conflicts []scheduleConflict) {
	items := make([]map[string]any, 0, len(conflicts))
	for _, conflict := range conflicts {
		items = append(items, map[string]any{"record_id": conflict.RecordID, "record_type": conflict.RecordType, "title": conflict.Title, "scheduled_start_at": conflict.StartAt, "scheduled_end_at": conflict.EndAt, "production_location_id": conflict.LocationID, "venue_name": conflict.VenueName, "space_name": conflict.SpaceName})
	}
	errorJSONWithFields(w, http.StatusConflict, "schedule_conflict", "地点时间与其他排程重叠", map[string]any{"conflicts": items})
}

func validateScheduleItemInput(w http.ResponseWriter, title, itemType, contextType string, start, end *time.Time) bool {
	if utf8.RuneCountInString(strings.TrimSpace(title)) < 1 || utf8.RuneCountInString(title) > 160 {
		errorJSON(w, 400, "invalid_input", "标题不能为空且不能超过 160 字")
		return false
	}
	if !scheduleItemTypes[itemType] {
		errorJSON(w, 400, "invalid_input", "安排类型无效")
		return false
	}
	if contextType != "production" && contextType != "occurrence" && contextType != "rehearsal" {
		errorJSON(w, 400, "invalid_input", "安排上下文无效")
		return false
	}
	if start != nil && end != nil && end.Before(*start) {
		errorJSON(w, 400, "invalid_input", "结束时间不能早于开始时间")
		return false
	}
	return true
}

func (app *application) validateScheduleContext(w http.ResponseWriter, r *http.Request, a productionAccess, contextType string, occurrenceID, rehearsalID *string) bool {
	if (contextType == "production" && (occurrenceID != nil || rehearsalID != nil)) || (contextType == "occurrence" && (occurrenceID == nil || rehearsalID != nil)) || (contextType == "rehearsal" && (occurrenceID != nil || rehearsalID == nil)) {
		errorJSON(w, 400, "invalid_context", "安排上下文与关联记录不一致")
		return false
	}
	if occurrenceID != nil && !app.validPlanningOccurrence(w, r, a, occurrenceID) {
		return false
	}
	if rehearsalID != nil {
		var ok bool
		if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM rehearsal_sessions WHERE id=$1 AND workspace_id=$2 AND production_id=$3)`, *rehearsalID, a.WorkspaceID, a.ProductionID).Scan(&ok); err != nil {
			serverError(w, err)
			return false
		} else if !ok {
			errorJSON(w, 400, "invalid_rehearsal", "关联彩排无效")
			return false
		}
	}
	return true
}

func (app *application) validateScheduleLocations(w http.ResponseWriter, r *http.Request, a productionAccess, ids []string) bool {
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			errorJSON(w, 400, "invalid_location", "安排地点无效或重复")
			return false
		}
		seen[id] = true
		var ok bool
		if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM production_locations WHERE id=$1 AND workspace_id=$2 AND production_id=$3)`, id, a.WorkspaceID, a.ProductionID).Scan(&ok); err != nil {
			serverError(w, err)
			return false
		}
		if !ok {
			errorJSON(w, 400, "invalid_location", "安排地点必须属于当前活动")
			return false
		}
	}
	return true
}

func (app *application) scheduleConflictPolicy(ctx context.Context, workspaceID, productionID string) string {
	var policy string
	if err := app.db.QueryRow(ctx, `SELECT COALESCE(p.schedule_conflict_policy,w.schedule_conflict_policy,'block') FROM productions x JOIN workspace_settings w ON w.workspace_id=x.workspace_id LEFT JOIN production_settings p ON p.production_id=x.id WHERE x.id=$1 AND x.workspace_id=$2`, productionID, workspaceID).Scan(&policy); err != nil {
		return "block"
	}
	return policy
}

func (app *application) scheduleItemConflicts(ctx context.Context, x scheduleItemRecord) ([]scheduleConflict, error) {
	if x.ScheduledStartAt == nil || x.ScheduledEndAt == nil || len(x.Locations) == 0 {
		return []scheduleConflict{}, nil
	}
	rows, err := app.db.Query(ctx, `
SELECT o.id,'occurrence',o.name,o.scheduled_start_at,o.scheduled_end_at,l.id,v.name,s.name,l.venue_id,l.venue_space_id
FROM production_occurrences o JOIN production_locations l ON l.id=o.production_location_id AND l.workspace_id=o.workspace_id AND l.production_id=o.production_id JOIN venues v ON v.id=l.venue_id AND v.workspace_id=l.workspace_id LEFT JOIN venue_spaces s ON s.id=l.venue_space_id AND s.workspace_id=l.workspace_id
WHERE o.workspace_id=$1 AND o.production_id=$2 AND o.status <> 'canceled' AND o.scheduled_start_at IS NOT NULL AND o.scheduled_end_at IS NOT NULL AND o.scheduled_start_at < $4 AND o.scheduled_end_at > $3
UNION ALL
SELECT r.id,'rehearsal',r.name,r.scheduled_start_at,r.scheduled_end_at,l.id,v.name,s.name,l.venue_id,l.venue_space_id
FROM rehearsal_sessions r JOIN production_locations l ON l.id=r.production_location_id AND l.workspace_id=r.workspace_id AND l.production_id=r.production_id JOIN venues v ON v.id=l.venue_id AND v.workspace_id=l.workspace_id LEFT JOIN venue_spaces s ON s.id=l.venue_space_id AND s.workspace_id=l.workspace_id
WHERE r.workspace_id=$1 AND r.production_id=$2 AND r.status <> 'canceled' AND r.scheduled_start_at IS NOT NULL AND r.scheduled_end_at IS NOT NULL AND r.scheduled_start_at < $4 AND r.scheduled_end_at > $3
UNION ALL
SELECT i.id,'schedule_item',i.title,i.scheduled_start_at,i.scheduled_end_at,l.production_location_id,v.name,s.name,l.venue_id,l.venue_space_id
FROM schedule_items i JOIN schedule_item_locations il ON il.schedule_item_id=i.id AND il.workspace_id=i.workspace_id AND il.production_id=i.production_id JOIN production_locations l ON l.id=il.production_location_id AND l.workspace_id=il.workspace_id AND l.production_id=il.production_id JOIN venues v ON v.id=l.venue_id AND v.workspace_id=l.workspace_id LEFT JOIN venue_spaces s ON s.id=l.venue_space_id AND s.workspace_id=l.workspace_id
WHERE i.workspace_id=$1 AND i.production_id=$2 AND i.id<>$5 AND i.status <> 'canceled' AND i.scheduled_start_at IS NOT NULL AND i.scheduled_end_at IS NOT NULL AND i.scheduled_start_at < $4 AND i.scheduled_end_at > $3`, x.WorkspaceID, x.ProductionID, *x.ScheduledStartAt, *x.ScheduledEndAt, x.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []scheduleConflict
	for rows.Next() {
		var c scheduleConflict
		if err := rows.Scan(&c.RecordID, &c.RecordType, &c.Title, &c.StartAt, &c.EndAt, &c.LocationID, &c.VenueName, &c.SpaceName, &c.venueID, &c.spaceID); err != nil {
			return nil, err
		}
		if (c.RecordType == "occurrence" && x.ContextType == "occurrence" && x.OccurrenceID != nil && *x.OccurrenceID == c.RecordID) || (c.RecordType == "rehearsal" && x.ContextType == "rehearsal" && x.RehearsalSessionID != nil && *x.RehearsalSessionID == c.RecordID) {
			continue
		}
		for _, own := range x.Locations {
			resourceConflict := own.ID == c.LocationID || (own.venueID == c.venueID && (own.spaceID == nil || c.spaceID == nil))
			if resourceConflict {
				result = append(result, c)
				break
			}
		}
	}
	return result, rows.Err()
}

func (app *application) listScheduleItems(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	q := scheduleItemSelect()
	args := []any{a.WorkspaceID, a.ProductionID}
	n := 3
	filters := []string{""}
	if v := r.URL.Query().Get("context_type"); v != "" {
		q += ` AND context_type=$` + strconv.Itoa(n)
		args = append(args, v)
		n++
	}
	if v := r.URL.Query().Get("item_type"); v != "" {
		q += ` AND item_type=$` + strconv.Itoa(n)
		args = append(args, v)
		n++
	}
	if v := r.URL.Query().Get("status"); v != "" {
		q += ` AND status=$` + strconv.Itoa(n)
		args = append(args, v)
		n++
	}
	if v := r.URL.Query().Get("occurrence_id"); v != "" {
		q += ` AND occurrence_id=$` + strconv.Itoa(n)
		args = append(args, v)
		n++
	}
	if v := r.URL.Query().Get("rehearsal_session_id"); v != "" {
		q += ` AND rehearsal_session_id=$` + strconv.Itoa(n)
		args = append(args, v)
		n++
	}
	if v := r.URL.Query().Get("from"); v != "" {
		q += ` AND (scheduled_end_at IS NULL OR scheduled_end_at >= $` + strconv.Itoa(n) + `)`
		args = append(args, v)
		n++
	}
	if v := r.URL.Query().Get("to"); v != "" {
		q += ` AND (scheduled_start_at IS NULL OR scheduled_start_at <= $` + strconv.Itoa(n) + `)`
		args = append(args, v)
		n++
	}
	_ = filters
	q += ` ORDER BY COALESCE(scheduled_start_at,created_at),created_at,id`
	rows, err := app.db.Query(r.Context(), q, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	result := []scheduleItemRecord{}
	for rows.Next() {
		x, err := scanScheduleItem(rows)
		if err != nil {
			serverError(w, err)
			return
		}
		if err = app.hydrateScheduleItem(r.Context(), &x); err != nil {
			serverError(w, err)
			return
		}
		x.Conflicts, err = app.scheduleItemConflicts(r.Context(), x)
		if err != nil {
			serverError(w, err)
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

func (app *application) getScheduleItem(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	x, err := scanScheduleItem(app.db.QueryRow(r.Context(), scheduleItemSelect()+` AND id=$3`, a.WorkspaceID, a.ProductionID, r.PathValue("itemId")))
	if err == sql.ErrNoRows {
		errorJSON(w, 404, "not_found", "安排不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if err = app.hydrateScheduleItem(r.Context(), &x); err != nil {
		serverError(w, err)
		return
	}
	x.Conflicts, err = app.scheduleItemConflicts(r.Context(), x)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}

func (app *application) createScheduleItem(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	var in struct {
		Title                 string     `json:"title"`
		ItemType              string     `json:"item_type"`
		ContextType           string     `json:"context_type"`
		OccurrenceID          *string    `json:"occurrence_id"`
		RehearsalSessionID    *string    `json:"rehearsal_session_id"`
		Start                 *time.Time `json:"scheduled_start_at"`
		End                   *time.Time `json:"scheduled_end_at"`
		Notes                 string     `json:"notes"`
		ProductionLocationIDs []string   `json:"production_location_ids"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.ContextType == "" {
		in.ContextType = "production"
	}
	if in.ItemType == "" {
		in.ItemType = "other"
	}
	if !validateScheduleItemInput(w, in.Title, in.ItemType, in.ContextType, in.Start, in.End) || !app.validateScheduleContext(w, r, a, in.ContextType, in.OccurrenceID, in.RehearsalSessionID) || !app.validateScheduleLocations(w, r, a, in.ProductionLocationIDs) {
		return
	}
	id := newID()
	locations, err := app.loadScheduleLocations(r.Context(), a.WorkspaceID, a.ProductionID, in.ProductionLocationIDs)
	if err != nil {
		serverError(w, err)
		return
	}
	preview := scheduleItemRecord{ID: id, WorkspaceID: a.WorkspaceID, ProductionID: a.ProductionID, ContextType: in.ContextType, OccurrenceID: in.OccurrenceID, RehearsalSessionID: in.RehearsalSessionID, ScheduledStartAt: in.Start, ScheduledEndAt: in.End, Locations: locations}
	conflicts, err := app.scheduleItemConflicts(r.Context(), preview)
	if err != nil {
		serverError(w, err)
		return
	}
	if len(conflicts) > 0 && app.scheduleConflictPolicy(r.Context(), a.WorkspaceID, a.ProductionID) == "block" {
		writeScheduleConflicts(w, conflicts)
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `INSERT INTO schedule_items(id,workspace_id,production_id,context_type,occurrence_id,rehearsal_session_id,title,item_type,scheduled_start_at,scheduled_end_at,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'planned',$11,$12)`, id, a.WorkspaceID, a.ProductionID, in.ContextType, in.OccurrenceID, in.RehearsalSessionID, strings.TrimSpace(in.Title), in.ItemType, in.Start, in.End, strings.TrimSpace(in.Notes), claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	for i, l := range in.ProductionLocationIDs {
		if _, err = tx.Exec(r.Context(), `INSERT INTO schedule_item_locations(schedule_item_id,workspace_id,production_id,production_location_id,sort_order) VALUES($1,$2,$3,$4,$5)`, id, a.WorkspaceID, a.ProductionID, l, i); err != nil {
			serverError(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.writeScheduleItem(w, r, id, 201)
}

func (app *application) writeScheduleItem(w http.ResponseWriter, r *http.Request, id string, status int) {
	a := currentProductionAccess(r)
	x, err := scanScheduleItem(app.db.QueryRow(r.Context(), scheduleItemSelect()+` AND id=$3`, a.WorkspaceID, a.ProductionID, id))
	if err != nil {
		serverError(w, err)
		return
	}
	if err = app.hydrateScheduleItem(r.Context(), &x); err != nil {
		serverError(w, err)
		return
	}
	x.Conflicts, err = app.scheduleItemConflicts(r.Context(), x)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, status, x)
}

func (app *application) updateScheduleItem(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	id := r.PathValue("itemId")
	var in scheduleItemPatchInput
	if !decodeJSON(w, r, &in) {
		return
	}
	current, err := scanScheduleItem(app.db.QueryRow(r.Context(), scheduleItemSelect()+` AND id=$3`, a.WorkspaceID, a.ProductionID, id))
	if err == sql.ErrNoRows {
		errorJSON(w, 404, "not_found", "安排不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if err = app.hydrateScheduleItem(r.Context(), &current); err != nil {
		serverError(w, err)
		return
	}
	title, itemType, ctxType := current.Title, current.ItemType, current.ContextType
	if in.Title != nil {
		title = *in.Title
	}
	if in.ItemType != nil {
		itemType = *in.ItemType
	}
	if in.ContextType != nil {
		ctxType = *in.ContextType
	}
	start, end := current.ScheduledStartAt, current.ScheduledEndAt
	if in.ScheduledStartAt.Present {
		start = in.ScheduledStartAt.Value
	}
	if in.ScheduledEndAt.Present {
		end = in.ScheduledEndAt.Value
	}
	occ, rehearsal := current.OccurrenceID, current.RehearsalSessionID
	if in.OccurrenceID != nil {
		occ = in.OccurrenceID
	}
	if in.RehearsalSessionID != nil {
		rehearsal = in.RehearsalSessionID
	}
	if in.ContextType != nil {
		if ctxType == "production" {
			occ, rehearsal = nil, nil
		}
		if ctxType == "occurrence" {
			rehearsal = nil
		}
		if ctxType == "rehearsal" {
			occ = nil
		}
	}
	if !validateScheduleItemInput(w, title, itemType, ctxType, start, end) || !app.validateScheduleContext(w, r, a, ctxType, occ, rehearsal) {
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
		errorJSON(w, 409, "invalid_transition", "已结束或已取消的安排不能恢复")
		return
	}
	if status == "live" && current.Status != "planned" && current.Status != "live" {
		errorJSON(w, 409, "invalid_transition", "当前状态不能开始")
		return
	}
	if status == "planned" && current.Status != "planned" {
		errorJSON(w, 409, "invalid_transition", "当前状态不能返回计划中")
		return
	}
	if status == "completed" && current.Status != "live" && app.planningRequiresStart(r.Context(), a.WorkspaceID, a.ProductionID) {
		errorJSON(w, 409, "invalid_transition", "必须先开始安排才能结束")
		return
	}
	as, ae := current.ActualStartAt, current.ActualEndAt
	now := time.Now().UTC()
	if status == "live" && current.Status != "live" {
		as = &now
	}
	if status == "completed" && current.Status != "completed" {
		ae = &now
	}
	notes := current.Notes
	if in.Notes != nil {
		notes = *in.Notes
	}
	locations := current.Locations
	locationIDs := []string{}
	for _, l := range locations {
		locationIDs = append(locationIDs, l.ID)
	}
	if in.ProductionLocationIDs != nil {
		locationIDs = *in.ProductionLocationIDs
		if !app.validateScheduleLocations(w, r, a, locationIDs) {
			return
		}
	}
	newLocations, err := app.loadScheduleLocations(r.Context(), a.WorkspaceID, a.ProductionID, locationIDs)
	if err != nil {
		serverError(w, err)
		return
	}
	preview := current
	preview.ContextType, preview.OccurrenceID, preview.RehearsalSessionID = ctxType, occ, rehearsal
	preview.Title, preview.ItemType = title, itemType
	preview.ScheduledStartAt, preview.ScheduledEndAt, preview.Locations = start, end, newLocations
	conflicts, err := app.scheduleItemConflicts(r.Context(), preview)
	if err != nil {
		serverError(w, err)
		return
	}
	if len(conflicts) > 0 && app.scheduleConflictPolicy(r.Context(), a.WorkspaceID, a.ProductionID) == "block" {
		writeScheduleConflicts(w, conflicts)
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `UPDATE schedule_items SET context_type=$1,occurrence_id=$2,rehearsal_session_id=$3,title=$4,item_type=$5,scheduled_start_at=$6,scheduled_end_at=$7,status=$8,notes=$9,actual_start_at=$10,actual_end_at=$11,updated_at=NOW() WHERE id=$12 AND workspace_id=$13 AND production_id=$14`, ctxType, occ, rehearsal, strings.TrimSpace(title), itemType, start, end, status, notes, as, ae, id, a.WorkspaceID, a.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	if in.ProductionLocationIDs != nil {
		if _, err = tx.Exec(r.Context(), `DELETE FROM schedule_item_locations WHERE schedule_item_id=$1 AND workspace_id=$2`, id, a.WorkspaceID); err != nil {
			serverError(w, err)
			return
		}
		for i, l := range locationIDs {
			if _, err = tx.Exec(r.Context(), `INSERT INTO schedule_item_locations(schedule_item_id,workspace_id,production_id,production_location_id,sort_order) VALUES($1,$2,$3,$4,$5)`, id, a.WorkspaceID, a.ProductionID, l, i); err != nil {
				serverError(w, err)
				return
			}
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.writeScheduleItem(w, r, id, 200)
}

func (app *application) deleteScheduleItem(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	id := r.PathValue("itemId")
	var status string
	var as, ae *time.Time
	err := app.db.QueryRow(r.Context(), `SELECT status,actual_start_at,actual_end_at FROM schedule_items WHERE id=$1 AND workspace_id=$2 AND production_id=$3`, id, a.WorkspaceID, a.ProductionID).Scan(&status, &as, &ae)
	if err == sql.ErrNoRows {
		errorJSON(w, 404, "not_found", "安排不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if status != "planned" || as != nil || ae != nil {
		errorJSON(w, 409, "cannot_delete", "已执行或已取消的安排不能删除，请改为取消")
		return
	}
	if _, err = app.db.Exec(r.Context(), `DELETE FROM schedule_items WHERE id=$1 AND workspace_id=$2 AND production_id=$3`, id, a.WorkspaceID, a.ProductionID); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
