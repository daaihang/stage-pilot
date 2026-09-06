package main

// Workspace / Tenant Foundation。
//
// Workspace 是 Stage Pilot 的 SaaS 租户边界，User 与 Workspace 通过
// workspace_memberships 形成多对多关系。User 拥有账号不代表属于任何
// Workspace；WorkspaceMembership 只表达「这个用户是这个 Workspace 的
// 内部成员」。本文件不实现 Production 等后续领域。

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	workspaceRoleOwner  = "owner"
	workspaceRoleAdmin  = "admin"
	workspaceRoleMember = "member"
)

// roleRank 让角色可以比较大小；未来扩展 RBAC 时替换为 Role/Permission 表查询。
var roleRank = map[string]int{
	workspaceRoleMember: 1,
	workspaceRoleAdmin:  2,
	workspaceRoleOwner:  3,
}

type workspace struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Slug            string    `json:"slug"`
	Description     string    `json:"description"`
	AvatarURL       string    `json:"avatar_url"`
	DefaultTimezone string    `json:"default_timezone"`
	Role            string    `json:"role,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type workspaceMember struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	UserID      string    `json:"user_id"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
	DisplayName string    `json:"display_name"`
	Email       string    `json:"email"`
	AvatarURL   string    `json:"avatar_url"`
	CreatedAt   time.Time `json:"created_at"`
}

const membershipKey contextKey = "stagepilot.auth.workspace_membership"

// workspaceAccess 是请求级的当前 Workspace 上下文：已通过
// membership 校验的 workspace + user + role，handler 不再自行判断。
type workspaceAccess struct {
	WorkspaceID string
	UserID      string
	Role        string
}

func currentWorkspaceAccess(r *http.Request) workspaceAccess {
	return r.Context().Value(membershipKey).(workspaceAccess)
}

// requireWorkspaceRole 是统一的 Workspace 授权入口：
// 要求 authenticated user 拥有该 workspace 的 active membership，
// 且角色不低于 minimumRole。工作空间不存在与无权限都返回 403，
// 不向调用者泄露工作空间是否存在。
func (app *application) requireWorkspaceRole(minimumRole string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workspaceID := r.PathValue("id")
		userID := claims(r).Subject
		var role string
		err := app.db.QueryRow(r.Context(), `SELECT m.role FROM workspace_memberships m
			JOIN workspaces w ON w.id = m.workspace_id
			WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND w.deleted_at IS NULL`,
			workspaceID, userID).Scan(&role)
		if err != nil || roleRank[role] < roleRank[minimumRole] {
			errorJSON(w, http.StatusForbidden, "workspace_forbidden", "没有访问这个工作空间的权限")
			return
		}
		access := workspaceAccess{WorkspaceID: workspaceID, UserID: userID, Role: role}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), membershipKey, access)))
	})
}

