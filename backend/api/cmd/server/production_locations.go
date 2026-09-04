package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type productionLocation struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspace_id"`
	ProductionID string    `json:"production_id"`
	VenueID      string    `json:"venue_id"`
	VenueName    string    `json:"venue_name"`
	VenueSpaceID *string   `json:"venue_space_id"`
	SpaceName    *string   `json:"space_name"`
	Purpose      string    `json:"purpose"`
	IsPrimary    bool      `json:"is_primary"`
	SortOrder    int       `json:"sort_order"`
	Notes        string    `json:"notes"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func locationQuery() string {
	return `SELECT l.id,l.workspace_id,l.production_id,l.venue_id,v.name,l.venue_space_id,s.name,l.purpose,l.is_primary,l.sort_order,l.notes,l.created_at,l.updated_at FROM production_locations l JOIN venues v ON v.workspace_id=l.workspace_id AND v.id=l.venue_id LEFT JOIN venue_spaces s ON s.workspace_id=l.workspace_id AND s.id=l.venue_space_id WHERE l.workspace_id=$1 AND l.production_id=$2`
}

func (app *application) listProductionLocations(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	rows, err := app.db.Query(r.Context(), locationQuery()+` ORDER BY l.sort_order,l.id`, a.WorkspaceID, a.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []productionLocation{}
	for rows.Next() {
		var x productionLocation
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.ProductionID, &x.VenueID, &x.VenueName, &x.VenueSpaceID, &x.SpaceName, &x.Purpose, &x.IsPrimary, &x.SortOrder, &x.Notes, &x.CreatedAt, &x.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, x)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *application) createProductionLocation(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	var in struct {
		VenueID      string  `json:"venue_id"`
		VenueSpaceID *string `json:"venue_space_id"`
		Purpose      string  `json:"purpose"`
		IsPrimary    bool    `json:"is_primary"`
		SortOrder    int     `json:"sort_order"`
		Notes        string  `json:"notes"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.VenueID) == "" {
		errorJSON(w, 400, "invalid_input", "必须选择场地")
		return
	}
	if in.Purpose == "" {
		in.Purpose = "primary"
	}
	if !validOne(in.Purpose, "primary", "performance", "rehearsal", "office", "other") || in.SortOrder < 0 {
		errorJSON(w, 400, "invalid_input", "地点参数无效")
		return
	}
	if in.VenueSpaceID != nil && strings.TrimSpace(*in.VenueSpaceID) == "" {
		in.VenueSpaceID = nil
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var active bool
	if err = tx.QueryRow(r.Context(), `SELECT status='active' FROM venues WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL`, a.WorkspaceID, in.VenueID).Scan(&active); err == pgx.ErrNoRows || !active {
		errorJSON(w, 400, "invalid_input", "场地不存在或已归档")
		return
	} else if err != nil {
		serverError(w, err)
		return
	}
	if in.VenueSpaceID != nil {
		var ok bool
		if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM venue_spaces WHERE workspace_id=$1 AND venue_id=$2 AND id=$3 AND deleted_at IS NULL)`, a.WorkspaceID, in.VenueID, *in.VenueSpaceID).Scan(&ok); err != nil {
			serverError(w, err)
			return
		}
		if !ok {
			errorJSON(w, 400, "invalid_input", "场地空间不属于该场地")
			return
		}
	}
	if in.IsPrimary {
		if _, err = tx.Exec(r.Context(), `UPDATE production_locations SET is_primary=FALSE,updated_at=NOW() WHERE workspace_id=$1 AND production_id=$2`, a.WorkspaceID, a.ProductionID); err != nil {
			serverError(w, err)
			return
		}
	}
	var x productionLocation
	err = tx.QueryRow(r.Context(), `INSERT INTO production_locations(id,workspace_id,production_id,venue_id,venue_space_id,purpose,is_primary,sort_order,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,workspace_id,production_id,venue_id,venue_space_id,purpose,is_primary,sort_order,notes,created_at,updated_at`, newID(), a.WorkspaceID, a.ProductionID, in.VenueID, in.VenueSpaceID, in.Purpose, in.IsPrimary, in.SortOrder, strings.TrimSpace(in.Notes), claims(r).Subject).Scan(&x.ID, &x.WorkspaceID, &x.ProductionID, &x.VenueID, &x.VenueSpaceID, &x.Purpose, &x.IsPrimary, &x.SortOrder, &x.Notes, &x.CreatedAt, &x.UpdatedAt)
	if err != nil {
		errorJSON(w, 409, "location_exists", "该场地已添加到活动")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.writeProductionLocation(w, r, x.ID)
}

func (app *application) writeProductionLocation(w http.ResponseWriter, r *http.Request, id string) {
	a := currentProductionAccess(r)
	var x productionLocation
	err := app.db.QueryRow(r.Context(), locationQuery()+` AND l.id=$3`, a.WorkspaceID, a.ProductionID, id).Scan(&x.ID, &x.WorkspaceID, &x.ProductionID, &x.VenueID, &x.VenueName, &x.VenueSpaceID, &x.SpaceName, &x.Purpose, &x.IsPrimary, &x.SortOrder, &x.Notes, &x.CreatedAt, &x.UpdatedAt)
	if err == pgx.ErrNoRows {
		resourceNotFound(w, "活动地点")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, x)
}

func (app *application) updateProductionLocation(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	var in struct {
		VenueID      *string `json:"venue_id"`
		VenueSpaceID *string `json:"venue_space_id"`
		Purpose      *string `json:"purpose"`
		IsPrimary    *bool   `json:"is_primary"`
		SortOrder    *int    `json:"sort_order"`
		Notes        *string `json:"notes"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	id := r.PathValue("locationId")
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if in.IsPrimary != nil && *in.IsPrimary {
		if _, err = tx.Exec(r.Context(), `UPDATE production_locations SET is_primary=FALSE,updated_at=NOW() WHERE workspace_id=$1 AND production_id=$2`, a.WorkspaceID, a.ProductionID); err != nil {
			serverError(w, err)
			return
		}
	}
	if _, err = tx.Exec(r.Context(), `UPDATE production_locations SET venue_id=COALESCE($1,venue_id),venue_space_id=COALESCE($2,venue_space_id),purpose=COALESCE($3,purpose),is_primary=COALESCE($4,is_primary),sort_order=COALESCE($5,sort_order),notes=COALESCE($6,notes),updated_at=NOW() WHERE id=$7 AND workspace_id=$8 AND production_id=$9`, in.VenueID, in.VenueSpaceID, in.Purpose, in.IsPrimary, in.SortOrder, in.Notes, id, a.WorkspaceID, a.ProductionID); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.writeProductionLocation(w, r, id)
}

func (app *application) deleteProductionLocation(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
	id := r.PathValue("locationId")
	tag, err := app.db.Exec(r.Context(), `DELETE FROM production_locations WHERE id=$1 AND workspace_id=$2 AND production_id=$3`, id, a.WorkspaceID, a.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		resourceNotFound(w, "活动地点")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "removed"})
}

func (app *application) reorderProductionLocations(w http.ResponseWriter, r *http.Request) {
	a := currentProductionAccess(r)
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
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	for _, item := range in.Items {
		if item.ID == "" || item.SortOrder < 0 {
			errorJSON(w, 400, "invalid_input", "排序列表无效")
			return
		}
		if _, err = tx.Exec(r.Context(), `UPDATE production_locations SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3 AND production_id=$4`, item.SortOrder, item.ID, a.WorkspaceID, a.ProductionID); err != nil {
			serverError(w, err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	app.listProductionLocations(w, r)
}
