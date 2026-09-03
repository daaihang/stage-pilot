package main

// Production Foundation。
//
// Production 是一次具体活动 / 演出 / 项目的内部生产工作空间，属于且只属于
// 一个 Workspace。权限完全继承 WorkspaceMembership（owner > admin > member），
// 不存在 ProductionMembership——未来如需「某场活动只开放给部分成员」再引入，
// 见架构文档 future extension。本文件不实现 Program / Submission / Rundown
// 等后续领域。

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type production struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"workspace_id"`
	Name        string     `json:"name"`
	Status      string     `json:"status"`
	Timezone    string     `json:"timezone"`
	StartAt     *time.Time `json:"start_at"`
	EndAt       *time.Time `json:"end_at"`
	Description string     `json:"description"`
	CreatedBy   string     `json:"created_by"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	ArchivedAt  *time.Time `json:"archived_at,omitempty"`
}

var productionTimezones = map[string]bool{}

// validProductionTimezone 校验 IANA 时区名（使用 time.LoadLocation，失败即拒绝）。
func validProductionTimezone(name string) bool {
	if name == "" {
		return false
	}
	if cached := productionTimezones[name]; cached {
		return true
	}
	if _, err := time.LoadLocation(name); err != nil {
		return false
	}
	productionTimezones[name] = true
	return true
}

const (
	productionStatusDraft     = "draft"
	productionStatusActive    = "active"
	productionStatusCompleted = "completed"
	productionStatusArchived  = "archived"
)

func validProductionStatus(status string) bool {
	return status == productionStatusDraft || status == productionStatusActive ||
		status == productionStatusCompleted || status == productionStatusArchived
}

// workspaceAccess 来自 requireWorkspaceRole（workspace.go）。
// currentProductionAccess 语义与其一致：请求已通过 workspace membership 校验，
// 且 production 已验证属于该 workspace。
type productionAccess struct {
	WorkspaceID   string
	ProductionID  string
	WorkspaceRole string
}

const productionKey contextKey = "stagepilot.auth.production_access"

func currentProductionAccess(r *http.Request) productionAccess {
	return r.Context().Value(productionKey).(productionAccess)
}

