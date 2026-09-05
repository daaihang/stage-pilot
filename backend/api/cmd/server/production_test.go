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
		body["planned_start_at"] = startAt
	}
	if endAt != "" {
		body["planned_end_at"] = endAt
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
	if created["status"] != productionStatusActive {
		t.Fatalf("status = %v, want active", created["status"])
	}
	if created["timezone"] != "Asia/Shanghai" {
		t.Fatalf("default timezone = %v, want Asia/Shanghai", created["timezone"])
	}
	var creatorRole string
	if err := app.db.QueryRow(t.Context(), `SELECT role_key FROM production_memberships WHERE production_id=$1 AND user_id=$2 AND status='active'`, created["id"].(string), uid).Scan(&creatorRole); err != nil {
		t.Fatalf("creator membership missing: %v", err)
	}
	if creatorRole != "producer" {
		t.Fatalf("creator role = %s, want producer", creatorRole)
	}
	// 项目计划开始时间正确保存并返回。
	if _, err := time.Parse(time.RFC3339Nano, created["planned_start_at"].(string)); err != nil {
		t.Fatalf("planned_start_at not RFC3339: %v", created["planned_start_at"])
	}
	if created["actual_completed_at"] != nil {
		t.Fatalf("new active production must not have actual_completed_at: %v", created["actual_completed_at"])
	}
}

