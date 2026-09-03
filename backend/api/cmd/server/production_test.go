package main

// Production Foundation 集成测试：生命周期、租户隔离与父子关系防伪造。
// 运行条件与 workspace_test.go 相同：设置 DATABASE_URL，否则跳过。

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func createProductionFor(t *testing.T, app *application, token, workspaceID, name, startAt, endAt string) map[string]any {
	t.Helper()
	body := map[string]any{"name": name}
	if startAt != "" {
		body["start_at"] = startAt
	}
	if endAt != "" {
		body["end_at"] = endAt
	}
	recorder := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/productions", body)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create production status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created production: %v", err)
	}
	return created
}

func TestCreateProductionRecordsWorkspaceAndCreator(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "prod-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspace := createWorkspaceFor(t, app, token, "活动创建工作空间")

	created := createProductionFor(t, app, token, workspace["id"].(string), "2026 青年音乐节", "2026-09-18T10:00:00Z", "2026-09-20T22:00:00Z")
	if created["workspace_id"] != workspace["id"] {
		t.Fatalf("workspace_id = %v, want %v", created["workspace_id"], workspace["id"])
	}
	if created["created_by"] != uid {
		t.Fatalf("created_by = %v, want %v", created["created_by"], uid)
	}
	if created["status"] != productionStatusDraft {
		t.Fatalf("status = %v, want draft", created["status"])
	}
	if created["timezone"] != "Asia/Shanghai" {
		t.Fatalf("default timezone = %v, want Asia/Shanghai", created["timezone"])
	}
	// start_at 正确保存并返回（AC-P11）。
	if _, err := time.Parse(time.RFC3339Nano, created["start_at"].(string)); err != nil {
		t.Fatalf("start_at not RFC3339: %v", created["start_at"])
	}
}

func TestCreateProductionCanExplicitlyStartActive(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "prod-active-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspace := createWorkspaceFor(t, app, token, "直接启用活动工作空间")
	recorder := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspace["id"].(string)+"/productions", map[string]any{
		"name": "直接启用活动", "status": productionStatusActive,
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("active production status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode active production: %v", err)
	}
	if created["status"] != productionStatusActive {
		t.Fatalf("status = %v, want active", created["status"])
	}
}

func TestProductionListIsWorkspaceScoped(t *testing.T) {
	app := newIntegrationApp(t)
	userA := createTestUser(t, app, "prod-a-"+newID()+"@example.test")
	userB := createTestUser(t, app, "prod-b-"+newID()+"@example.test")
	tokenA := issueTestToken(t, app, userA)
	tokenB := issueTestToken(t, app, userB)
	workspaceA := createWorkspaceFor(t, app, tokenA, "列表隔离 A")
	workspaceB := createWorkspaceFor(t, app, tokenB, "列表隔离 B")
	createProductionFor(t, app, tokenA, workspaceA["id"].(string), "A 的活动一", "", "")
	createProductionFor(t, app, tokenA, workspaceA["id"].(string), "A 的活动二", "", "")
	createProductionFor(t, app, tokenB, workspaceB["id"].(string), "B 的活动", "", "")

	recorder := authedRequest(t, app, tokenA, http.MethodGet, "/v1/workspaces/"+workspaceA["id"].(string)+"/productions", nil)
	var list []map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("workspace A list length = %d, want 2", len(list))
	}
	for _, item := range list {
		if item["name"] == "B 的活动" {
			t.Fatal("workspace A list leaked workspace B production")
		}
	}
}

