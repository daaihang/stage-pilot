package main

import (
	"errors"
	"net/http"
	"time"
)

type timezonePreviewSample struct {
	Kind        string     `json:"kind"`
	ID          string     `json:"id"`
	Before      *time.Time `json:"before"`
	After       *time.Time `json:"after"`
	DateChanged bool       `json:"date_changed"`
}

func (app *application) previewProductionTimezone(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	var in struct {
		Timezone string `json:"timezone"`
		Strategy string `json:"strategy"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !validProductionTimezone(in.Timezone) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "时区无效，需要 IANA 时区名称")
		return
	}
	if in.Strategy == "" {
		in.Strategy = keepWallTimeStrategy
	}
	if in.Strategy != keepWallTimeStrategy && in.Strategy != keepInstantStrategy {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "时区变更策略无效")
		return
	}
	current, err := app.productionTimezone(r.Context(), a.WorkspaceID, a.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	currentLocation, err := time.LoadLocation(current)
	if err != nil {
		serverError(w, err)
		return
	}
	targetLocation, err := time.LoadLocation(in.Timezone)
	if err != nil {
		serverError(w, err)
		return
	}
	type row struct {
		kind, id   string
		start, end *time.Time
	}
	rows := []row{}
	counts := map[string]int{"occurrences": 0, "rehearsals": 0, "schedule_items": 0}
	for _, item := range []struct{ table, kind, countKey string }{{"production_occurrences", "occurrence", "occurrences"}, {"rehearsal_sessions", "rehearsal", "rehearsals"}, {"schedule_items", "schedule_item", "schedule_items"}} {
		var count int
		if err := app.db.QueryRow(r.Context(), "SELECT COUNT(*) FROM "+item.table+" WHERE workspace_id=$1 AND production_id=$2 AND (scheduled_start_at IS NOT NULL OR scheduled_end_at IS NOT NULL)", a.WorkspaceID, a.ProductionID).Scan(&count); err != nil {
			serverError(w, err)
			return
		}
		counts[item.countKey] = count
		result, err := app.db.Query(r.Context(), "SELECT id,scheduled_start_at,scheduled_end_at FROM "+item.table+" WHERE workspace_id=$1 AND production_id=$2 AND (scheduled_start_at IS NOT NULL OR scheduled_end_at IS NOT NULL) ORDER BY COALESCE(scheduled_start_at,scheduled_end_at),id LIMIT 2", a.WorkspaceID, a.ProductionID)
		if err != nil {
			serverError(w, err)
			return
		}
		for result.Next() {
			var currentRow row
			currentRow.kind, currentRow.start, currentRow.end = item.kind, nil, nil
			if err := result.Scan(&currentRow.id, &currentRow.start, &currentRow.end); err != nil {
				result.Close()
				serverError(w, err)
				return
			}
			rows = append(rows, currentRow)
		}
		if err := result.Err(); err != nil {
			result.Close()
			serverError(w, err)
			return
		}
		result.Close()
	}
	samples := make([]timezonePreviewSample, 0, len(rows)*2)
	for _, item := range rows {
		for _, value := range []*time.Time{item.start, item.end} {
			if value == nil {
				continue
			}
			after := value
			if in.Strategy == keepWallTimeStrategy {
				after, err = rebaseScheduledInstant(value, current, in.Timezone)
				if err != nil {
					var rebaseErr *timezoneRebaseError
					if errors.As(err, &rebaseErr) {
						errorJSON(w, http.StatusBadRequest, rebaseErr.Code, rebaseErr.Message)
					} else {
						serverError(w, err)
					}
					return
				}
			}
			beforeLocal := value.In(currentLocation)
			afterLocal := after.In(targetLocation)
			samples = append(samples, timezonePreviewSample{Kind: item.kind, ID: item.id, Before: value, After: after, DateChanged: beforeLocal.Year() != afterLocal.Year() || beforeLocal.YearDay() != afterLocal.YearDay()})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"current_timezone": current, "target_timezone": in.Timezone, "strategy": in.Strategy, "counts": counts, "samples": samples})
}
