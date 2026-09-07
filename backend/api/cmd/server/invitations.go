package main

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	invitationPending   = "pending"
	invitationScheduled = "scheduled"
	invitationActive    = "active"
	invitationAccepted  = "accepted"
	invitationExhausted = "exhausted"
	invitationExpired   = "expired"
	invitationRevoked   = "revoked"
)

// deriveInvitationStatus is shared by workspace and production invitation
// lists. It intentionally derives state from persisted timestamps/counters so
// clients do not need to duplicate expiry logic.
func deriveInvitationStatus(now, starts, expires time.Time, revoked *time.Time, accepted, max int) string {
	if revoked != nil {
		return invitationRevoked
	}
	if accepted >= max {
		if max > 1 {
			return invitationExhausted
		}
		return invitationAccepted
	}
	if !expires.After(now) {
		return invitationExpired
	}
	if now.Before(starts) {
		return invitationScheduled
	}
	if accepted > 0 {
		return invitationActive
	}
	return invitationPending
}

func invitationRemainingUses(max, accepted int) int {
	remaining := max - accepted
	if remaining < 0 {
		return 0
	}
	return remaining
}

func invitationTargetEmail(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, userID string) (string, error) {
	var email string
	err := db.QueryRow(ctx, `SELECT provider_subject FROM user_identities WHERE user_id=$1 AND provider='email' LIMIT 1`, userID).Scan(&email)
	return normalizeEmail(email), err
}

type invitationError struct {
	status int
	code   string
	msg    string
}

func (e *invitationError) Error() string { return e.msg }

func writeInvitationError(w http.ResponseWriter, err error) bool {
	var inviteErr *invitationError
	if errors.As(err, &inviteErr) {
		errorJSON(w, inviteErr.status, inviteErr.code, inviteErr.msg)
		return true
	}
	return false
}

func invitationWindow(now time.Time, starts, expires *time.Time) (time.Time, time.Time, error) {
	start := now.UTC()
	if starts != nil {
		start = starts.UTC()
	}
	end := now.UTC().Add(7 * 24 * time.Hour)
	if expires != nil {
		end = expires.UTC()
	}
	if !start.Before(end) {
		return time.Time{}, time.Time{}, &invitationError{http.StatusBadRequest, "invalid_input", "邀请开始时间必须早于失效时间"}
	}
	if !end.After(now.UTC()) {
		return time.Time{}, time.Time{}, &invitationError{http.StatusBadRequest, "invalid_input", "邀请必须在未来失效"}
	}
	return start, end, nil
}

func normalizeInvitationRole(role string) string { return strings.ToLower(strings.TrimSpace(role)) }

