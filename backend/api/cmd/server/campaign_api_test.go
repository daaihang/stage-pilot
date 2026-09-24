package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func authedRequestWithHeaders(t *testing.T, app *application, token, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	app.routes().ServeHTTP(rec, req)
	return rec
}

func TestCampaignTemplateCreateListDetailAndArchive(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "campaign-api-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspace := createWorkspaceFor(t, app, token, "Campaign API 工作空间")
	workspaceID := workspace["id"].(string)
	production := createProductionFor(t, app, token, workspaceID, "Campaign API 活动", "", "")
	productionID := production["id"].(string)

	templates := authedRequest(t, app, token, http.MethodGet, "/v1/campaign-templates?kind=SUBMISSION", nil)
	if templates.Code != http.StatusOK {
		t.Fatalf("list templates = %d: %s", templates.Code, templates.Body.String())
	}
	var templateList map[string]any
	if err := json.Unmarshal(templates.Body.Bytes(), &templateList); err != nil {
		t.Fatal(err)
	}
	items, ok := templateList["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("unexpected template list: %#v", templateList)
	}
	templateID := items[0].(map[string]any)["id"].(string)
	var originalDefinition []byte
	if err := app.db.QueryRow(t.Context(), `SELECT definition FROM campaign_template_versions WHERE template_id=$1 AND version=1`, templateID).Scan(&originalDefinition); err != nil {
		t.Fatal(err)
	}
	var publishedAt *time.Time
	if err := app.db.QueryRow(t.Context(), `SELECT published_at FROM campaign_template_versions WHERE template_id=$1 AND version=1`, templateID).Scan(&publishedAt); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if publishedAt == nil {
			_, _ = app.db.Exec(t.Context(), `UPDATE campaign_template_versions SET definition=$1 WHERE template_id=$2 AND version=1`, originalDefinition, templateID)
		}
	}()

	body := map[string]any{"name": "API 节目征集", "template_id": templateID}
	created := authedRequestWithHeaders(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/campaigns", body, map[string]string{"Idempotency-Key": "campaign-create-1"})
	if created.Code != http.StatusCreated {
		t.Fatalf("create campaign = %d: %s", created.Code, created.Body.String())
	}
	var createdBody map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &createdBody); err != nil {
		t.Fatal(err)
	}
	campaign := createdBody["campaign"].(map[string]any)
	campaignID := campaign["id"].(string)
	if campaign["kind"] != campaignKindSubmission || createdBody["draft_revision"] == nil {
		t.Fatalf("unexpected create response: %#v", createdBody)
	}
	if createdBody["draft_revision"].(map[string]any)["review_recipe_version_id"] != "review_recipe_multi_stage_scored_v1" {
		t.Fatalf("system template recipe snapshot = %#v", createdBody["draft_revision"].(map[string]any)["review_recipe_version_id"])
	}
	changedID := "snapshot_changed_" + newID()
	changedDefinition, _ := json.Marshal(map[string]any{"form": map[string]any{"schema_version": 1, "blocks": []any{}, "fields": []any{map[string]any{"id": changedID, "type": "text"}}, "logic_rules": []any{}, "end_screen": map[string]any{}}})
	if publishedAt == nil {
		if _, err := app.db.Exec(t.Context(), `UPDATE campaign_template_versions SET definition=$1 WHERE template_id=$2 AND version=1`, changedDefinition, templateID); err != nil {
			t.Fatal(err)
		}
	}
	createdDetail := authedRequest(t, app, token, http.MethodGet, "/v1/campaigns/"+campaignID, nil)
	if createdDetail.Code != http.StatusOK {
		t.Fatalf("campaign snapshot detail = %d: %s", createdDetail.Code, createdDetail.Body.String())
	}
	var originalMap, detailMap map[string]any
	_ = json.Unmarshal(originalDefinition, &originalMap)
	_ = json.Unmarshal(createdDetail.Body.Bytes(), &detailMap)
	originalForm := originalMap["form"].(map[string]any)
	detailRevision := detailMap["draft_revision"].(map[string]any)
	detailForm := detailRevision["form_version"].(map[string]any)
	if !jsonEqual(originalForm["fields"], detailForm["fields"]) || strings.Contains(createdDetail.Body.String(), changedID) {
		t.Fatalf("campaign form snapshot changed with template: %d %s", createdDetail.Code, createdDetail.Body.String())
	}
	replayed := authedRequestWithHeaders(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/campaigns", body, map[string]string{"Idempotency-Key": "campaign-create-1"})
	var firstJSON, replayJSON any
	_ = json.Unmarshal(created.Body.Bytes(), &firstJSON)
	_ = json.Unmarshal(replayed.Body.Bytes(), &replayJSON)
	if replayed.Code != http.StatusCreated || replayed.Header().Get("Idempotent-Replayed") != "true" || !jsonEqual(firstJSON, replayJSON) {
		t.Fatalf("unexpected idempotent replay: code=%d replay=%q body=%s", replayed.Code, replayed.Header().Get("Idempotent-Replayed"), replayed.Body.String())
	}
	conflict := authedRequestWithHeaders(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/campaigns", map[string]any{"name": "不同请求", "template_id": templateID}, map[string]string{"Idempotency-Key": "campaign-create-1"})
	if conflict.Code != http.StatusConflict {
		t.Fatalf("idempotency key reuse = %d: %s", conflict.Code, conflict.Body.String())
	}

	listed := authedRequest(t, app, token, http.MethodGet, "/v1/productions/"+productionID+"/campaigns?kind=SUBMISSION", nil)
	if listed.Code != http.StatusOK || !containsJSONID(t, listed.Body.Bytes(), campaignID) {
		t.Fatalf("list campaigns = %d: %s", listed.Code, listed.Body.String())
	}
	detail := authedRequest(t, app, token, http.MethodGet, "/v1/campaigns/"+campaignID, nil)
	if detail.Code != http.StatusOK || !containsJSONID(t, detail.Body.Bytes(), campaignID) {
		t.Fatalf("campaign detail = %d: %s", detail.Code, detail.Body.String())
	}
	archived := authedRequest(t, app, token, http.MethodPatch, "/v1/campaigns/"+campaignID, map[string]any{"status": "archived"})
	if archived.Code != http.StatusOK || !containsJSONValue(t, archived.Body.Bytes(), "status", "archived") {
		t.Fatalf("archive campaign = %d: %s", archived.Code, archived.Body.String())
	}
}

func TestWorkspaceCampaignTemplateTenantBoundary(t *testing.T) {
	app := newIntegrationApp(t)
	ownerA := createTestUser(t, app, "campaign-template-a-"+newID()+"@example.test")
	ownerB := createTestUser(t, app, "campaign-template-b-"+newID()+"@example.test")
	tokenA, tokenB := issueTestToken(t, app, ownerA), issueTestToken(t, app, ownerB)
	workspaceA := createWorkspaceFor(t, app, tokenA, "模板租户 A")
	workspaceB := createWorkspaceFor(t, app, tokenB, "模板租户 B")
	templateID := newID()
	if _, err := app.db.Exec(t.Context(), `INSERT INTO campaign_templates(id,workspace_id,scope,kind,name,status,latest_version,created_by) VALUES($1,$2,'workspace','COLLECTION','A 的模板','published',1,$3)`, templateID, workspaceA["id"], ownerA); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO campaign_template_versions(id,template_id,workspace_id,version,definition,created_by) VALUES($1,$2,$3,1,'{"form":{"schema_version":1,"blocks":[],"fields":[],"logic_rules":[],"end_screen":{}}}'::jsonb,$4)`, newID(), templateID, workspaceA["id"], ownerA); err != nil {
		t.Fatal(err)
	}
	listed := authedRequest(t, app, tokenA, http.MethodGet, "/v1/workspaces/"+workspaceA["id"].(string)+"/campaign-templates", nil)
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), templateID) {
		t.Fatalf("workspace template list = %d: %s", listed.Code, listed.Body.String())
	}
	foreign := authedRequest(t, app, tokenB, http.MethodGet, "/v1/workspaces/"+workspaceA["id"].(string)+"/campaign-templates", nil)
	if foreign.Code != http.StatusForbidden {
		t.Fatalf("foreign workspace template list = %d: %s", foreign.Code, foreign.Body.String())
	}
	_ = workspaceB
}

func TestCampaignRevisionCreationAndTenantBoundary(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "campaign-revision-owner-"+newID()+"@example.test")
	otherUID := createTestUser(t, app, "campaign-revision-other-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	otherToken := issueTestToken(t, app, otherUID)
	workspace := createWorkspaceFor(t, app, token, "Revision API 工作空间")
	production := createProductionFor(t, app, token, workspace["id"].(string), "Revision API 活动", "", "")
	productionID := production["id"].(string)
	created := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/campaigns", map[string]any{"name": "空白收集", "kind": "COLLECTION"})
	if created.Code != http.StatusCreated {
		t.Fatalf("create blank campaign = %d: %s", created.Code, created.Body.String())
	}
	var createdBody map[string]any
	_ = json.Unmarshal(created.Body.Bytes(), &createdBody)
	campaignID := createdBody["campaign"].(map[string]any)["id"].(string)
	if forbidden := authedRequest(t, app, otherToken, http.MethodGet, "/v1/campaigns/"+campaignID, nil); forbidden.Code != http.StatusNotFound {
		t.Fatalf("cross tenant detail = %d: %s", forbidden.Code, forbidden.Body.String())
	}

	if _, err := app.db.Exec(t.Context(), `UPDATE campaign_revisions SET status='archived' WHERE campaign_id=$1`, campaignID); err != nil {
		t.Fatal(err)
	}
	revisionPayload := map[string]any{"change_note": "第二版", "form": map[string]any{"schema_version": 1, "blocks": []any{}, "fields": []any{}, "logic_rules": []any{}, "end_screen": map[string]any{}}}
	revision := authedRequestWithHeaders(t, app, token, http.MethodPost, "/v1/campaigns/"+campaignID+"/revisions", revisionPayload, map[string]string{"Idempotency-Key": "revision-create-1"})
	if revision.Code != http.StatusCreated {
		t.Fatalf("create revision = %d: %s", revision.Code, revision.Body.String())
	}
	replayed := authedRequestWithHeaders(t, app, token, http.MethodPost, "/v1/campaigns/"+campaignID+"/revisions", revisionPayload, map[string]string{"Idempotency-Key": "revision-create-1"})
	if replayed.Code != http.StatusCreated || replayed.Header().Get("Idempotent-Replayed") != "true" {
		t.Fatalf("revision replay = %d replay=%q: %s", replayed.Code, replayed.Header().Get("Idempotent-Replayed"), replayed.Body.String())
	}
	if second := authedRequest(t, app, token, http.MethodPost, "/v1/campaigns/"+campaignID+"/revisions", map[string]any{}); second.Code != http.StatusConflict {
		t.Fatalf("duplicate draft = %d: %s", second.Code, second.Body.String())
	}
}

func TestEntryManualDecisionAPI(t *testing.T) {
	app := newIntegrationApp(t)
	requireCampaignSchemaV1(t, app)

	owner := createTestUser(t, app, "entry-decision-owner-"+newID()+"@example.test")
	viewer := createTestUser(t, app, "entry-decision-viewer-"+newID()+"@example.test")
	ownerToken := issueTestToken(t, app, owner)
	viewerToken := issueTestToken(t, app, viewer)
	workspace := createWorkspaceFor(t, app, ownerToken, "Entry 决定 API")
	workspaceID := workspace["id"].(string)
	production := createProductionFor(t, app, ownerToken, workspaceID, "Entry 决定活动", "", "")
	productionID := production["id"].(string)
	if _, err := app.db.Exec(t.Context(), "INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status) VALUES($1,$2,$3,'member','active')", newID(), workspaceID, viewer); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), "INSERT INTO production_memberships(id,production_id,user_id,role_key,status,invited_by) VALUES($1,$2,$3,'viewer','active',$4)", newID(), productionID, viewer, owner); err != nil {
		t.Fatal(err)
	}

	formVersion, campaignID, revisionID, entryID := newID(), newID(), newID(), newID()
	if _, err := app.db.Exec(t.Context(), "INSERT INTO form_versions(id,workspace_id,created_by) VALUES($1,$2,$3)", formVersion, workspaceID, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), "INSERT INTO campaigns(id,workspace_id,production_id,kind,name,created_by) VALUES($1,$2,$3,'COLLECTION',$4,$5)", campaignID, workspaceID, productionID, "人工决定", owner); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO campaign_revisions(id,workspace_id,campaign_id,revision_no,status,form_version_id,availability_policy,created_by) VALUES($1,$2,$3,1,'published',$4,'{"waitlist_enabled":true}'::jsonb,$5)`, revisionID, workspaceID, campaignID, formVersion, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), "UPDATE campaigns SET status='published',published_revision_id=$1 WHERE id=$2", revisionID, campaignID); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), "INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status) VALUES($1,$2,$3,$4,$5,'submitted')", entryID, workspaceID, productionID, campaignID, revisionID); err != nil {
		t.Fatal(err)
	}

	if viewed := authedRequest(t, app, viewerToken, http.MethodGet, "/v1/entries/"+entryID, nil); viewed.Code != http.StatusOK {
		t.Fatalf("viewer detail = %d: %s", viewed.Code, viewed.Body.String())
	}
	if denied := authedRequest(t, app, viewerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "accept"}); denied.Code != http.StatusForbidden {
		t.Fatalf("viewer decision = %d: %s", denied.Code, denied.Body.String())
	}
	if invalid := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "request_changes"}); invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid decision = %d: %s", invalid.Code, invalid.Body.String())
	}
	if missingReason := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "reject"}); missingReason.Code != http.StatusUnprocessableEntity {
		t.Fatalf("missing rejection reason = %d: %s", missingReason.Code, missingReason.Body.String())
	}

	accepted := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "accept", "reason": "存量测试覆盖", "legacy_override": true})
	if accepted.Code != http.StatusOK {
		t.Fatalf("accept entry = %d: %s", accepted.Code, accepted.Body.String())
	}
	var acceptedBody map[string]any
	if err := json.Unmarshal(accepted.Body.Bytes(), &acceptedBody); err != nil {
		t.Fatal(err)
	}
	firstDecisionID := acceptedBody["decision"].(map[string]any)["id"].(string)
	if acceptedBody["entry"].(map[string]any)["status"] != "accepted" {
		t.Fatalf("accept response = %#v", acceptedBody)
	}

	waitlisted := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "waitlist", "reason": "存量测试覆盖", "legacy_override": true})
	if waitlisted.Code != http.StatusOK {
		t.Fatalf("waitlist entry = %d: %s", waitlisted.Code, waitlisted.Body.String())
	}
	var waitlistedBody map[string]any
	if err := json.Unmarshal(waitlisted.Body.Bytes(), &waitlistedBody); err != nil {
		t.Fatal(err)
	}
	secondDecisionID := waitlistedBody["decision"].(map[string]any)["id"].(string)
	if waitlistedBody["entry"].(map[string]any)["status"] != "waitlisted" {
		t.Fatalf("waitlist response = %#v", waitlistedBody)
	}
	var currentDecisionID, entryStatus, supersedesID string
	var currentCount, materializationCount int
	if err := app.db.QueryRow(t.Context(), "SELECT current_decision_id,status FROM entries WHERE id=$1", entryID).Scan(&currentDecisionID, &entryStatus); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), "SELECT supersedes_id FROM decisions WHERE id=$1", secondDecisionID).Scan(&supersedesID); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), "SELECT count(*)::int FROM decisions WHERE entry_id=$1 AND is_current", entryID).Scan(&currentCount); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), "SELECT count(*)::int FROM entry_materializations WHERE entry_id=$1", entryID).Scan(&materializationCount); err != nil {
		t.Fatal(err)
	}
	if currentDecisionID != secondDecisionID || entryStatus != "waitlisted" || supersedesID != firstDecisionID || currentCount != 1 || materializationCount != 0 {
		t.Fatalf("decision mutation state pointer=%q status=%q supersedes=%q current=%d materializations=%d", currentDecisionID, entryStatus, supersedesID, currentCount, materializationCount)
	}

	rejected := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "reject", "reason": "存量测试：名额已满", "legacy_override": true})
	if rejected.Code != http.StatusOK || !containsJSONValue(t, rejected.Body.Bytes(), "status", "rejected") {
		t.Fatalf("reject entry = %d: %s", rejected.Code, rejected.Body.String())
	}
	detail := authedRequest(t, app, ownerToken, http.MethodGet, "/v1/entries/"+entryID, nil)
	var detailBody map[string]any
	if err := json.Unmarshal(detail.Body.Bytes(), &detailBody); err != nil {
		t.Fatal(err)
	}
	if detail.Code != http.StatusOK || len(detailBody["decision_history"].([]any)) != 3 || detailBody["decision"].(map[string]any)["type"] != "reject" {
		t.Fatalf("decision history = %d: %s", detail.Code, detail.Body.String())
	}

	draftID := newID()
	if _, err := app.db.Exec(t.Context(), "INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status) VALUES($1,$2,$3,$4,$5,'draft')", draftID, workspaceID, productionID, campaignID, revisionID); err != nil {
		t.Fatal(err)
	}
	if invalidStatus := authedRequest(t, app, ownerToken, http.MethodPost, "/v1/entries/"+draftID+"/decisions", map[string]any{"type": "accept"}); invalidStatus.Code != http.StatusConflict {
		t.Fatalf("draft decision = %d: %s", invalidStatus.Code, invalidStatus.Body.String())
	}
}

