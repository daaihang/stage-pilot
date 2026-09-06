package main

import (
	"net/http"
	"strings"
)

type planningSettings struct {
	RequireActualStartBeforeCompletion *bool   `json:"require_actual_start_before_completion"`
	ScheduleConflictPolicy             *string `json:"schedule_conflict_policy"`
	DefaultTimezone                    *string `json:"default_timezone"`
}

func (app *application) getWorkspacePlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentWorkspaceAccess(r)
	var required bool
	var policy, defaultTimezone string
	err := app.db.QueryRow(r.Context(), `SELECT COALESCE(require_actual_start_before_completion,TRUE),COALESCE(schedule_conflict_policy,'block'),COALESCE(default_timezone,'Asia/Shanghai') FROM workspace_settings WHERE workspace_id=$1`, a.WorkspaceID).Scan(&required, &policy, &defaultTimezone)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: &required, ScheduleConflictPolicy: &policy, DefaultTimezone: &defaultTimezone})
}

func (app *application) updateWorkspacePlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentWorkspaceAccess(r)
	var in struct {
		Require         *bool   `json:"require_actual_start_before_completion"`
		Policy          *string `json:"schedule_conflict_policy"`
		DefaultTimezone *string `json:"default_timezone"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Require == nil && in.Policy == nil && in.DefaultTimezone == nil {
		errorJSON(w, 400, "invalid_input", "缺少配置值")
		return
	}
	if in.Policy != nil && *in.Policy != "block" && *in.Policy != "warn" {
		errorJSON(w, 400, "invalid_input", "冲突策略无效")
		return
	}
	if in.DefaultTimezone != nil {
		value := strings.TrimSpace(*in.DefaultTimezone)
		if value == "" || !validProductionTimezone(value) {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "默认活动时区无效，需要合法的 IANA 时区名称")
			return
		}
		in.DefaultTimezone = &value
	}
	var required bool
	var policy, defaultTimezone string
	err := app.db.QueryRow(r.Context(), `INSERT INTO workspace_settings(workspace_id,require_actual_start_before_completion,schedule_conflict_policy,default_timezone,updated_at) VALUES($1,COALESCE($2,TRUE),COALESCE($3,'block'),COALESCE($4,'Asia/Shanghai'),NOW()) ON CONFLICT(workspace_id) DO UPDATE SET require_actual_start_before_completion=COALESCE($2,workspace_settings.require_actual_start_before_completion),schedule_conflict_policy=COALESCE($3,workspace_settings.schedule_conflict_policy),default_timezone=COALESCE($4,workspace_settings.default_timezone),updated_at=NOW() RETURNING require_actual_start_before_completion,schedule_conflict_policy,default_timezone`, a.WorkspaceID, in.Require, in.Policy, in.DefaultTimezone).Scan(&required, &policy, &defaultTimezone)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: &required, ScheduleConflictPolicy: &policy, DefaultTimezone: &defaultTimezone})
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
