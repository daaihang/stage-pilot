package main

import "net/http"

type planningSettings struct {
	RequireActualStartBeforeCompletion *bool   `json:"require_actual_start_before_completion"`
	ScheduleConflictPolicy             *string `json:"schedule_conflict_policy"`
}

func (app *application) getWorkspacePlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentWorkspaceAccess(r)
	var required bool
	var policy string
	err := app.db.QueryRow(r.Context(), `SELECT COALESCE(require_actual_start_before_completion,TRUE),COALESCE(schedule_conflict_policy,'block') FROM workspace_settings WHERE workspace_id=$1`, a.WorkspaceID).Scan(&required, &policy)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: &required, ScheduleConflictPolicy: &policy})
}

func (app *application) updateWorkspacePlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentWorkspaceAccess(r)
	var in struct {
		Require *bool   `json:"require_actual_start_before_completion"`
		Policy  *string `json:"schedule_conflict_policy"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Require == nil && in.Policy == nil {
		errorJSON(w, 400, "invalid_input", "缺少配置值")
		return
	}
	if in.Policy != nil && *in.Policy != "block" && *in.Policy != "warn" {
		errorJSON(w, 400, "invalid_input", "冲突策略无效")
		return
	}
	var required bool
	var policy string
	err := app.db.QueryRow(r.Context(), `INSERT INTO workspace_settings(workspace_id,require_actual_start_before_completion,schedule_conflict_policy,updated_at) VALUES($1,COALESCE($2,TRUE),COALESCE($3,'block'),NOW()) ON CONFLICT(workspace_id) DO UPDATE SET require_actual_start_before_completion=COALESCE($2,workspace_settings.require_actual_start_before_completion),schedule_conflict_policy=COALESCE($3,workspace_settings.schedule_conflict_policy),updated_at=NOW() RETURNING require_actual_start_before_completion,schedule_conflict_policy`, a.WorkspaceID, in.Require, in.Policy).Scan(&required, &policy)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: &required, ScheduleConflictPolicy: &policy})
}

func (app *application) getProductionPlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	var required *bool
	var policy *string
	err := app.db.QueryRow(r.Context(), `SELECT s.require_actual_start_before_completion,s.schedule_conflict_policy FROM productions p LEFT JOIN production_settings s ON s.production_id=p.id WHERE p.id=$1 AND p.workspace_id=$2 AND p.deleted_at IS NULL`, a.ProductionID, a.WorkspaceID).Scan(&required, &policy)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: required, ScheduleConflictPolicy: policy})
}

func (app *application) updateProductionPlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	var in struct {
		Require *bool   `json:"require_actual_start_before_completion"`
		Policy  *string `json:"schedule_conflict_policy"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Policy != nil && *in.Policy != "block" && *in.Policy != "warn" {
		errorJSON(w, 400, "invalid_input", "冲突策略无效")
		return
	}
	var required *bool
	var policy *string
	if in.Require == nil && in.Policy == nil {
		if _, err := app.db.Exec(r.Context(), `DELETE FROM production_settings WHERE production_id=$1`, a.ProductionID); err != nil {
			serverError(w, err)
			return
		}
	} else if err := app.db.QueryRow(r.Context(), `INSERT INTO production_settings(production_id,require_actual_start_before_completion,schedule_conflict_policy,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(production_id) DO UPDATE SET require_actual_start_before_completion=COALESCE($2,production_settings.require_actual_start_before_completion),schedule_conflict_policy=COALESCE($3,production_settings.schedule_conflict_policy),updated_at=NOW() RETURNING require_actual_start_before_completion,schedule_conflict_policy`, a.ProductionID, in.Require, in.Policy).Scan(&required, &policy); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: required, ScheduleConflictPolicy: policy})
}
