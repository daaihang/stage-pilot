package main

// Production Foundation。
//
// Production 是一次具体活动 / 演出 / 项目的内部生产工作空间，属于且只属于
// 一个 Workspace。权限来自 WorkspaceMembership 与可选的活动直接成员关系，
// 活动直接成员支持角色和时间窗口。本文件不实现 Program / Submission / Rundown
// 等后续领域。

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type production struct {
	ID                string     `json:"id"`
	WorkspaceID       string     `json:"workspace_id"`
	Name              string     `json:"name"`
	Status            string     `json:"status"`
	Timezone          string     `json:"timezone"`
	PlannedStartAt    *time.Time `json:"planned_start_at"`
	PlannedEndAt      *time.Time `json:"planned_end_at"`
	ActualCompletedAt *time.Time `json:"actual_completed_at"`
	Description       string     `json:"description"`
	CreatedBy         string     `json:"created_by"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	ArchivedAt        *time.Time `json:"archived_at,omitempty"`
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
	productionStatusActive    = "active"
	productionStatusCompleted = "completed"
	productionStatusArchived  = "archived"
)

func validProductionStatus(status string) bool {
	return status == productionStatusActive || status == productionStatusCompleted || status == productionStatusArchived
}

// workspaceAccess 来自 requireWorkspaceRole（workspace.go）。
// currentProductionAccess 语义与其一致：请求已通过 workspace membership 校验，
// 且 production 已验证属于该 workspace。
type productionAccess struct {
	WorkspaceID        string
	ProductionID       string
	WorkspaceRole      string
	WorkspaceName      string
	WorkspaceNavigable bool
	DirectRole         string
	Permissions        map[string]bool
}

const productionKey contextKey = "stagepilot.auth.production_access"

func currentProductionAccess(r *http.Request) productionAccess {
	return r.Context().Value(productionKey).(productionAccess)
}

const (
	productionView          = "production.view"
	productionEdit          = "production.edit"
	productionArchive       = "production.archive"
	productionMembersView   = "production.members.view"
	productionMembersManage = "production.members.manage"
)

var productionRolePermissions = map[string][]string{
	"producer":      {productionView, productionEdit, productionArchive, productionMembersView, productionMembersManage},
	"editor":        {productionView, productionEdit, productionMembersView},
	"stage_manager": {productionView, productionMembersView},
	"contributor":   {productionView},
	"viewer":        {productionView},
}

func validProductionRole(role string) bool { _, ok := productionRolePermissions[role]; return ok }

func canGrantProductionRole(access productionAccess, role string) bool {
	if role == "producer" {
		return access.WorkspaceRole == workspaceRoleOwner || access.WorkspaceRole == workspaceRoleAdmin
	}
	return access.Permissions[productionMembersManage]
}

func effectiveProductionMembershipStatus(status string, startsAt, expiresAt *time.Time, now time.Time) string {
	switch status {
	case "revoked":
		return "revoked"
	case "suspended":
		return "suspended"
	}
	if startsAt != nil && startsAt.After(now) {
		return "scheduled"
	}
	if expiresAt != nil && !expiresAt.After(now) {
		return "expired"
	}
	return "active"
}

func validProductionTimeWindow(w http.ResponseWriter, startsAt, expiresAt *time.Time, label string) bool {
	if startsAt != nil && expiresAt != nil && !startsAt.Before(*expiresAt) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", label+"开始时间必须早于结束时间")
		return false
	}
	return true
}

func productionPermissionList(access productionAccess) []string {
	result := make([]string, 0, len(access.Permissions))
	for key := range access.Permissions {
		result = append(result, key)
	}
	return result
}

// productionAccessFor resolves all access sources. It deliberately does not use a
// role rank: Workspace governance and Production execution roles are separate scopes.
func (app *application) productionAccessFor(ctx context.Context, userID, productionID string) (productionAccess, error) {
	var access productionAccess
	err := app.db.QueryRow(ctx, `SELECT p.workspace_id,w.name FROM productions p JOIN workspaces w ON w.id=p.workspace_id
		WHERE p.id=$1 AND p.deleted_at IS NULL AND w.deleted_at IS NULL`, productionID).Scan(&access.WorkspaceID, &access.WorkspaceName)
	if err != nil {
		return access, err
	}
	access.ProductionID, access.Permissions = productionID, map[string]bool{}
	var workspaceRole string
	err = app.db.QueryRow(ctx, `SELECT role FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2 AND status='active'`, access.WorkspaceID, userID).Scan(&workspaceRole)
	if err == nil {
		access.WorkspaceRole, access.WorkspaceNavigable = workspaceRole, true
		access.Permissions[productionView] = true
		if workspaceRole == workspaceRoleOwner || workspaceRole == workspaceRoleAdmin {
			for _, permission := range productionRolePermissions["producer"] {
				access.Permissions[permission] = true
			}
		}
	} else if err != pgx.ErrNoRows {
		return access, err
	}
	var directRole string
	err = app.db.QueryRow(ctx, `SELECT role_key FROM production_memberships WHERE production_id=$1 AND user_id=$2
		AND status='active' AND (starts_at IS NULL OR starts_at<=NOW()) AND (expires_at IS NULL OR expires_at>NOW())
		ORDER BY created_at DESC LIMIT 1`, productionID, userID).Scan(&directRole)
	if err == nil {
		access.DirectRole = directRole
		for _, permission := range productionRolePermissions[directRole] {
			access.Permissions[permission] = true
		}
	} else if err != pgx.ErrNoRows {
		return access, err
	}
	if !access.Permissions[productionView] {
		return access, pgx.ErrNoRows
	}
	return access, nil
}

func (app *application) requireProductionPermission(permission string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		productionID := r.PathValue("productionId")
		access, err := app.productionAccessFor(r.Context(), claims(r).Subject, productionID)
		if err != nil || !access.Permissions[permission] {
			errorJSON(w, http.StatusNotFound, "production_not_found", "活动不存在或无权访问")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), productionKey, access)))
	})
}

// requireProductionAccess 是统一的 Production 授权原语：
// authenticated user + workspace membership（roleFloor）+ production 父子关系
// 三者同时验证。productionId 来自 URL 路径；workspaceId 同样来自 URL，
// 查询同时匹配二者，伪造 workspaceId + productionId 组合无法通过
// （AC-P05 / AC-P06）。不存在与越权统一 404，与 workspace 层策略一致：
// 不向调用者泄露 production 是否存在于其他 workspace。
func (app *application) requireProductionAccess(roleFloor string, next http.Handler) http.Handler {
	permission := productionView
	if roleFloor == workspaceRoleAdmin {
		permission = productionEdit
	}
	return app.requireProductionPermission(permission, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		access := currentProductionAccess(r)
		if access.WorkspaceID != r.PathValue("id") {
			errorJSON(w, http.StatusNotFound, "production_not_found", "活动不存在或无权访问")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

// productionInput 校验并规范化创建/更新共用的字段。
// 返回值：name, description, timezone, plannedStartAt, plannedEndAt, status, ok。
func (app *application) productionInput(w http.ResponseWriter, name string, description string, timezone string, plannedStartAt, plannedEndAt *time.Time, status string) (string, string, string, *time.Time, *time.Time, string, bool) {
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
	if plannedStartAt != nil && plannedEndAt != nil && plannedEndAt.Before(*plannedStartAt) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "预计完成时间不能早于项目开始时间")
		return "", "", "", nil, nil, "", false
	}
	return name, strings.TrimSpace(description), tz, plannedStartAt, plannedEndAt, status, true
}

func (app *application) createProduction(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name           string     `json:"name"`
		Description    string     `json:"description"`
		Timezone       string     `json:"timezone"`
		PlannedStartAt *time.Time `json:"planned_start_at"`
		PlannedEndAt   *time.Time `json:"planned_end_at"`
		Status         string     `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	// workspace_id 只来自已授权的 URL context，绝不信任 body（AC-P02 / Phase 5）。
	access := currentWorkspaceAccess(r)
	status := in.Status
	if status == "" {
		status = productionStatusActive
	}
	name, description, timezone, plannedStartAt, plannedEndAt, status, ok := app.productionInput(w, in.Name, in.Description, in.Timezone, in.PlannedStartAt, in.PlannedEndAt, status)
	if !ok {
		return
	}
	productionID := newID()
	var actualCompletedAt *time.Time
	if status == productionStatusCompleted {
		now := time.Now().UTC()
		actualCompletedAt = &now
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `INSERT INTO productions (id,workspace_id,name,status,timezone,planned_start_at,planned_end_at,actual_completed_at,description,created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		productionID, access.WorkspaceID, name, status, timezone, plannedStartAt, plannedEndAt, actualCompletedAt, description, access.UserID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO production_memberships (id,production_id,user_id,role_key,status,invited_by)
		VALUES ($1,$2,$3,'producer','active',$3)`, newID(), productionID, access.UserID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO production_occurrences (id,workspace_id,production_id,name,kind,status,timezone,created_by)
		VALUES ($1,$2,$3,'默认场次','performance','planned',$4,$5)`, newID(), access.WorkspaceID, productionID, timezone, access.UserID); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
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
	query := `SELECT id,workspace_id,name,status,timezone,planned_start_at,planned_end_at,actual_completed_at,description,created_by,created_at,updated_at,archived_at
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
	query += ` ORDER BY COALESCE(planned_start_at, created_at) DESC, created_at DESC`
	rows, err := app.db.Query(r.Context(), query, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	productions := []production{}
	for rows.Next() {
		var p production
		if err := rows.Scan(&p.ID, &p.WorkspaceID, &p.Name, &p.Status, &p.Timezone, &p.PlannedStartAt, &p.PlannedEndAt, &p.ActualCompletedAt, &p.Description, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt, &p.ArchivedAt); err != nil {
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
		Name                   *string      `json:"name"`
		Description            *string      `json:"description"`
		Timezone               *string      `json:"timezone"`
		TimezoneChangeStrategy *string      `json:"timezone_change_strategy"`
		PlannedStartAt         optionalTime `json:"planned_start_at"`
		PlannedEndAt           optionalTime `json:"planned_end_at"`
		Status                 *string      `json:"status"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	access := currentProductionAccess(r)
	if in.Status != nil && *in.Status == productionStatusArchived && !access.Permissions[productionArchive] {
		errorJSON(w, http.StatusForbidden, "production_forbidden", "只有 Producer 或工作空间管理者可以归档活动")
		return
	}
	if in.TimezoneChangeStrategy != nil && *in.TimezoneChangeStrategy != keepWallTimeStrategy && *in.TimezoneChangeStrategy != keepInstantStrategy {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "时区变更策略无效")
		return
	}
	if in.Name != nil || in.Description != nil || in.Timezone != nil || in.PlannedStartAt.Present || in.PlannedEndAt.Present || in.Status != nil {
		current, err := app.findProduction(r.Context(), access.WorkspaceID, access.ProductionID)
		if err != nil {
			serverError(w, err)
			return
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
		mergedStart := current.PlannedStartAt
		if in.PlannedStartAt.Present {
			mergedStart = in.PlannedStartAt.Value
		}
		mergedEnd := current.PlannedEndAt
		if in.PlannedEndAt.Present {
			mergedEnd = in.PlannedEndAt.Value
		}
		mergedStatus := current.Status
		if in.Status != nil {
			mergedStatus = *in.Status
		}
		name, description, timezone, plannedStartAt, plannedEndAt, status, ok := app.productionInput(w, mergedName, mergedDescription, mergedTimezone, mergedStart, mergedEnd, mergedStatus)
		if !ok {
			return
		}
		actualCompletedAt := current.ActualCompletedAt
		if status == productionStatusCompleted && current.Status != productionStatusCompleted {
			now := time.Now().UTC()
			actualCompletedAt = &now
		} else if status == productionStatusActive {
			actualCompletedAt = nil
		}
		strategy := keepInstantStrategy
		if in.TimezoneChangeStrategy != nil {
			strategy = *in.TimezoneChangeStrategy
		}
		if timezone != current.Timezone {
			if err := app.updateProductionTimezone(r.Context(), access.WorkspaceID, access.ProductionID, name, description, timezone, plannedStartAt, plannedEndAt, status, actualCompletedAt, strategy); err != nil {
				var rebaseErr *timezoneRebaseError
				if errors.As(err, &rebaseErr) {
					errorJSON(w, http.StatusBadRequest, rebaseErr.Code, rebaseErr.Message)
				} else {
					serverError(w, err)
				}
				return
			}
		} else if _, err := app.db.Exec(r.Context(), `UPDATE productions SET name=$1,description=$2,timezone=$3,planned_start_at=$4,planned_end_at=$5,status=$6,actual_completed_at=$7,
			archived_at=CASE WHEN $6='archived' THEN COALESCE(archived_at,NOW()) ELSE NULL END,updated_at=NOW()
			WHERE id=$8 AND workspace_id=$9 AND deleted_at IS NULL`,
			name, description, timezone, plannedStartAt, plannedEndAt, status, actualCompletedAt, access.ProductionID, access.WorkspaceID); err != nil {
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
	err := app.db.QueryRow(ctx, `SELECT id,workspace_id,name,status,timezone,planned_start_at,planned_end_at,actual_completed_at,description,created_by,created_at,updated_at,archived_at
		FROM productions WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
		productionID, workspaceID).Scan(&p.ID, &p.WorkspaceID, &p.Name, &p.Status, &p.Timezone, &p.PlannedStartAt, &p.PlannedEndAt, &p.ActualCompletedAt, &p.Description, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt, &p.ArchivedAt)
	return p, err
}

type accessibleProduction struct {
	production
	WorkspaceName      string   `json:"workspace_name"`
	WorkspaceNavigable bool     `json:"workspace_navigable"`
	WorkspaceRole      string   `json:"workspace_role,omitempty"`
	DirectRole         string   `json:"direct_role,omitempty"`
	ContextKind        string   `json:"context_kind"`
	PermissionKeys     []string `json:"permission_keys"`
}

func (app *application) accessibleProduction(ctx context.Context, access productionAccess) (accessibleProduction, error) {
	p, err := app.findProduction(ctx, access.WorkspaceID, access.ProductionID)
	if err != nil {
		return accessibleProduction{}, err
	}
	kind := "participating"
	if access.WorkspaceNavigable {
		kind = "workspace"
	}
	return accessibleProduction{production: p, WorkspaceName: access.WorkspaceName, WorkspaceNavigable: access.WorkspaceNavigable,
		WorkspaceRole: access.WorkspaceRole, DirectRole: access.DirectRole, ContextKind: kind, PermissionKeys: productionPermissionList(access)}, nil
}

func (app *application) getAccessibleProduction(w http.ResponseWriter, r *http.Request) {
	item, err := app.accessibleProduction(r.Context(), currentProductionAccess(r))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (app *application) listAccessibleProductions(w http.ResponseWriter, r *http.Request) {
	rows, err := app.db.Query(r.Context(), `SELECT DISTINCT p.id FROM productions p
		JOIN workspaces w ON w.id=p.workspace_id AND w.deleted_at IS NULL
		LEFT JOIN workspace_memberships wm ON wm.workspace_id=p.workspace_id AND wm.user_id=$1 AND wm.status='active'
		LEFT JOIN production_memberships pm ON pm.production_id=p.id AND pm.user_id=$1 AND pm.status='active' AND (pm.starts_at IS NULL OR pm.starts_at<=NOW()) AND (pm.expires_at IS NULL OR pm.expires_at>NOW())
		WHERE p.deleted_at IS NULL AND (wm.id IS NOT NULL OR pm.id IS NOT NULL)
		ORDER BY p.id`, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []accessibleProduction{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			serverError(w, err)
			return
		}
		access, err := app.productionAccessFor(r.Context(), claims(r).Subject, id)
		if err != nil {
			continue
		}
		item, err := app.accessibleProduction(r.Context(), access)
		if err != nil {
			serverError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *application) canGrantProducer(r *http.Request) bool {
	return canGrantProductionRole(currentProductionAccess(r), "producer")
}

func (app *application) canManageProductionMembers(r *http.Request) bool {
	return currentProductionAccess(r).Permissions[productionMembersManage]
}

func (app *application) listProductionMembers(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	now := time.Now().UTC()
	rows, err := app.db.Query(r.Context(), `SELECT u.id,u.display_name,COALESCE((SELECT provider_subject FROM user_identities WHERE user_id=u.id AND provider='email' LIMIT 1),''),u.avatar_url,
		wm.role, pm.id,pm.role_key,pm.status,pm.starts_at,pm.expires_at,pm.created_at
		FROM workspace_memberships wm JOIN users u ON u.id=wm.user_id
		LEFT JOIN LATERAL (SELECT id,role_key,status,starts_at,expires_at,created_at FROM production_memberships WHERE production_id=$1 AND user_id=wm.user_id AND status <> 'revoked' ORDER BY created_at DESC LIMIT 1) pm ON TRUE
		WHERE wm.workspace_id=$2 AND wm.status='active' ORDER BY u.display_name`, access.ProductionID, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	inherited := []map[string]any{}
	for rows.Next() {
		var uid, name, email, avatar, role string
		var id, directRole, status *string
		var starts, expires *time.Time
		var created *time.Time
		if err := rows.Scan(&uid, &name, &email, &avatar, &role, &id, &directRole, &status, &starts, &expires, &created); err != nil {
			serverError(w, err)
			return
		}
		effective := ""
		if status != nil {
			effective = effectiveProductionMembershipStatus(*status, starts, expires, now)
		}
		inherited = append(inherited, map[string]any{"user_id": uid, "display_name": name, "email": email, "avatar_url": avatar, "workspace_role": role, "membership_id": id, "direct_role": directRole, "status": status, "effective_status": effective, "starts_at": starts, "expires_at": expires, "created_at": created, "access_source": "workspace_membership"})
	}
	directRows, err := app.db.Query(r.Context(), `SELECT pm.id,pm.user_id,u.display_name,COALESCE((SELECT provider_subject FROM user_identities WHERE user_id=u.id AND provider='email' LIMIT 1),''),u.avatar_url,pm.role_key,pm.status,pm.starts_at,pm.expires_at,pm.created_at
		FROM production_memberships pm JOIN users u ON u.id=pm.user_id WHERE pm.production_id=$1 AND pm.status <> 'revoked'
		ORDER BY pm.created_at DESC`, access.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer directRows.Close()
	direct := []map[string]any{}
	for directRows.Next() {
		var id, uid, name, email, avatar, role, status string
		var starts, expires *time.Time
		var created time.Time
		if err := directRows.Scan(&id, &uid, &name, &email, &avatar, &role, &status, &starts, &expires, &created); err != nil {
			serverError(w, err)
			return
		}
		direct = append(direct, map[string]any{"id": id, "user_id": uid, "display_name": name, "email": email, "avatar_url": avatar, "role_key": role, "status": status, "effective_status": effectiveProductionMembershipStatus(status, starts, expires, now), "starts_at": starts, "expires_at": expires, "created_at": created, "access_source": "production_membership"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"inherited": inherited, "direct": direct, "can_manage": app.canManageProductionMembers(r)})
}

func (app *application) createProductionMember(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UserID    string     `json:"user_id"`
		RoleKey   string     `json:"role_key"`
		StartsAt  *time.Time `json:"starts_at"`
		ExpiresAt *time.Time `json:"expires_at"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.RoleKey = strings.ToLower(strings.TrimSpace(in.RoleKey))
	if in.UserID == "" || !validProductionRole(in.RoleKey) {
		errorJSON(w, 400, "invalid_input", "成员或角色无效")
		return
	}
	access := currentProductionAccess(r)
	if !canGrantProductionRole(access, in.RoleKey) {
		errorJSON(w, 403, "production_forbidden", "只有工作空间管理者可以授予 Producer")
		return
	}
	if !validProductionTimeWindow(w, in.StartsAt, in.ExpiresAt, "成员") {
		return
	}
	var targetExists bool
	if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(
		SELECT 1 FROM users u JOIN workspace_memberships wm ON wm.user_id=u.id
		WHERE u.id=$1 AND u.deleted_at IS NULL AND wm.workspace_id=$2 AND wm.status='active'
	)`, in.UserID, access.WorkspaceID).Scan(&targetExists); err != nil {
		serverError(w, err)
		return
	}
	if !targetExists {
		errorJSON(w, http.StatusBadRequest, "workspace_member_required", "直接添加成员仅支持当前工作空间成员，请使用邀请链接添加外部协作者")
		return
	}
	_, err := app.db.Exec(r.Context(), `INSERT INTO production_memberships(id,production_id,user_id,role_key,status,starts_at,expires_at,invited_by) VALUES($1,$2,$3,$4,'active',$5,$6,$7)`, newID(), access.ProductionID, in.UserID, in.RoleKey, in.StartsAt, in.ExpiresAt, claims(r).Subject)
	if err != nil {
		if strings.Contains(err.Error(), "production_memberships_current_unique") {
			errorJSON(w, 409, "membership_exists", "该用户已有有效活动成员关系")
		} else {
			serverError(w, err)
		}
		return
	}
	writeJSON(w, 201, map[string]any{"status": "ok", "starts_at": in.StartsAt, "expires_at": in.ExpiresAt, "effective_status": effectiveProductionMembershipStatus("active", in.StartsAt, in.ExpiresAt, time.Now().UTC())})
}

func (app *application) updateProductionMember(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RoleKey   *string      `json:"role_key"`
		Status    *string      `json:"status"`
		StartsAt  optionalTime `json:"starts_at"`
		ExpiresAt optionalTime `json:"expires_at"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	access := currentProductionAccess(r)
	id := r.PathValue("memberId")
	var existingRole, existingStatus string
	if err := app.db.QueryRow(r.Context(), `SELECT role_key,status FROM production_memberships WHERE id=$1 AND production_id=$2 AND status <> 'revoked'`, id, access.ProductionID).Scan(&existingRole, &existingStatus); err != nil {
		errorJSON(w, 404, "member_not_found", "活动成员不存在")
		return
	}
	role := existingRole
	if in.RoleKey != nil {
		role = strings.ToLower(strings.TrimSpace(*in.RoleKey))
		if !validProductionRole(role) || !canGrantProductionRole(access, role) {
			errorJSON(w, 403, "production_forbidden", "不能授予该角色")
			return
		}
	}
	status := existingStatus
	if in.Status != nil {
		status = *in.Status
		if status != "active" && status != "suspended" {
			errorJSON(w, 400, "invalid_input", "状态无效")
			return
		}
	}
	var currentStarts, currentExpires *time.Time
	if err := app.db.QueryRow(r.Context(), `SELECT starts_at,expires_at FROM production_memberships WHERE id=$1 AND production_id=$2 AND status <> 'revoked'`, id, access.ProductionID).Scan(&currentStarts, &currentExpires); err != nil {
		errorJSON(w, 404, "member_not_found", "活动成员不存在")
		return
	}
	nextStarts, nextExpires := currentStarts, currentExpires
	if in.StartsAt.Present {
		nextStarts = in.StartsAt.Value
	}
	if in.ExpiresAt.Present {
		nextExpires = in.ExpiresAt.Value
	}
	if !validProductionTimeWindow(w, nextStarts, nextExpires, "成员") {
		return
	}
	_, err := app.db.Exec(r.Context(), `UPDATE production_memberships SET role_key=$1,status=$2,
		starts_at=CASE WHEN $3 THEN $4 ELSE starts_at END,
		expires_at=CASE WHEN $5 THEN $6 ELSE expires_at END,
		updated_at=NOW() WHERE id=$7 AND production_id=$8 AND status <> 'revoked'`, role, status, in.StartsAt.Present, in.StartsAt.Value, in.ExpiresAt.Present, in.ExpiresAt.Value, id, access.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"status": "ok", "role_key": role, "membership_status": status, "starts_at": nextStarts, "expires_at": nextExpires, "effective_status": effectiveProductionMembershipStatus(status, nextStarts, nextExpires, time.Now().UTC())})
}

func (app *application) revokeProductionMember(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	tag, err := app.db.Exec(r.Context(), `UPDATE production_memberships SET status='revoked',revoked_at=NOW(),updated_at=NOW() WHERE id=$1 AND production_id=$2 AND status <> 'revoked'`, r.PathValue("memberId"), access.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		errorJSON(w, 404, "member_not_found", "活动成员不存在")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "revoked"})
}

func (app *application) createProductionInvitation(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RoleKey         string     `json:"role_key"`
		TargetEmail     string     `json:"target_email"`
		MaxUses         int        `json:"max_uses"`
		StartsAt        *time.Time `json:"starts_at"`
		ExpiresAt       *time.Time `json:"expires_at"`
		MemberExpiresAt *time.Time `json:"member_expires_at"`
		MemberStartsAt  *time.Time `json:"member_starts_at"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.RoleKey = strings.ToLower(strings.TrimSpace(in.RoleKey))
	in.TargetEmail = normalizeEmail(in.TargetEmail)
	if !validProductionRole(in.RoleKey) {
		errorJSON(w, 400, "invalid_input", "角色无效")
		return
	}
	access := currentProductionAccess(r)
	if !canGrantProductionRole(access, in.RoleKey) {
		errorJSON(w, 403, "production_forbidden", "只有工作空间管理者可以邀请 Producer")
		return
	}
	if in.MaxUses == 0 {
		in.MaxUses = 1
	}
	if in.MaxUses < 1 || in.MaxUses > 100 || (in.TargetEmail != "" && in.MaxUses != 1) {
		errorJSON(w, 400, "invalid_input", "邀请码次数无效")
		return
	}
	now := time.Now().UTC()
	starts := now
	if in.StartsAt != nil {
		starts = in.StartsAt.UTC()
	}
	expires := now.Add(7 * 24 * time.Hour)
	if in.ExpiresAt != nil {
		expires = in.ExpiresAt.UTC()
	}
	if !starts.Before(expires) {
		errorJSON(w, 400, "invalid_input", "邀请开始时间必须早于失效时间")
		return
	}
	if in.MemberStartsAt != nil && in.MemberExpiresAt != nil && !in.MemberStartsAt.Before(*in.MemberExpiresAt) {
		errorJSON(w, 400, "invalid_input", "成员开始时间必须早于结束时间")
		return
	}
	if !expires.After(now) {
		errorJSON(w, 400, "invalid_input", "邀请码必须在未来过期")
		return
	}
	token := randomToken()
	id := newID()
	_, err := app.db.Exec(r.Context(), `INSERT INTO production_invitations(id,production_id,role_key,target_email,token_hash,max_uses,starts_at,expires_at,member_starts_at,member_expires_at,created_by) VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11)`, id, access.ProductionID, in.RoleKey, in.TargetEmail, tokenHash(token), in.MaxUses, starts, expires, in.MemberStartsAt, in.MemberExpiresAt, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"id": id, "accept_token": token, "starts_at": starts, "expires_at": expires, "member_starts_at": in.MemberStartsAt, "member_expires_at": in.MemberExpiresAt, "max_uses": in.MaxUses})
}

func (app *application) listProductionInvitations(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	rows, err := app.db.Query(r.Context(), `SELECT id,role_key,COALESCE(target_email,''),max_uses,accepted_count,starts_at,expires_at,member_starts_at,member_expires_at,revoked_at,created_at FROM production_invitations WHERE production_id=$1 ORDER BY created_at DESC`, access.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, role, email string
		var max, accepted int
		var starts, expires time.Time
		var memberStarts, memberExpires, revoked *time.Time
		var created time.Time
		if err := rows.Scan(&id, &role, &email, &max, &accepted, &starts, &expires, &memberStarts, &memberExpires, &revoked, &created); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, map[string]any{"id": id, "role_key": role, "target_email": email, "max_uses": max, "accepted_count": accepted, "starts_at": starts, "expires_at": expires, "member_starts_at": memberStarts, "member_expires_at": memberExpires, "revoked_at": revoked, "created_at": created})
	}
	writeJSON(w, 200, items)
}

func (app *application) revokeProductionInvitation(w http.ResponseWriter, r *http.Request) {
	access := currentProductionAccess(r)
	tag, err := app.db.Exec(r.Context(), `UPDATE production_invitations SET revoked_at=NOW() WHERE id=$1 AND production_id=$2 AND revoked_at IS NULL`, r.PathValue("invitationId"), access.ProductionID)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		errorJSON(w, 404, "invitation_not_found", "邀请码不存在")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "revoked"})
}

func (app *application) acceptProductionInvitation(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if !decodeJSON(w, r, &in) || in.Token == "" {
		if in.Token == "" {
			errorJSON(w, 400, "invalid_input", "邀请码无效")
		}
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var id, productionID, role string
	var targetEmail *string
	var max, accepted int
	var starts, expires time.Time
	var memberStarts, memberExpires *time.Time
	var revoked *time.Time
	err = tx.QueryRow(r.Context(), `SELECT id,production_id,role_key,target_email,max_uses,accepted_count,starts_at,expires_at,member_starts_at,member_expires_at,revoked_at FROM production_invitations WHERE token_hash=$1 FOR UPDATE`, tokenHash(in.Token)).Scan(&id, &productionID, &role, &targetEmail, &max, &accepted, &starts, &expires, &memberStarts, &memberExpires, &revoked)
	now := time.Now().UTC()
	if err != nil || revoked != nil || now.Before(starts) || !expires.After(now) || accepted >= max {
		errorJSON(w, 404, "invitation_not_found", "邀请码无效或已失效")
		return
	}
	var email string
	err = tx.QueryRow(r.Context(), `SELECT provider_subject FROM user_identities WHERE user_id=$1 AND provider='email' LIMIT 1`, claims(r).Subject).Scan(&email)
	if err != nil {
		serverError(w, err)
		return
	}
	if targetEmail != nil && normalizeEmail(email) != *targetEmail {
		errorJSON(w, 403, "invitation_forbidden", "该邀请仅限指定邮箱接受")
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO production_memberships(id,production_id,user_id,role_key,status,starts_at,expires_at,invited_by) VALUES($1,$2,$3,$4,'active',$5,$6,NULL)`, newID(), productionID, claims(r).Subject, role, memberStarts, memberExpires)
	if err != nil {
		errorJSON(w, 409, "membership_exists", "你已拥有该活动的有效成员关系")
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE production_invitations SET accepted_count=accepted_count+1 WHERE id=$1`, id)
	if err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]string{"production_id": productionID, "status": "accepted"})
}