// acceptWorkspaceInvitation performs short-code lookup, membership
// creation and usage accounting under one transaction. It returns a common
// acceptance response and is called by the unified accept endpoint.
func (app *application) acceptWorkspaceInvitation(ctx context.Context, code, userID string) (map[string]any, bool, error) {
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)
	var id, workspaceID, role string
	var targetEmail string
	var max, accepted int
	var starts, expires time.Time
	var revoked *time.Time
	normalizedCode, normalizeErr := normalizeInvitationCode(code)
	if normalizeErr != nil {
		return nil, false, nil
	}
	err = tx.QueryRow(ctx, `SELECT id,workspace_id,role_key,target_email,max_uses,accepted_count,starts_at,expires_at,revoked_at
		FROM workspace_invitations WHERE code_hash=$1 FOR UPDATE`, invitationCodeHash(app, normalizedCode)).Scan(&id, &workspaceID, &role, &targetEmail, &max, &accepted, &starts, &expires, &revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, true, err
	}
	var acceptedMembershipID string
	if err := tx.QueryRow(ctx, `SELECT membership_id FROM workspace_invitation_acceptances WHERE invitation_id=$1 AND user_id=$2`, id, userID).Scan(&acceptedMembershipID); err == nil {
		if err = tx.Commit(ctx); err != nil {
			return nil, true, err
		}
		return map[string]any{"status": "accepted", "scope_kind": "workspace", "workspace_id": workspaceID, "production_id": nil, "role_key": role, "already_member": true}, true, nil
	}
	now := time.Now().UTC()
	if revoked != nil || now.Before(starts) || !expires.After(now) || accepted >= max {
		return nil, true, &invitationError{http.StatusNotFound, "invitation_not_found", "邀请无效或已失效"}
	}
	email, err := invitationTargetEmail(ctx, tx, userID)
	if err != nil {
		return nil, true, err
	}
	if email != normalizeEmail(targetEmail) {
		return nil, true, invitationCodeMismatchError()
	}
	var emailVerified bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM email_verifications WHERE user_id=$1 AND used_at IS NOT NULL)`, userID).Scan(&emailVerified); err != nil {
		return nil, true, err
	}
	if !emailVerified {
		return nil, true, &invitationError{http.StatusForbidden, "email_verification_required", "请先完成邮箱验证后再接受邀请"}
	}
	var priorMembershipID, priorStatus string
	_ = tx.QueryRow(ctx, `SELECT m.id,m.status FROM workspace_memberships m WHERE m.workspace_id=$1 AND m.user_id=$2`, workspaceID, userID).Scan(&priorMembershipID, &priorStatus)
	if priorMembershipID != "" && priorStatus == "active" {
		_, err = tx.Exec(ctx, `INSERT INTO workspace_invitation_acceptances(id,invitation_id,user_id,membership_id) VALUES($1,$2,$3,$4)`, newID(), id, userID, priorMembershipID)
		if err != nil {
			return nil, true, err
		}
		_, err = tx.Exec(ctx, `UPDATE workspace_invitations SET accepted_count=accepted_count+1,updated_at=NOW() WHERE id=$1`, id)
		if err != nil {
			return nil, true, err
		}
		if err = tx.Commit(ctx); err != nil {
			return nil, true, err
		}
		return map[string]any{"status": "accepted", "scope_kind": "workspace", "workspace_id": workspaceID, "production_id": nil, "role_key": role, "already_member": true}, true, nil
	}
	var membershipID string
	if priorMembershipID != "" {
		membershipID = priorMembershipID
		_, err = tx.Exec(ctx, `UPDATE workspace_memberships SET role=$1,status='active',updated_at=NOW() WHERE id=$2`, role, membershipID)
	} else {
		membershipID = newID()
		_, err = tx.Exec(ctx, `INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status) VALUES($1,$2,$3,$4,'active')`, membershipID, workspaceID, userID, role)
	}
	if err != nil {
		return nil, true, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO workspace_invitation_acceptances(id,invitation_id,user_id,membership_id) VALUES($1,$2,$3,$4)`, newID(), id, userID, membershipID); err != nil {
		return nil, true, err
	}
	if _, err = tx.Exec(ctx, `UPDATE workspace_invitations SET accepted_count=accepted_count+1,updated_at=NOW() WHERE id=$1`, id); err != nil {
		return nil, true, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, true, err
	}
	return map[string]any{"status": "accepted", "scope_kind": "workspace", "workspace_id": workspaceID, "production_id": nil, "role_key": role, "already_member": false}, true, nil
}

