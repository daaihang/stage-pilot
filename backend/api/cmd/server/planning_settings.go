package main

import "net/http"

type planningSettings struct {
	RequireActualStartBeforeCompletion *bool `json:"require_actual_start_before_completion"`
}

func (app *application) getWorkspacePlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentWorkspaceAccess(r)
	var value bool
	err := app.db.QueryRow(r.Context(), `SELECT COALESCE(require_actual_start_before_completion,TRUE) FROM workspace_settings WHERE workspace_id=$1`, a.WorkspaceID).Scan(&value)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: &value})
}

func (app *application) updateWorkspacePlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentWorkspaceAccess(r)
	var in struct {
		Require *bool `json:"require_actual_start_before_completion"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Require == nil {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "缺少配置值")
		return
	}
	var value bool
	err := app.db.QueryRow(r.Context(), `INSERT INTO workspace_settings(workspace_id,require_actual_start_before_completion,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(workspace_id) DO UPDATE SET require_actual_start_before_completion=EXCLUDED.require_actual_start_before_completion,updated_at=NOW() RETURNING require_actual_start_before_completion`, a.WorkspaceID, *in.Require).Scan(&value)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: &value})
}

func (app *application) getProductionPlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	var value *bool
	err := app.db.QueryRow(r.Context(), `SELECT s.require_actual_start_before_completion FROM productions p LEFT JOIN production_settings s ON s.production_id=p.id WHERE p.id=$1 AND p.workspace_id=$2 AND p.deleted_at IS NULL`, a.ProductionID, a.WorkspaceID).Scan(&value)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: value})
}

func (app *application) updateProductionPlanningSettings(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	var in struct {
		Require *bool `json:"require_actual_start_before_completion"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	var value *bool
	if in.Require == nil {
		if _, err := app.db.Exec(r.Context(), `DELETE FROM production_settings WHERE production_id=$1`, a.ProductionID); err != nil {
			serverError(w, err)
			return
		}
	} else if err := app.db.QueryRow(r.Context(), `INSERT INTO production_settings(production_id,require_actual_start_before_completion,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(production_id) DO UPDATE SET require_actual_start_before_completion=EXCLUDED.require_actual_start_before_completion,updated_at=NOW() RETURNING require_actual_start_before_completion`, a.ProductionID, *in.Require).Scan(&value); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, planningSettings{RequireActualStartBeforeCompletion: value})
}