func TestProductionReadIsolationAndParentSpoofing(t *testing.T) {
	app := newIntegrationApp(t)
	userA := createTestUser(t, app, "iso-a-"+newID()+"@example.test")
	userB := createTestUser(t, app, "iso-b-"+newID()+"@example.test")
	tokenA := issueTestToken(t, app, userA)
	tokenB := issueTestToken(t, app, userB)
	workspaceA := createWorkspaceFor(t, app, tokenA, "读隔离 A")
	workspaceB := createWorkspaceFor(t, app, tokenB, "读隔离 B")
	p1 := createProductionFor(t, app, tokenA, workspaceA["id"].(string), "P1 属于 A", "", "")
	p2 := createProductionFor(t, app, tokenB, workspaceB["id"].(string), "P2 属于 B", "", "")
	idA := workspaceA["id"].(string)
	idB := workspaceB["id"].(string)
	p1ID := p1["id"].(string)
	p2ID := p2["id"].(string)

	// User A 可以读取自己 workspace 的 production。
	if recorder := authedRequest(t, app, tokenA, http.MethodGet, "/v1/workspaces/"+idA+"/productions/"+p1ID, nil); recorder.Code != http.StatusOK {
		t.Fatalf("user A read P1 status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	// User B 属于 workspace B，不知道 P1 也无法访问（403 在 workspace 层拦截）。
	if recorder := authedRequest(t, app, tokenB, http.MethodGet, "/v1/workspaces/"+idA+"/productions/"+p1ID, nil); recorder.Code != http.StatusForbidden {
		t.Fatalf("user B read A production status = %d, want 403", recorder.Code)
	}
	// 父子伪造：User A 用伪造的 workspace B + P2 组合访问，必须失败（AC-P06）。
	if recorder := authedRequest(t, app, tokenA, http.MethodGet, "/v1/workspaces/"+idB+"/productions/"+p2ID, nil); recorder.Code != http.StatusForbidden {
		t.Fatalf("user A spoof workspace B status = %d, want 403", recorder.Code)
	}
	// User A 无 workspace B membership，即便用 B 的 workspaceId + B 的 productionId 也 403。
	// User B 自己伪造父子组合：P1 属于 A，B 把 URL 写成 workspace B + P1 必须失败。
	if recorder := authedRequest(t, app, tokenB, http.MethodGet, "/v1/workspaces/"+idB+"/productions/"+p1ID, nil); recorder.Code != http.StatusNotFound {
		t.Fatalf("parent spoof (B + P1) status = %d, want 404", recorder.Code)
	}
	// 伪造组合的写请求同样被拒绝。
	if recorder := authedRequest(t, app, tokenB, http.MethodPatch, "/v1/workspaces/"+idB+"/productions/"+p1ID, map[string]any{"name": "篡改"}); recorder.Code != http.StatusNotFound {
		t.Fatalf("parent spoof patch status = %d, want 404", recorder.Code)
	}
}

func TestProductionUpdatePermissionByRole(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "upd-owner-"+newID()+"@example.test")
	member := createTestUser(t, app, "upd-member-"+newID()+"@example.test")
	ownerToken := issueTestToken(t, app, owner)
	memberToken := issueTestToken(t, app, member)
	workspace := createWorkspaceFor(t, app, ownerToken, "更新权限工作空间")
	workspaceID := workspace["id"].(string)
	created := createProductionFor(t, app, ownerToken, workspaceID, "权限活动", "", "")
	productionID := created["id"].(string)

	if _, err := app.db.Exec(t.Context(), `INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status) VALUES ($1,$2,$3,'member','active')`, newID(), workspaceID, member); err != nil {
		t.Fatalf("insert member membership: %v", err)
	}

	// MEMBER 可以读取。
	if recorder := authedRequest(t, app, memberToken, http.MethodGet, "/v1/workspaces/"+workspaceID+"/productions/"+productionID, nil); recorder.Code != http.StatusOK {
		t.Fatalf("member read production status = %d", recorder.Code)
	}
	// MEMBER 不能修改（PATCH 需 ADMIN+）。
	if recorder := authedRequest(t, app, memberToken, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/productions/"+productionID, map[string]any{"name": "越权改名"}); recorder.Code != http.StatusForbidden {
		t.Fatalf("member patch production status = %d, want 403", recorder.Code)
	}
	// MEMBER 不能创建。
	if recorder := authedRequest(t, app, memberToken, http.MethodPost, "/v1/workspaces/"+workspaceID+"/productions", map[string]any{"name": "越权创建"}); recorder.Code != http.StatusForbidden {
		t.Fatalf("member create production status = %d, want 403", recorder.Code)
	}
	// OWNER 可以修改。
	if recorder := authedRequest(t, app, ownerToken, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/productions/"+productionID, map[string]any{"description": "owner 更新"}); recorder.Code != http.StatusOK {
		t.Fatalf("owner patch production status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestProductionArchiveLifecycle(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "arch-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspace := createWorkspaceFor(t, app, token, "归档工作空间")
	created := createProductionFor(t, app, token, workspace["id"].(string), "待归档活动", "", "")
	productionID := created["id"].(string)

	if recorder := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspace["id"].(string)+"/productions/"+productionID, map[string]any{"status": "archived"}); recorder.Code != http.StatusOK {
		t.Fatalf("archive status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	var archived map[string]any
	if err := json.Unmarshal(authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspace["id"].(string)+"/productions/"+productionID, nil).Body.Bytes(), &archived); err != nil {
		t.Fatalf("decode archived: %v", err)
	}
	if archived["status"] != "archived" {
		t.Fatalf("status = %v, want archived", archived["status"])
	}
	if archived["archived_at"] == nil || archived["archived_at"] == "" {
		t.Fatal("archived_at must be set after archive")
	}
	// 状态过滤：默认列表包含归档项；?status=active 不包含。
	recorder := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspace["id"].(string)+"/productions?status=active", nil)
	var actives []map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &actives); err != nil {
		t.Fatalf("decode active list: %v", err)
	}
	if len(actives) != 0 {
		t.Fatalf("active list should exclude archived, got %d", len(actives))
	}
}

func TestProductionRejectsInvalidTimeAndTimezone(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "time-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspace := createWorkspaceFor(t, app, token, "时间校验工作空间")
	workspaceID := workspace["id"].(string)

	// end < start 必须拒绝（AC-P12）。
	recorder := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/productions", map[string]any{
		"name": "倒置时间活动", "start_at": "2026-09-20T22:00:00Z", "end_at": "2026-09-18T10:00:00Z",
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("end<start create status = %d body = %s, want 400", recorder.Code, recorder.Body.String())
	}
	// 非法时区必须拒绝。
	recorder = authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/productions", map[string]any{
		"name": "坏时区活动", "timezone": "Mars/Olympus",
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("bad timezone status = %d, want 400", recorder.Code)
	}
	// 合法非默认时区保存正确。
	recorder = authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/productions", map[string]any{
		"name": "伦敦活动", "timezone": "Europe/London",
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("valid timezone create status = %d", recorder.Code)
	}
	var created map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if created["timezone"] != "Europe/London" {
		t.Fatalf("timezone = %v, want Europe/London", created["timezone"])
	}
}