func (app *application) listWorkspaceInvitations(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	rows, err := app.db.Query(r.Context(), `SELECT i.id,i.role_key,i.target_email,i.max_uses,i.accepted_count,i.starts_at,i.expires_at,i.revoked_at,i.created_at,u.display_name,COALESCE(i.code_hash,''),COALESCE(i.code_ciphertext,''),i.code_version
		FROM workspace_invitations i JOIN users u ON u.id=i.created_by WHERE i.workspace_id=$1 ORDER BY i.created_at DESC`, access.WorkspaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	now := time.Now().UTC()
	items := []map[string]any{}
	for rows.Next() {
		var id, role, email, creator, codeHash, encrypted string
		var max, accepted, codeVersion int
		var starts, expires, created time.Time
		var revoked *time.Time
		if err := rows.Scan(&id, &role, &email, &max, &accepted, &starts, &expires, &revoked, &created, &creator, &codeHash, &encrypted, &codeVersion); err != nil {
			serverError(w, err)
			return
		}
		items = append(items, map[string]any{"id": id, "scope_kind": "workspace", "role_key": role, "target_email": email, "invite_kind": "email", "max_uses": max, "accepted_count": accepted, "remaining_uses": invitationRemainingUses(max, accepted), "status": deriveInvitationStatus(now, starts, expires, revoked, accepted, max), "credential_state": invitationCredentialState(codeHash, encrypted), "join_code_available": codeHash != "" && encrypted != "", "code_version": codeVersion, "starts_at": starts, "expires_at": expires, "revoked_at": revoked, "created_at": created, "created_by": creator})
	}
	writeJSON(w, http.StatusOK, items)
}

func (app *application) createWorkspaceInvitation(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	var in struct {
		RoleKey     string     `json:"role_key"`
		TargetEmail string     `json:"target_email"`
		StartsAt    *time.Time `json:"starts_at"`
		ExpiresAt   *time.Time `json:"expires_at"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.RoleKey = normalizeInvitationRole(in.RoleKey)
	in.TargetEmail = normalizeEmail(in.TargetEmail)
	if in.TargetEmail == "" || !strings.Contains(in.TargetEmail, "@") || (in.RoleKey != workspaceRoleMember && in.RoleKey != workspaceRoleAdmin) {
		errorJSON(w, 400, "invalid_input", "邮箱和工作空间角色无效")
		return
	}
	if access.Role == workspaceRoleAdmin && in.RoleKey != workspaceRoleMember {
		errorJSON(w, 403, "workspace_forbidden", "Workspace Admin 只能邀请 Member")
		return
	}
	starts, expires, err := invitationWindow(time.Now().UTC(), in.StartsAt, in.ExpiresAt)
	if err != nil {
		writeInvitationError(w, err)
		return
	}
	id := newID()
	for attempt := 0; attempt < 5; attempt++ {
		tx, txErr := app.db.Begin(r.Context())
		if txErr != nil {
			serverError(w, txErr)
			return
		}
		code, codeErr := generateInvitationCode()
		if codeErr != nil {
			_ = tx.Rollback(r.Context())
			serverError(w, codeErr)
			return
		}
		encrypted, encryptErr := encryptInvitationCode(app, code)
		if encryptErr != nil {
			_ = tx.Rollback(r.Context())
			serverError(w, encryptErr)
			return
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO workspace_invitations(id,workspace_id,role_key,target_email,token_hash,code_hash,code_ciphertext,code_version,code_rotated_at,max_uses,starts_at,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,1,NOW(),1,$8,$9,$10)`, id, access.WorkspaceID, in.RoleKey, in.TargetEmail, tokenHash(randomToken()), invitationCodeHash(app, code), encrypted, starts, expires, access.UserID)
		if err == nil {
			if err = recordInvitationCodeEventExec(r.Context(), tx, "workspace", id, "created", 1, access.UserID); err != nil {
				_ = tx.Rollback(r.Context())
				serverError(w, err)
				return
			}
			if err = tx.Commit(r.Context()); err != nil {
				serverError(w, err)
				return
			}
			writeNoStoreJSON(w, http.StatusCreated, map[string]any{"id": id, "scope_kind": "workspace", "role_key": in.RoleKey, "target_email": in.TargetEmail, "max_uses": 1, "starts_at": starts, "expires_at": expires, "join_code": formatInvitationCode(code), "join_url": invitationJoinURL(r, code), "code_version": 1})
			return
		}
		_ = tx.Rollback(r.Context())
		if !isUniqueViolation(err, "") {
			serverError(w, err)
			return
		}
	}
	serverError(w, errors.New("could not allocate invitation code"))
}