func TestProductionRejectsDraftStatus(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "prod-no-draft-create-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspace := createWorkspaceFor(t, app, token, "拒绝草稿状态工作空间")
	workspaceID := workspace["id"].(string)

	if recorder := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/productions", map[string]any{
		"name": "不应创建的草稿活动", "status": "draft",
	}); recorder.Code != http.StatusBadRequest {
		t.Fatalf("draft create status = %d body = %s, want 400", recorder.Code, recorder.Body.String())
	}

	created := createProductionFor(t, app, token, workspaceID, "正式活动", "", "")
	productionID := created["id"].(string)
	if recorder := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/productions/"+productionID, map[string]any{
		"status": "draft",
	}); recorder.Code != http.StatusBadRequest {
		t.Fatalf("draft patch status = %d body = %s, want 400", recorder.Code, recorder.Body.String())
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

func TestProductionCompletionRecordsActualTimeAndRestores(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "complete-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspace := createWorkspaceFor(t, app, token, "完成时间工作空间")
	workspaceID := workspace["id"].(string)
	plannedEnd := "2026-09-20T22:00:00Z"
	created := createProductionFor(t, app, token, workspaceID, "项目周期活动", "2026-09-18T10:00:00Z", plannedEnd)
	productionID := created["id"].(string)

	completed := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/productions/"+productionID, map[string]any{"status": productionStatusCompleted})
	if completed.Code != http.StatusOK {
		t.Fatalf("complete status = %d body = %s", completed.Code, completed.Body.String())
	}
	var completedBody map[string]any
	if err := json.Unmarshal(completed.Body.Bytes(), &completedBody); err != nil {
		t.Fatalf("decode completed: %v", err)
	}
	if completedBody["status"] != productionStatusCompleted {
		t.Fatalf("status = %v, want completed", completedBody["status"])
	}
	if completedBody["actual_completed_at"] == nil || completedBody["actual_completed_at"] == "" {
		t.Fatal("completed production must have actual_completed_at")
	}
	if _, exists := completedBody["start_at"]; exists {
		t.Fatal("response must not contain legacy start_at")
	}
	if _, exists := completedBody["end_at"]; exists {
		t.Fatal("response must not contain legacy end_at")
	}
	if completedBody["planned_end_at"] != plannedEnd {
		t.Fatalf("planned_end_at = %v, want %s", completedBody["planned_end_at"], plannedEnd)
	}

	archived := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/productions/"+productionID, map[string]any{"status": productionStatusArchived})
	if archived.Code != http.StatusOK {
		t.Fatalf("archive completed status = %d body = %s", archived.Code, archived.Body.String())
	}
	var archivedBody map[string]any
	if err := json.Unmarshal(archived.Body.Bytes(), &archivedBody); err != nil {
		t.Fatalf("decode archived completed: %v", err)
	}
	if archivedBody["actual_completed_at"] == nil {
		t.Fatal("archiving completed production must preserve actual_completed_at")
	}

	active := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/productions/"+productionID, map[string]any{"status": productionStatusActive})
	if active.Code != http.StatusOK {
		t.Fatalf("restore status = %d body = %s", active.Code, active.Body.String())
	}
	var activeBody map[string]any
	if err := json.Unmarshal(active.Body.Bytes(), &activeBody); err != nil {
		t.Fatalf("decode restored: %v", err)
	}
	if activeBody["actual_completed_at"] != nil {
		t.Fatalf("restored active production must clear actual_completed_at: %v", activeBody["actual_completed_at"])
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
		"name": "倒置时间活动", "planned_start_at": "2026-09-20T22:00:00Z", "planned_end_at": "2026-09-18T10:00:00Z",
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

func TestProductionPatchTimeStates(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "prod-time-states-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspaceID := createWorkspaceFor(t, app, token, "活动时间三态")["id"].(string)
	created := createProductionFor(t, app, token, workspaceID, "三态活动", "2026-09-18T10:00:00Z", "2026-09-20T22:00:00Z")
	path := "/v1/workspaces/" + workspaceID + "/productions/" + created["id"].(string)
	if response := authedRequest(t, app, token, http.MethodPatch, path, map[string]any{"name": "保留时间"}); response.Code != http.StatusOK {
		t.Fatalf("omitted patch = %d: %s", response.Code, response.Body.String())
	}
	cleared := authedRequest(t, app, token, http.MethodPatch, path, map[string]any{"planned_start_at": nil, "planned_end_at": nil})
	if cleared.Code != http.StatusOK {
		t.Fatalf("null patch = %d: %s", cleared.Code, cleared.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(cleared.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["planned_start_at"] != nil || body["planned_end_at"] != nil {
		t.Fatalf("cleared times = %#v", body)
	}
}

func TestProductionMembershipWindowsAndWorkspaceBoundary(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "membership-window-owner-"+newID()+"@example.test")
	member := createTestUser(t, app, "membership-window-member-"+newID()+"@example.test")
	outsider := createTestUser(t, app, "membership-window-outsider-"+newID()+"@example.test")
	ownerToken := issueTestToken(t, app, owner)
	memberToken := issueTestToken(t, app, member)
	workspaceID := createWorkspaceFor(t, app, ownerToken, "成员时间窗口")["id"].(string)
	productionID := createProductionFor(t, app, ownerToken, workspaceID, "时间窗口活动", "", "")["id"].(string)
	if _, err := app.db.Exec(t.Context(), `INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status) VALUES ($1,$2,$3,'member','active')`, newID(), workspaceID, member); err != nil {
		t.Fatalf("insert workspace member: %v", err)
	}
	future := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	end := future.Add(2 * time.Hour)
	added := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/productions/"+productionID+"/members", map[string]any{"user_id": member, "role_key": "viewer", "starts_at": future, "expires_at": end})
	if added.Code != http.StatusCreated {
		t.Fatalf("add scheduled member = %d: %s", added.Code, added.Body.String())
	}
	invalid := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/productions/"+productionID+"/members", map[string]any{"user_id": member, "role_key": "viewer", "starts_at": end, "expires_at": end})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid member window = %d: %s", invalid.Code, invalid.Body.String())
	}
	if response := authedRequest(t, app, memberToken, http.MethodGet, "/v1/productions/"+productionID, nil); response.Code != http.StatusOK {
		t.Fatalf("workspace member should retain inherited access before direct start = %d: %s", response.Code, response.Body.String())
	}
	denied := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/productions/"+productionID+"/members", map[string]any{"user_id": outsider, "role_key": "viewer"})
	if denied.Code != http.StatusBadRequest {
		t.Fatalf("external direct member = %d: %s", denied.Code, denied.Body.String())
	}
}

func TestProductionInvitationWindowCarriesMemberWindow(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "invitation-window-owner-"+newID()+"@example.test")
	outsiderEmail := "invitation-window-outsider-" + newID() + "@example.test"
	outsider := createTestUser(t, app, outsiderEmail)
	ownerToken := issueTestToken(t, app, owner)
	outsiderToken := issueTestToken(t, app, outsider)
	workspaceID := createWorkspaceFor(t, app, ownerToken, "邀请时间窗口")["id"].(string)
	productionID := createProductionFor(t, app, ownerToken, workspaceID, "邀请活动", "", "")["id"].(string)
	now := time.Now().UTC().Truncate(time.Second)
	inviteEnd := now.Add(4 * time.Hour)
	memberStart := now.Add(2 * time.Hour)
	created := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/productions/"+productionID+"/invitations", map[string]any{
		"role_key": "viewer", "target_email": outsiderEmail, "starts_at": now, "expires_at": inviteEnd, "member_starts_at": memberStart,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create invitation = %d: %s", created.Code, created.Body.String())
	}
	var invitation map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &invitation); err != nil {
		t.Fatalf("decode invitation: %v", err)
	}
	accepted := authedRequest(t, app, outsiderToken, http.MethodPost, "/v1/production-invitations/accept", map[string]any{"token": invitation["accept_token"]})
	if accepted.Code != http.StatusOK {
		t.Fatalf("accept invitation = %d: %s", accepted.Code, accepted.Body.String())
	}
	var stored time.Time
	if err := app.db.QueryRow(t.Context(), `SELECT starts_at FROM production_memberships WHERE production_id=$1 AND user_id=$2`, productionID, outsider).Scan(&stored); err != nil {
		t.Fatalf("read member start: %v", err)
	}
	if !stored.Equal(memberStart) {
		t.Fatalf("member starts_at = %s, want %s", stored, memberStart)
	}
}

