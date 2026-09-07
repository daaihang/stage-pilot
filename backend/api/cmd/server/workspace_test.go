package main

// Workspace 租户隔离与生命周期集成测试。
//
// 运行条件：DATABASE_URL 指向可用的 PostgreSQL（本地为 docker compose 的
// postgres + migrate 服务）。没有 DATABASE_URL 时跳过，保证 `go test ./...`
// 在无数据库环境仍然通过。

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(os.Stderr, nil)) }

func testDatabaseURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping workspace integration tests")
	}
	return url
}

func newIntegrationApp(t *testing.T) *application {
	t.Helper()
	pool, err := pgxpool.New(t.Context(), testDatabaseURL(t))
	if err != nil {
		t.Fatalf("connect database: %v", err)
	}
	t.Cleanup(pool.Close)
	return &application{db: pool, logger: discardLogger(), jwtSecret: []byte("stagepilot-test-secret"), invitationHashKey: []byte("stagepilot-test-invitation-hash-key-32"), invitationEncryptionKey: []byte("stagepilot-test-invitation-encryption-key-32"), rate: make(map[string]rateEntry)}
}

func createTestUser(t *testing.T, app *application, email string) string {
	t.Helper()
	ctx := t.Context()
	uid := newID()
	hash, err := hashPassword("correct horse battery")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if _, err := app.db.Exec(ctx, `INSERT INTO users (id,display_name) VALUES ($1,$2)`, uid, email); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := app.db.Exec(ctx, `INSERT INTO user_identities (id,user_id,provider,provider_subject) VALUES ($1,$2,'email',$3)`, newID(), uid, email); err != nil {
		t.Fatalf("insert identity: %v", err)
	}
	if _, err := app.db.Exec(ctx, `INSERT INTO email_verifications (id,user_id,token_hash,expires_at,used_at) VALUES ($1,$2,$3,$4,NOW())`, newID(), uid, tokenHash(randomToken()), time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("insert email verification: %v", err)
	}
	if _, err := app.db.Exec(ctx, `INSERT INTO password_credentials (user_id,password_hash) VALUES ($1,$2)`, uid, hash); err != nil {
		t.Fatalf("insert password: %v", err)
	}
	if _, err := app.db.Exec(ctx, `INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, uid); err != nil {
		t.Fatalf("insert preferences: %v", err)
	}
	return uid
}

func TestWorkspaceInvitationShortCodeLifecycle(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "workspace-invite-owner-"+newID()+"@example.test")
	guestEmail := "workspace-invite-guest-" + newID() + "@example.test"
	_ = createTestUser(t, app, guestEmail)
	ownerToken := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, ownerToken, "工作空间短码邀请")["id"].(string)
	created := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/invitations", map[string]any{"role_key": "member", "target_email": guestEmail})
	if created.Code != http.StatusCreated {
		t.Fatalf("create invitation = %d: %s", created.Code, created.Body.String())
	}
	var invitation map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &invitation); err != nil {
		t.Fatalf("decode invitation: %v", err)
	}
	code, ok := invitation["join_code"].(string)
	if !ok || len(code) != 11 || invitation["accept_token"] != nil {
		t.Fatalf("unexpected create response: %#v", invitation)
	}
	id := invitation["id"].(string)
	listed := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/invitations", nil)
	if listed.Code != http.StatusOK || strings.Contains(listed.Body.String(), code) {
		t.Fatalf("list invitation leaked credential or failed: %d %s", listed.Code, listed.Body.String())
	}
	credential := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/invitations/"+id+"/credential", nil)
	if credential.Code != http.StatusOK || credential.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("credential response = %d cache=%q body=%s", credential.Code, credential.Header().Get("Cache-Control"), credential.Body.String())
	}
	var revealed map[string]any
	_ = json.Unmarshal(credential.Body.Bytes(), &revealed)
	rotated := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/invitations/"+id+"/rotate", map[string]any{})
	if rotated.Code != http.StatusOK {
		t.Fatalf("rotate invitation = %d: %s", rotated.Code, rotated.Body.String())
	}
	var next map[string]any
	_ = json.Unmarshal(rotated.Body.Bytes(), &next)
	if next["id"] != id || next["code_version"].(float64) != 2 || next["join_code"] == revealed["join_code"] {
		t.Fatalf("unexpected rotation response: %#v", next)
	}
}

// issueTestToken 直接构造一个绑定真实会话行的 access token，
// 模拟 auth 中间件背后的已登录用户。
func issueTestToken(t *testing.T, app *application, userID string) string {
	t.Helper()
	sessionID := newID()
	refresh := randomToken()
	_, err := app.db.Exec(t.Context(), `INSERT INTO user_sessions (id,user_id,refresh_token_hash,device_name,expires_at) VALUES ($1,$2,$3,'test',$4)`,
		sessionID, userID, tokenHash(refresh), time.Now().Add(refreshLifetime))
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}
	signed, err := app.issueAccessToken(userID, sessionID)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return signed
}

func authedRequest(t *testing.T, app *application, token, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(payload)
	} else {
		reader = bytes.NewReader(nil)
	}
	request := httptest.NewRequest(method, path, reader)
	request.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	app.routes().ServeHTTP(recorder, request)
	return recorder
}

func createWorkspaceFor(t *testing.T, app *application, token, name string) map[string]any {
	t.Helper()
	recorder := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces", map[string]string{"name": name})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create workspace status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created workspace: %v", err)
	}
	return created
}

func TestCreateWorkspaceBecomesOwner(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)

	created := createWorkspaceFor(t, app, token, "隔离测试工作空间")
	if created["role"] != workspaceRoleOwner {
		t.Fatalf("role = %v, want owner", created["role"])
	}
	if created["slug"] == "" || created["slug"] == nil {
		t.Fatal("slug must be generated")
	}

	// 重复 slug：同名工作空间应自动生成不同的 slug。
	second := createWorkspaceFor(t, app, token, "隔离测试工作空间2")
	if second["slug"] == created["slug"] {
		t.Fatalf("duplicate slug not avoided: %v", second["slug"])
	}
}

func TestWorkspaceDefaultActivityTimezone(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "workspace-timezone-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspace := createWorkspaceFor(t, app, token, "默认活动时区")
	workspaceID := workspace["id"].(string)
	if workspace["default_timezone"] != "Asia/Shanghai" {
		t.Fatalf("created workspace default timezone = %v, want Asia/Shanghai", workspace["default_timezone"])
	}
	settings := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/settings", nil)
	if settings.Code != http.StatusOK || !strings.Contains(settings.Body.String(), `"default_timezone":"Asia/Shanghai"`) {
		t.Fatalf("default timezone settings status = %d body = %s", settings.Code, settings.Body.String())
	}
	updated := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/settings", map[string]string{"default_timezone": "Europe/London"})
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), `"default_timezone":"Europe/London"`) {
		t.Fatalf("updated default timezone status = %d body = %s", updated.Code, updated.Body.String())
	}
	invalid := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/settings", map[string]string{"default_timezone": "Mars/Olympus"})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid default timezone status = %d, want 400", invalid.Code)
	}
}

func TestTenantIsolationBetweenWorkspaces(t *testing.T) {
	app := newIntegrationApp(t)
	userA := createTestUser(t, app, "user-a-"+newID()+"@example.test")
	userB := createTestUser(t, app, "user-b-"+newID()+"@example.test")
	tokenA := issueTestToken(t, app, userA)
	tokenB := issueTestToken(t, app, userB)

	workspaceA := createWorkspaceFor(t, app, tokenA, "工作空间 A")
	workspaceB := createWorkspaceFor(t, app, tokenB, "工作空间 B")
	idA := workspaceA["id"].(string)
	idB := workspaceB["id"].(string)

	// User A 可以访问 Workspace A。
	if recorder := authedRequest(t, app, tokenA, http.MethodGet, "/v1/workspaces/"+idA, nil); recorder.Code != http.StatusOK {
		t.Fatalf("user A read workspace A status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	// 即使知道 Workspace B 的 ID，User A 也不能读取它或其成员。
	for _, path := range []string{"/v1/workspaces/" + idB, "/v1/workspaces/" + idB + "/members"} {
		recorder := authedRequest(t, app, tokenA, http.MethodGet, path, nil)
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("user A access %s status = %d body = %s, want 403", path, recorder.Code, recorder.Body.String())
		}
	}
	// 伪造 ID 的写请求同样被拒绝。
	recorder := authedRequest(t, app, tokenA, http.MethodPatch, "/v1/workspaces/"+idB, map[string]any{"name": "篡改后的名字"})
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("user A patch workspace B status = %d, want 403", recorder.Code)
	}
	// User A 的列表里不出现 Workspace B。
	recorder = authedRequest(t, app, tokenA, http.MethodGet, "/v1/workspaces", nil)
	var list []map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode workspace list: %v", err)
	}
	for _, item := range list {
		if item["id"] == idB {
			t.Fatal("user A workspace list leaked workspace B")
		}
	}
	// User B 更新自己的工作空间不受影响。
	if recorder := authedRequest(t, app, tokenB, http.MethodPatch, "/v1/workspaces/"+idB, map[string]any{"name": "工作空间 B 改名"}); recorder.Code != http.StatusOK {
		t.Fatalf("user B patch workspace B status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestMemberCannotUpdateWorkspace(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "owner2-"+newID()+"@example.test")
	member := createTestUser(t, app, "member2-"+newID()+"@example.test")
	ownerToken := issueTestToken(t, app, owner)
	memberToken := issueTestToken(t, app, member)

	created := createWorkspaceFor(t, app, ownerToken, "成员权限工作空间")
	workspaceID := created["id"].(string)
	if _, err := app.db.Exec(t.Context(), `INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status) VALUES ($1,$2,$3,'member','active')`, newID(), workspaceID, member); err != nil {
		t.Fatalf("insert membership: %v", err)
	}

	// MEMBER 可以查看工作空间和成员列表。
	if recorder := authedRequest(t, app, memberToken, http.MethodGet, "/v1/workspaces/"+workspaceID, nil); recorder.Code != http.StatusOK {
		t.Fatalf("member read workspace status = %d", recorder.Code)
	}
	if recorder := authedRequest(t, app, memberToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/members", nil); recorder.Code != http.StatusOK {
		t.Fatalf("member list members status = %d", recorder.Code)
	}
	// 但不能更新（PATCH 要求 ADMIN 及以上）。
	if recorder := authedRequest(t, app, memberToken, http.MethodPatch, "/v1/workspaces/"+workspaceID, map[string]any{"name": "越权改名"}); recorder.Code != http.StatusForbidden {
		t.Fatalf("member patch workspace status = %d, want 403", recorder.Code)
	}
}

func TestLastWorkspaceLifecycle(t *testing.T) {
	app := newIntegrationApp(t)
	user := createTestUser(t, app, "switch-"+newID()+"@example.test")
	token := issueTestToken(t, app, user)
	first := createWorkspaceFor(t, app, token, "最近工作空间一")
	second := createWorkspaceFor(t, app, token, "最近工作空间二")

	// 创建后最近工作空间应指向最新创建的那个。
	if got := mustLastWorkspaceID(t, app, user); got != second["id"] {
		t.Fatalf("last workspace after create = %v, want %v", got, second["id"])
	}
	// 切换回第一个。
	if recorder := authedRequest(t, app, token, http.MethodPut, "/me/last-workspace", map[string]string{"workspace_id": first["id"].(string)}); recorder.Code != http.StatusOK {
		t.Fatalf("put last workspace status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if got := mustLastWorkspaceID(t, app, user); got != first["id"] {
		t.Fatalf("last workspace after switch = %v, want %v", got, first["id"])
	}

	// 不属于用户的 workspaceId 不能设为最近工作空间。
	stranger := createTestUser(t, app, "stranger-"+newID()+"@example.test")
	strangerToken := issueTestToken(t, app, stranger)
	if recorder := authedRequest(t, app, strangerToken, http.MethodPut, "/me/last-workspace", map[string]string{"workspace_id": first["id"].(string)}); recorder.Code != http.StatusForbidden {
		t.Fatalf("stranger put last workspace status = %d, want 403", recorder.Code)
	}

	// 清除最近记录。
	if recorder := authedRequest(t, app, token, http.MethodPut, "/me/last-workspace", map[string]string{"workspace_id": ""}); recorder.Code != http.StatusOK {
		t.Fatalf("clear last workspace status = %d", recorder.Code)
	}
	if got := mustLastWorkspaceID(t, app, user); got != "" {
		t.Fatalf("last workspace after clear = %q, want empty", got)
	}
}

func mustLastWorkspaceID(t *testing.T, app *application, userID string) string {
	t.Helper()
	got, err := app.lastWorkspaceID(t.Context(), userID)
	if err != nil {
		t.Fatalf("query last workspace: %v", err)
	}
	return got
}