func (app *application) revokeWorkspaceInvitation(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	var version int
	err := app.db.QueryRow(r.Context(), `UPDATE workspace_invitations SET revoked_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2 AND revoked_at IS NULL RETURNING code_version`, r.PathValue("invitationId"), access.WorkspaceID).Scan(&version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			errorJSON(w, 404, "invitation_not_found", "邀请不存在")
			return
		}
		serverError(w, err)
		return
	}
	_ = app.recordInvitationCodeEvent(r.Context(), "workspace", r.PathValue("invitationId"), "revoked", version, access.UserID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (app *application) getWorkspaceInvitationCredential(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	var id, encrypted string
	var version int
	var starts, expires time.Time
	var revoked *time.Time
	var accepted, max int
	err := app.db.QueryRow(r.Context(), `SELECT id,COALESCE(code_ciphertext,''),code_version,starts_at,expires_at,revoked_at,accepted_count,max_uses FROM workspace_invitations WHERE id=$1 AND workspace_id=$2`, r.PathValue("invitationId"), access.WorkspaceID).Scan(&id, &encrypted, &version, &starts, &expires, &revoked, &accepted, &max)
	if errors.Is(err, pgx.ErrNoRows) {
		errorJSON(w, http.StatusNotFound, "invitation_not_found", "邀请不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if !invitationRotationAllowed(time.Now().UTC(), starts, expires, revoked, accepted, max) {
		errorJSON(w, http.StatusConflict, "credential_unavailable", "当前邀请已不能复制短码")
		return
	}
	if encrypted == "" {
		errorJSON(w, http.StatusConflict, "credential_unavailable", "该旧邀请没有可复制的短码，请重新生成")
		return
	}
	code, err := decryptInvitationCode(app, encrypted)
	if err != nil {
		serverError(w, err)
		return
	}
	_ = app.recordInvitationCodeEvent(r.Context(), "workspace", id, "revealed", version, access.UserID)
	result, err := invitationCredentialResponse(r, id, "workspace", code, version, expires)
	if err != nil {
		serverError(w, err)
		return
	}
	writeNoStoreJSON(w, http.StatusOK, result)
}

func (app *application) rotateWorkspaceInvitation(w http.ResponseWriter, r *http.Request) {
	access := currentWorkspaceAccess(r)
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	var starts, expires time.Time
	var revoked *time.Time
	var accepted, max, version int
	if err = tx.QueryRow(r.Context(), `SELECT id,starts_at,expires_at,revoked_at,accepted_count,max_uses,code_version FROM workspace_invitations WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, r.PathValue("invitationId"), access.WorkspaceID).Scan(&id, &starts, &expires, &revoked, &accepted, &max, &version); errors.Is(err, pgx.ErrNoRows) {
		errorJSON(w, http.StatusNotFound, "invitation_not_found", "邀请不存在")
		return
	} else if err != nil {
		serverError(w, err)
		return
	}
	if !invitationRotationAllowed(time.Now().UTC(), starts, expires, revoked, accepted, max) {
		errorJSON(w, http.StatusConflict, "invitation_not_rotatable", "当前邀请已不能重新生成短码")
		return
	}
	code, err := generateInvitationCode()
	if err != nil {
		serverError(w, err)
		return
	}
	encrypted, err := encryptInvitationCode(app, code)
	if err != nil {
		serverError(w, err)
		return
	}
	version++
	if _, err = tx.Exec(r.Context(), `UPDATE workspace_invitations SET code_hash=$1,code_ciphertext=$2,code_version=$3,code_rotated_at=NOW(),updated_at=NOW() WHERE id=$4`, invitationCodeHash(app, code), encrypted, version, id); err != nil {
		serverError(w, err)
		return
	}
	if err = recordInvitationCodeEventExec(r.Context(), tx, "workspace", id, "rotated", version, access.UserID); err != nil {
		serverError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		serverError(w, err)
		return
	}
	result, err := invitationCredentialResponse(r, id, "workspace", code, version, expires)
	if err != nil {
		serverError(w, err)
		return
	}
	writeNoStoreJSON(w, http.StatusOK, result)
}

func (app *application) acceptInvitation(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	userID := claims(r).Subject
	ipKey := "invitation-accept:ip:" + requestClientIP(r)
	userKey := "invitation-accept:user:" + userID + ":" + requestClientIP(r)
	if !app.allowWindow(r, ipKey, 30, 10*time.Minute) || !app.allowWindow(r, userKey, 5, 10*time.Minute) {
		w.Header().Set("Retry-After", "600")
		errorJSON(w, http.StatusTooManyRequests, "invitation_rate_limited", "邀请尝试过于频繁，请稍后再试")
		return
	}
	var in struct {
		Code  string `json:"code"`
		Token string `json:"token"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Token) != "" {
		errorJSON(w, http.StatusGone, "legacy_invitation_disabled", "旧版邀请链接已失效，请使用新的短码邀请链接")
		return
	}
	code, err := normalizeInvitationCode(in.Code)
	if err != nil {
		invitationCodeError(w)
		return
	}
	result, found, err := app.acceptWorkspaceInvitation(r.Context(), code, userID)
	if found {
		if err != nil {
			if !writeInvitationError(w, err) {
				serverError(w, err)
			}
			return
		}
		writeJSON(w, http.StatusOK, result)
		app.resetRate(userKey)
		app.resetRate(ipKey)
		return
	}
	result, err = app.acceptProductionInvitationTx(r.Context(), code, userID)
	if err != nil {
		if !writeInvitationError(w, err) {
			serverError(w, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, result)
	app.resetRate(userKey)
	app.resetRate(ipKey)
}