func TestProductionLocationsWorkspaceIsolationAndPrimary(t *testing.T) {
	app := newIntegrationApp(t)
	owner := createTestUser(t, app, "location-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, owner)
	workspaceID := createWorkspaceFor(t, app, token, "活动地点测试")["id"].(string)
	productionID := createProductionFor(t, app, token, workspaceID, "地点活动", "", "")["id"].(string)
	types := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/resource-types/venues", nil)
	venueTypeItems, _ := decodeResourceList(t, types.Body.Bytes())
	venue := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/venues", map[string]any{"name": "主会场", "venue_type_id": venueTypeItems[0]["id"]})
	if venue.Code != http.StatusCreated {
		t.Fatalf("create venue = %d: %s", venue.Code, venue.Body.String())
	}
	venueID := resourceID(t, venue.Body.Bytes())
	created := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/locations", map[string]any{"venue_id": venueID, "is_primary": true})
	if created.Code != http.StatusOK {
		t.Fatalf("create production location = %d: %s", created.Code, created.Body.String())
	}
	listed := authedRequest(t, app, token, http.MethodGet, "/v1/productions/"+productionID+"/locations", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("list production locations = %d: %s", listed.Code, listed.Body.String())
	}
	var locations []map[string]any
	if err := json.Unmarshal(listed.Body.Bytes(), &locations); err != nil || len(locations) != 1 || locations[0]["is_primary"] != true {
		t.Fatalf("locations = %#v err=%v", locations, err)
	}
	other := createTestUser(t, app, "location-other-"+newID()+"@example.test")
	otherToken := issueTestToken(t, app, other)
	if forbidden := authedRequest(t, app, otherToken, http.MethodGet, "/v1/productions/"+productionID+"/locations", nil); forbidden.Code != http.StatusNotFound {
		t.Fatalf("cross workspace locations = %d: %s", forbidden.Code, forbidden.Body.String())
	}
}

func TestProductionLocationCanClearSpaceAndRejectReferencedRemoval(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "location-reference-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspaceID := createWorkspaceFor(t, app, token, "地点引用测试")["id"].(string)
	productionID := createProductionFor(t, app, token, workspaceID, "地点引用活动", "", "")["id"].(string)
	types := authedRequest(t, app, token, http.MethodGet, "/v1/workspaces/"+workspaceID+"/resource-types/venues", nil)
	venueTypeItems, _ := decodeResourceList(t, types.Body.Bytes())
	venue := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/venues", map[string]any{"name": "引用测试场地", "venue_type_id": venueTypeItems[0]["id"]})
	if venue.Code != http.StatusCreated {
		t.Fatalf("create venue = %d: %s", venue.Code, venue.Body.String())
	}
	venueID := resourceID(t, venue.Body.Bytes())
	space := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/venues/"+venueID+"/spaces", map[string]any{"name": "主舞台"})
	if space.Code != http.StatusCreated {
		t.Fatalf("create venue space = %d: %s", space.Code, space.Body.String())
	}
	spaceID := resourceID(t, space.Body.Bytes())
	location := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/locations", map[string]any{"venue_id": venueID, "venue_space_id": spaceID, "is_primary": true})
	if location.Code != http.StatusOK {
		t.Fatalf("create production location = %d: %s", location.Code, location.Body.String())
	}
	locationID := resourceID(t, location.Body.Bytes())

	cleared := authedRequest(t, app, token, http.MethodPatch, "/v1/productions/"+productionID+"/locations/"+locationID, map[string]any{"venue_space_id": nil})
	if cleared.Code != http.StatusOK {
		t.Fatalf("clear production location space = %d: %s", cleared.Code, cleared.Body.String())
	}
	var clearedBody map[string]any
	if err := json.Unmarshal(cleared.Body.Bytes(), &clearedBody); err != nil {
		t.Fatal(err)
	}
	if clearedBody["venue_space_id"] != nil {
		t.Fatalf("venue_space_id = %v, want null", clearedBody["venue_space_id"])
	}

	occurrence := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/occurrences", map[string]any{"name": "引用场次", "production_location_id": locationID})
	if occurrence.Code != http.StatusCreated {
		t.Fatalf("create occurrence = %d: %s", occurrence.Code, occurrence.Body.String())
	}
	removed := authedRequest(t, app, token, http.MethodDelete, "/v1/productions/"+productionID+"/locations/"+locationID, nil)
	if removed.Code != http.StatusConflict {
		t.Fatalf("remove referenced location = %d: %s, want 409", removed.Code, removed.Body.String())
	}
	var conflict map[string]any
	if err := json.Unmarshal(removed.Body.Bytes(), &conflict); err != nil {
		t.Fatal(err)
	}
	if conflict["error"].(map[string]any)["code"] != "location_in_use" {
		t.Fatalf("conflict body = %#v", conflict)
	}
}