func containsJSONID(t *testing.T, body []byte, id string) bool {
	t.Helper()
	return string(body) != "" && string(body) != "null" && jsonContains(body, id)
}

func containsJSONValue(t *testing.T, body []byte, key, value string) bool {
	t.Helper()
	var decoded any
	if err := json.Unmarshal(body, &decoded); err != nil {
		return false
	}
	return findJSONValue(decoded, key, value)
}

func jsonContains(body []byte, value string) bool { return strings.Contains(string(body), value) }

func jsonEqual(left, right any) bool {
	leftBytes, _ := json.Marshal(left)
	rightBytes, _ := json.Marshal(right)
	return string(leftBytes) == string(rightBytes)
}

func findJSONValue(value any, key, expected string) bool {
	switch current := value.(type) {
	case map[string]any:
		if current[key] == expected {
			return true
		}
		for _, child := range current {
			if findJSONValue(child, key, expected) {
				return true
			}
		}
	case []any:
		for _, child := range current {
			if findJSONValue(child, key, expected) {
				return true
			}
		}
	}
	return false
}

func TestEntryDecisionCapacityAndWaitlistLimits(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"waitlist_enabled":true,"capacity":1,"waitlist_limit":1}`, integrationManualReviewWorkflow)
	entryIDs := []string{newID(), newID(), newID()}
	for _, entryID := range entryIDs {
		if _, err := app.db.Exec(t.Context(), `INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status) VALUES($1,$2,$3,$4,$5,'submitted')`, entryID, fixture.workspaceID, fixture.productionID, fixture.campaignID, fixture.revisionID); err != nil {
			t.Fatal(err)
		}
	}
	decide := func(entryID, decisionType string) *httptest.ResponseRecorder {
		return authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": decisionType, "reason": "存量容量测试", "legacy_override": true})
	}
	if response := decide(entryIDs[0], "accept"); response.Code != http.StatusOK {
		t.Fatalf("first accept = %d: %s", response.Code, response.Body.String())
	}
	if response := decide(entryIDs[1], "reject"); response.Code != http.StatusOK {
		t.Fatalf("initial rejection = %d: %s", response.Code, response.Body.String())
	}
	var originalDecisionID string
	if err := app.db.QueryRow(t.Context(), `SELECT current_decision_id FROM entries WHERE id=$1`, entryIDs[1]).Scan(&originalDecisionID); err != nil {
		t.Fatal(err)
	}
	if response := decide(entryIDs[1], "accept"); response.Code != http.StatusConflict || publicResponseErrorCode(t, response) != "campaign_capacity_reached" {
		t.Fatalf("accept over capacity = %d: %s", response.Code, response.Body.String())
	}
	var currentDecisionID, currentStatus string
	if err := app.db.QueryRow(t.Context(), `SELECT current_decision_id,status FROM entries WHERE id=$1`, entryIDs[1]).Scan(&currentDecisionID, &currentStatus); err != nil {
		t.Fatal(err)
	}
	var currentDecisionCount int
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM decisions WHERE entry_id=$1 AND is_current`, entryIDs[1]).Scan(&currentDecisionCount); err != nil {
		t.Fatal(err)
	}
	if currentDecisionID != originalDecisionID || currentStatus != "rejected" || currentDecisionCount != 1 {
		t.Fatalf("capacity rejection must preserve prior decision: id=%q original=%q status=%q current count=%d", currentDecisionID, originalDecisionID, currentStatus, currentDecisionCount)
	}
	if response := decide(entryIDs[1], "waitlist"); response.Code != http.StatusOK {
		t.Fatalf("explicit waitlist = %d: %s", response.Code, response.Body.String())
	}
	if response := decide(entryIDs[2], "waitlist"); response.Code != http.StatusConflict || publicResponseErrorCode(t, response) != "waitlist_limit_reached" {
		t.Fatalf("waitlist over limit = %d: %s", response.Code, response.Body.String())
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE campaign_revisions SET availability_policy='{"waitlist_enabled":false,"capacity":1,"waitlist_limit":1}'::jsonb WHERE id=$1`, fixture.revisionID); err != nil {
		t.Fatal(err)
	}
	if response := decide(entryIDs[2], "waitlist"); response.Code != http.StatusConflict || publicResponseErrorCode(t, response) != "waitlist_disabled" {
		t.Fatalf("disabled waitlist = %d: %s", response.Code, response.Body.String())
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE entries SET status='converted' WHERE id=$1`, entryIDs[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE campaign_revisions SET availability_policy='{"waitlist_enabled":true,"capacity":1,"waitlist_limit":1}'::jsonb WHERE id=$1`, fixture.revisionID); err != nil {
		t.Fatal(err)
	}
	if response := decide(entryIDs[2], "accept"); response.Code != http.StatusConflict || publicResponseErrorCode(t, response) != "campaign_capacity_reached" {
		t.Fatalf("converted entries should consume capacity = %d: %s", response.Code, response.Body.String())
	}
}

func TestConcurrentEntryAcceptsRespectCampaignCapacity(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"capacity":1}`, integrationManualReviewWorkflow)
	const candidates = 6
	entryIDs := make([]string, candidates)
	for i := range entryIDs {
		entryIDs[i] = newID()
		if _, err := app.db.Exec(t.Context(), `INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status) VALUES($1,$2,$3,$4,$5,'submitted')`, entryIDs[i], fixture.workspaceID, fixture.productionID, fixture.campaignID, fixture.revisionID); err != nil {
			t.Fatal(err)
		}
	}
	start := make(chan struct{})
	statuses := make(chan int, candidates)
	var wait sync.WaitGroup
	for _, entryID := range entryIDs {
		wait.Add(1)
		go func(id string) {
			defer wait.Done()
			<-start
			body := strings.NewReader(`{"type":"accept","reason":"存量并发容量测试","legacy_override":true}`)
			req := httptest.NewRequest(http.MethodPost, "/v1/entries/"+id+"/decisions", body)
			req.Header.Set("Authorization", "Bearer "+fixture.ownerToken)
			req.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			app.routes().ServeHTTP(recorder, req)
			statuses <- recorder.Code
		}(entryID)
	}
	close(start)
	wait.Wait()
	close(statuses)
	succeeded, rejected := 0, 0
	for status := range statuses {
		if status == http.StatusOK {
			succeeded++
		} else if status == http.StatusConflict {
			rejected++
		} else {
			t.Errorf("unexpected decision status: %d", status)
		}
	}
	var acceptedCount int
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM entries WHERE campaign_id=$1 AND status IN ('accepted','converted')`, fixture.campaignID).Scan(&acceptedCount); err != nil {
		t.Fatal(err)
	}
	if succeeded != 1 || rejected != candidates-1 || acceptedCount != 1 {
		t.Fatalf("capacity race: succeeded=%d rejected=%d accepted entries=%d", succeeded, rejected, acceptedCount)
	}
}