// requireProductionAccess 是统一的 Production 授权原语：
// authenticated user + workspace membership（roleFloor）+ production 父子关系
// 三者同时验证。productionId 来自 URL 路径；workspaceId 同样来自 URL，
// 查询同时匹配二者，伪造 workspaceId + productionId 组合无法通过
// （AC-P05 / AC-P06）。不存在与越权统一 404，与 workspace 层策略一致：
// 不向调用者泄露 production 是否存在于其他 workspace。
func (app *application) requireProductionAccess(roleFloor string, next http.Handler) http.Handler {
	return app.requireWorkspaceRole(roleFloor, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workspaceID := r.PathValue("id")
		productionID := r.PathValue("productionId")
		var exists bool
		err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM productions
			WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL)`,
			productionID, workspaceID).Scan(&exists)
		if err != nil || !exists {
			errorJSON(w, http.StatusNotFound, "production_not_found", "活动不存在")
			return
		}
		workspaceAccess := currentWorkspaceAccess(r)
		access := productionAccess{WorkspaceID: workspaceID, ProductionID: productionID, WorkspaceRole: workspaceAccess.Role}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), productionKey, access)))
	}))
}

// productionInput 校验并规范化创建/更新共用的字段。
// 返回值：name, description, timezone, startAt, endAt, status, ok。
func (app *application) productionInput(w http.ResponseWriter, name string, description string, timezone string, startAt, endAt *time.Time, status string) (string, string, string, *time.Time, *time.Time, string, bool) {
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 120 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "活动名称不能为空且不能超过 120 字")
		return "", "", "", nil, nil, "", false
	}
	if utf8.RuneCountInString(description) > 500 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "描述不能超过 500 字")
		return "", "", "", nil, nil, "", false
	}
	tz := timezone
	if tz == "" {
		tz = "Asia/Shanghai"
	}
	if !validProductionTimezone(tz) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "时区无效，需要 IANA 时区名称，例如 Asia/Shanghai")
		return "", "", "", nil, nil, "", false
	}
	if status != "" && !validProductionStatus(status) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "活动状态无效")
		return "", "", "", nil, nil, "", false
	}
	if startAt != nil && endAt != nil && endAt.Before(*startAt) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "结束时间不能早于开始时间")
		return "", "", "", nil, nil, "", false
	}
	return name, strings.TrimSpace(description), tz, startAt, endAt, status, true
}

func (app *application) createProduction(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string     `json:"name"`
		Description string     `json:"description"`
		Timezone    string     `json:"timezone"`
		StartAt     *time.Time `json:"start_at"`
		EndAt       *time.Time `json:"end_at"`
		Status      string     `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	// workspace_id 只来自已授权的 URL context，绝不信任 body（AC-P02 / Phase 5）。
	access := currentWorkspaceAccess(r)
	status := in.Status
	if status == "" {
		status = productionStatusDraft
	}
	name, description, timezone, startAt, endAt, status, ok := app.productionInput(w, in.Name, in.Description, in.Timezone, in.StartAt, in.EndAt, status)
	if !ok {
		return
	}
	productionID := newID()
	if _, err := app.db.Exec(r.Context(), `INSERT INTO productions (id,workspace_id,name,status,timezone,start_at,end_at,description,created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		productionID, access.WorkspaceID, name, status, timezone, startAt, endAt, description, access.UserID); err != nil {
		serverError(w, err)
		return
	}
	created, err := app.findProduction(r.Context(), access.WorkspaceID, productionID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

// listProductions 只返回 URL 中 workspace 的 productions；
// requireWorkspaceRole 已确保当前用户是其 active 成员（AC-P04）。
func (app *application) listProductions(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	statusFilter := r.URL.Query().Get("status")
	query := `SELECT id,workspace_id,name,status,timezone,start_at,end_at,description,created_by,created_at,updated_at,archived_at
		FROM productions WHERE workspace_id=$1 AND deleted_at IS NULL`
	args := []any{access.WorkspaceID}
	if statusFilter != "" {
		if !validProductionStatus(statusFilter) {
			errorJSON(w, http.StatusBadRequest, "invalid_input", "活动状态无效")
			return
		}
		query += ` AND status=$2`
		args = append(args, statusFilter)
	}
	query += ` ORDER BY COALESCE(start_at, created_at) DESC, created_at DESC`
	rows, err := app.db.Query(r.Context(), query, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	productions := []production{}
	for rows.Next() {
		var p production
		if err := rows.Scan(&p.ID, &p.WorkspaceID, &p.Name, &p.Status, &p.Timezone, &p.StartAt, &p.EndAt, &p.Description, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt, &p.ArchivedAt); err != nil {
			serverError(w, err)
			return
		}
		productions = append(productions, p)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, productions)
}

func (app *application) getProduction(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	found, err := app.findProduction(r.Context(), access.WorkspaceID, access.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, found)
}

// updateProduction 支持部分更新；status=archived 时同时写入 archived_at（AC-P10）。
func (app *application) updateProduction(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        *string    `json:"name"`
		Description *string    `json:"description"`
		Timezone    *string    `json:"timezone"`
		StartAt     *time.Time `json:"start_at"`
		EndAt       *time.Time `json:"end_at"`
		Status      *string    `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	access := currentProductionAccess(r)
	if in.Name != nil || in.Description != nil || in.Timezone != nil || in.StartAt != nil || in.EndAt != nil || in.Status != nil {
		name, description, timezone, startAt, endAt, status, ok := func() (string, string, string, *time.Time, *time.Time, string, bool) {
			current, err := app.findProduction(r.Context(), access.WorkspaceID, access.ProductionID)
			if err != nil {
				serverError(w, err)
				return "", "", "", nil, nil, "", false
			}
			mergedName := current.Name
			if in.Name != nil {
				mergedName = *in.Name
			}
			mergedDescription := current.Description
			if in.Description != nil {
				mergedDescription = *in.Description
			}
			mergedTimezone := current.Timezone
			if in.Timezone != nil {
				mergedTimezone = *in.Timezone
			}
			mergedStart := current.StartAt
			if in.StartAt != nil {
				mergedStart = in.StartAt
			}
			mergedEnd := current.EndAt
			if in.EndAt != nil {
				mergedEnd = in.EndAt
			}
			mergedStatus := current.Status
			if in.Status != nil {
				mergedStatus = *in.Status
			}
			return app.productionInput(w, mergedName, mergedDescription, mergedTimezone, mergedStart, mergedEnd, mergedStatus)
		}()
		if !ok {
			return
		}
		if _, err := app.db.Exec(r.Context(), `UPDATE productions SET name=$1,description=$2,timezone=$3,start_at=$4,end_at=$5,status=$6,
			archived_at=CASE WHEN $6='archived' THEN COALESCE(archived_at,NOW()) ELSE NULL END,updated_at=NOW()
			WHERE id=$7 AND workspace_id=$8 AND deleted_at IS NULL`,
			name, description, timezone, startAt, endAt, status, access.ProductionID, access.WorkspaceID); err != nil {
			serverError(w, err)
			return
		}
	}
	updated, err := app.findProduction(r.Context(), access.WorkspaceID, access.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (app *application) findProduction(ctx context.Context, workspaceID, productionID string) (production, error) {
	var p production
	err := app.db.QueryRow(ctx, `SELECT id,workspace_id,name,status,timezone,start_at,end_at,description,created_by,created_at,updated_at,archived_at
		FROM productions WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
		productionID, workspaceID).Scan(&p.ID, &p.WorkspaceID, &p.Name, &p.Status, &p.Timezone, &p.StartAt, &p.EndAt, &p.Description, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt, &p.ArchivedAt)
	return p, err
}
