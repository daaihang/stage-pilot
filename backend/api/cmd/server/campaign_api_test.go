package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	defer func() {
		_, _ = app.db.Exec(t.Context(), `UPDATE campaign_template_versions SET definition=$1 WHERE template_id=$2 AND version=1`, originalDefinition, templateID)
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
	changedID := "snapshot_changed_" + newID()
	changedDefinition, _ := json.Marshal(map[string]any{"form": map[string]any{"schema_version": 1, "blocks": []any{}, "fields": []any{map[string]any{"id": changedID, "type": "text"}}, "logic_rules": []any{}, "end_screen": map[string]any{}}})
	if _, err := app.db.Exec(t.Context(), `UPDATE campaign_template_versions SET definition=$1 WHERE template_id=$2`, changedDefinition, templateID); err != nil {
		t.Fatal(err)
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