func (app *application) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		AvatarURL   string `json:"avatar_url"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	name := strings.TrimSpace(in.Name)
	if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 80 ||
		utf8.RuneCountInString(in.Description) > 500 || len(in.AvatarURL) > 2048 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "工作空间名称不能为空且不能超过 80 字")
		return
	}
	userID := claims(r).Subject
	ctx := r.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	workspaceID := newID()
	slug, err := insertWorkspaceRow(ctx, tx, workspaceID, name, strings.TrimSpace(in.Description), strings.TrimSpace(in.AvatarURL))
	if err != nil {
		serverError(w, err)
		return
	}
	app.logger.Info("workspace created", "workspace_id", workspaceID, "slug", slug, "user_id", userID)
	// 创建者自动成为 OWNER；同时把它记为最近使用的工作空间，创建后即可直接进入。
	if _, err = tx.Exec(ctx, `INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status) VALUES ($1,$2,$3,$4,'active')`,
		newID(), workspaceID, userID, workspaceRoleOwner); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(ctx, `UPDATE user_preferences SET last_workspace_id=$1,updated_at=NOW() WHERE user_id=$2`,
		workspaceID, userID); err != nil {
		serverError(w, err)
		return
	}
	if _, err = tx.Exec(ctx, `INSERT INTO workspace_settings (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING`, workspaceID); err != nil {
		serverError(w, err)
		return
	}
	if err = seedWorkspaceDefaults(ctx, tx, workspaceID, userID); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		serverError(w, err)
		return
	}
	created, err := app.findWorkspace(ctx, workspaceID, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

// seedWorkspaceDefaults is intentionally idempotent so migrations, retries and
// workspace creation all use the same initialization semantics.
func seedWorkspaceDefaults(ctx context.Context, tx pgx.Tx, workspaceID, createdBy string) error {
	if err := seedResourceTypes(ctx, tx, workspaceID, createdBy); err != nil {
		return err
	}
	if err := seedFileTypes(ctx, tx, workspaceID, createdBy); err != nil {
		return err
	}
	return nil
}

func seedFileTypes(ctx context.Context, tx pgx.Tx, workspaceID, createdBy string) error {
	return seedFileTypesForScope(ctx, tx, workspaceID, createdBy, "")
}

func seedFileTypesForScope(ctx context.Context, tx pgx.Tx, workspaceID, createdBy, scope string) error {
	where := ""
	args := []any{workspaceID, createdBy}
	if scope != "" {
		args = append(args, scope)
		where = " AND t.scope=$3"
	}
	_, err := tx.Exec(ctx, `INSERT INTO file_types (id,workspace_id,scope,template_key,name,description,sort_order,is_system_default,is_active,created_by)
		SELECT md5($1 || ':' || t.key), $1, t.scope, t.key, t.name, t.description, t.sort_order, TRUE, t.is_active, $2
		FROM file_type_templates t
		WHERE NOT EXISTS (SELECT 1 FROM file_types f WHERE f.workspace_id=$1 AND f.scope=t.scope AND f.template_key=t.key AND f.deleted_at IS NULL)`+where+`
		ON CONFLICT (id) DO UPDATE SET deleted_at=NULL,is_system_default=TRUE,template_key=EXCLUDED.template_key`, args...)
	return err
}

// listWorkspaces 返回当前用户拥有 active membership 的工作空间（含角色）。
// 响应永远按 authenticated user 过滤，天然满足租户隔离。
func (app *application) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	rows, err := app.db.Query(r.Context(), `SELECT w.id,w.name,w.slug,w.description,w.avatar_url,COALESCE(s.default_timezone,'Asia/Shanghai'),m.role,w.created_at,w.updated_at
		FROM workspaces w
		JOIN workspace_memberships m ON m.workspace_id = w.id
		LEFT JOIN workspace_settings s ON s.workspace_id = w.id
		WHERE m.user_id=$1 AND m.status='active' AND w.deleted_at IS NULL
		ORDER BY w.created_at, w.id`, claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	workspaces := []workspace{}
	for rows.Next() {
		var ws workspace
		if err := rows.Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Description, &ws.AvatarURL, &ws.DefaultTimezone, &ws.Role, &ws.CreatedAt, &ws.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		workspaces = append(workspaces, ws)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, workspaces)
}

func (app *application) getWorkspace(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	found, err := app.findWorkspace(r.Context(), access.WorkspaceID, access.UserID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, found)
}

func (app *application) updateWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		AvatarURL   *string `json:"avatar_url"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Name != nil && (utf8.RuneCountInString(strings.TrimSpace(*in.Name)) < 1 || utf8.RuneCountInString(*in.Name) > 80) {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "工作空间名称不能为空且不能超过 80 字")
		return
	}
	if in.Description != nil && utf8.RuneCountInString(*in.Description) > 500 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "描述不能超过 500 字")
		return
	}
	if in.AvatarURL != nil && len(*in.AvatarURL) > 2048 {
		errorJSON(w, http.StatusBadRequest, "invalid_input", "头像地址无效")
		return
	}
	access := currentWorkspaceAccess(r)
	if _, err := app.db.Exec(r.Context(), `UPDATE workspaces SET
		name=COALESCE($1,name), description=COALESCE($2,description), avatar_url=COALESCE($3,avatar_url), updated_at=NOW()
		WHERE id=$4 AND deleted_at IS NULL`,
		nullableTrimmed(in.Name), nullableTrimmed(in.Description), nullableTrimmed(in.AvatarURL), access.WorkspaceID); err != nil {
		serverError(w, err)
		return
	}
	updated, err := app.findWorkspace(r.Context(), access.WorkspaceID, access.UserID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// listWorkspaceMembers 展示成员、角色与加入时间。
// 邮箱通过子查询取得，避免 user_identities 多行导致成员重复。
func (app *application) listWorkspaceMembers(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	rows, err := app.db.Query(r.Context(), `SELECT m.id,m.workspace_id,m.user_id,m.role,m.status,
			u.display_name,COALESCE((SELECT i.provider_subject FROM user_identities i WHERE i.user_id=u.id AND i.provider='email' LIMIT 1),''),u.avatar_url,m.created_at
		FROM workspace_memberships m
		JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id=$1
		ORDER BY m.created_at, m.id`, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	members := []workspaceMember{}
	for rows.Next() {
		var member workspaceMember
		if err := rows.Scan(&member.ID, &member.WorkspaceID, &member.UserID, &member.Role, &member.Status,
			&member.DisplayName, &member.Email, &member.AvatarURL, &member.CreatedAt); err != nil {
			serverError(w, err)
			return
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// putLastWorkspace 持久化「最近使用的工作空间」。
// workspace_id 必须通过 membership 校验；空值表示清除最近记录。
// 前端 localStorage 只能作为缓存，恢复时以服务端数据为准。
func (app *application) putLastWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	userID := claims(r).Subject
	ctx := r.Context()
	if in.WorkspaceID == "" {
		if _, err := app.db.Exec(ctx, `UPDATE user_preferences SET last_workspace_id=NULL,updated_at=NOW() WHERE user_id=$1`, userID); err != nil {
			serverError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	var allowed bool
	if err := app.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_memberships m
			JOIN workspaces w ON w.id = m.workspace_id
			WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND w.deleted_at IS NULL)`,
		in.WorkspaceID, userID).Scan(&allowed); err != nil {
		serverError(w, err)
		return
	}
	if !allowed {
		errorJSON(w, http.StatusForbidden, "workspace_forbidden", "没有访问这个工作空间的权限")
		return
	}
	if _, err := app.db.Exec(ctx, `UPDATE user_preferences SET last_workspace_id=$1,updated_at=NOW() WHERE user_id=$2`,
		in.WorkspaceID, userID); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "workspace_id": in.WorkspaceID})
}

// getLastWorkspace 返回用户保存的最近工作空间（已校验 membership 仍有效）。
// 恢复登录后的工作空间上下文以服务端数据为准，前端 localStorage 仅作缓存。
func (app *application) getLastWorkspace(w http.ResponseWriter, r *http.Request) {
	lastID, err := app.lastWorkspaceID(r.Context(), claims(r).Subject)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"workspace_id": lastID})
}

// lastWorkspaceID 返回用户保存的最近工作空间；仅在 membership 仍有效时返回。
func (app *application) lastWorkspaceID(ctx context.Context, userID string) (string, error) {
	var lastID *string
	if err := app.db.QueryRow(ctx, `SELECT last_workspace_id FROM user_preferences WHERE user_id=$1`, userID).Scan(&lastID); err != nil {
		return "", err
	}
	if lastID == nil {
		return "", nil
	}
	var valid bool
	if err := app.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_memberships m
			JOIN workspaces w ON w.id = m.workspace_id
			WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='active' AND w.deleted_at IS NULL)`,
		*lastID, userID).Scan(&valid); err != nil {
		return "", err
	}
	if !valid {
		return "", nil
	}
	return *lastID, nil
}

func (app *application) findWorkspace(ctx context.Context, workspaceID, userID string) (workspace, error) {
	var ws workspace
	err := app.db.QueryRow(ctx, `SELECT w.id,w.name,w.slug,w.description,w.avatar_url,COALESCE(s.default_timezone,'Asia/Shanghai'),m.role,w.created_at,w.updated_at
		FROM workspaces w
		JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = $2
		LEFT JOIN workspace_settings s ON s.workspace_id = w.id
		WHERE w.id=$1 AND w.deleted_at IS NULL`, workspaceID, userID).Scan(
		&ws.ID, &ws.Name, &ws.Slug, &ws.Description, &ws.AvatarURL, &ws.DefaultTimezone, &ws.Role, &ws.CreatedAt, &ws.UpdatedAt)
	return ws, err
}

// insertWorkspaceRow 生成 slug 并插入工作空间；slug 冲突时自动追加随机后缀重试。
// slug 仅保留 [a-z0-9-]，纯中文等无 ASCII 字符的名称回退为 "ws" 前缀。
// 重试通过 SAVEPOINT 实现：Postgres 在唯一约束冲突后会中止当前事务，
// 必须先 ROLLBACK TO SAVEPOINT 才能继续在同一事务里重试。
func insertWorkspaceRow(ctx context.Context, exec interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, workspaceID, name, description, avatarURL string) (string, error) {
	base := slugify(name)
	if base == "" {
		base = "ws"
	}
	if len(base) > 48 {
		base = strings.TrimRight(base[:48], "-")
	}
	_, _ = exec.Exec(ctx, "SAVEPOINT insert_workspace_slug")
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		candidate := base
		if attempt > 0 {
			candidate = fmt.Sprintf("%s-%s", base, randomToken()[:6])
		}
		_, err := exec.Exec(ctx, `INSERT INTO workspaces (id,name,slug,description,avatar_url) VALUES ($1,$2,$3,$4,$5)`,
			workspaceID, name, candidate, description, avatarURL)
		if err == nil {
			_, _ = exec.Exec(ctx, "RELEASE SAVEPOINT insert_workspace_slug")
			return candidate, nil
		}
		lastErr = err
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
			_, _ = exec.Exec(ctx, "ROLLBACK TO SAVEPOINT insert_workspace_slug")
			return "", err
		}
		if _, rollbackErr := exec.Exec(ctx, "ROLLBACK TO SAVEPOINT insert_workspace_slug"); rollbackErr != nil {
			return "", err
		}
	}
	_, _ = exec.Exec(ctx, "RELEASE SAVEPOINT insert_workspace_slug")
	return "", lastErr
}

func slugify(name string) string {
	var b strings.Builder
	previousDash := false
	for _, r := range strings.ToLower(name) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			previousDash = false
		case r == ' ' || r == '-' || r == '_' || r == '.':
			if !previousDash && b.Len() > 0 {
				b.WriteRune('-')
				previousDash = true
			}
		default:
			// 非 ASCII 字符（如中文）不进入 slug；全部被丢弃时由调用方回退。
		}
	}
	return strings.Trim(b.String(), "-")
}

func nullableTrimmed(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}
