package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestParseReviewRecipeDefinition(t *testing.T) {
	tests := []struct {
		name       string
		definition string
		allow      bool
		wantCode   string
	}{
		{name: "auto accept", definition: `{"schema_version":1,"mode":"AUTO_ACCEPT","rounds":[],"final_decision":"auto_accept"}`, allow: false},
		{name: "unbound draft", definition: `{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"r1","name":"初审","execution":"parallel","reviewer_policy":{"source":"explicit_members","member_ids":[],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"binary"}}],"final_decision":"manual"}`, allow: true},
		{name: "reviewer required on publish", definition: `{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"r1","name":"初审","execution":"parallel","reviewer_policy":{"source":"explicit_members","member_ids":[],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"binary"}}],"final_decision":"manual"}`, allow: false, wantCode: "reviewer_required"},
		{name: "invalid mode", definition: `{"schema_version":1,"mode":"GRAPH","rounds":[],"final_decision":"manual"}`, allow: true, wantCode: "invalid_review_recipe_mode"},
		{name: "invalid completion", definition: `{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"r1","name":"初审","execution":"parallel","reviewer_policy":{"source":"explicit_members","member_ids":["m1"],"role_keys":[]},"completion":{"mode":"at_least_n","n":0},"feedback":{"kind":"binary"}}],"final_decision":"manual"}`, allow: true, wantCode: "invalid_completion_count"},
		{name: "invalid score weights", definition: `{"schema_version":1,"mode":"SCORED_REVIEW","rounds":[{"key":"r1","name":"评分","execution":"parallel","reviewer_policy":{"source":"explicit_members","member_ids":["m1"],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"score"},"scorecard":{"criteria":[{"key":"quality","label":"质量","scale_min":1,"scale_max":5,"weight":60}]}}],"final_decision":"manual"}`, allow: true, wantCode: "invalid_score_weights"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, _, err := parseReviewRecipeDefinition(json.RawMessage(test.definition), test.allow)
			if test.wantCode == "" {
				if err != nil {
					t.Fatalf("parse returned error: %v", err)
				}
				return
			}
			validationErr, ok := err.(*reviewRecipeValidationError)
			if !ok || validationErr.Code != test.wantCode {
				t.Fatalf("error = %#v, want code %q", err, test.wantCode)
			}
		})
	}
}

func TestValidateFormDefinitionValue(t *testing.T) {
	valid := formDefinition{
		SchemaVersion: 1,
		Blocks:        json.RawMessage(`[ {"id":"field_block","type":"field","field_key":"name"} ]`),
		Fields:        json.RawMessage(`[ {"id":"name","type":"text","label":"姓名","semantic_key":"PERSON_NAME"} ]`),
		LogicRules:    json.RawMessage(`[]`),
		EndScreen:     json.RawMessage(`{}`),
	}
	if err := validateFormDefinitionValue(valid); err != nil {
		t.Fatalf("valid form rejected: %v", err)
	}
	invalidReference := valid
	invalidReference.Blocks = json.RawMessage(`[{"id":"field_block","type":"field","field_key":"missing"}]`)
	if err := validateFormDefinitionValue(invalidReference); err == nil {
		t.Fatal("missing field reference accepted")
	}
	unknownSemantic := valid
	unknownSemantic.Fields = json.RawMessage(`[{"id":"name","type":"text","label":"姓名","semantic_key":"UNKNOWN"}]`)
	if err := validateFormDefinitionValue(unknownSemantic); err == nil {
		t.Fatal("unknown semantic field accepted")
	}
	cycle := formDefinition{
		SchemaVersion: 1,
		Blocks:        json.RawMessage(`[]`),
		Fields:        json.RawMessage(`[{"id":"a","type":"text"},{"id":"b","type":"text"}]`),
		LogicRules:    json.RawMessage(`[ {"when":{"field_id":"a"},"effect":{"target_field_id":"b"}}, {"when":{"field_id":"b"},"effect":{"target_field_id":"a"}} ]`),
		EndScreen:     json.RawMessage(`{}`),
	}
	if err := validateFormDefinitionValue(cycle); err == nil {
		t.Fatal("nested logic cycle accepted")
	}
	if err := validateMaterializationPlanValue(json.RawMessage(`{"target_kind":"production_program"}`), campaignKindRegistration); err == nil {
		t.Fatal("incompatible materialization target accepted")
	}
	if err := validateMaterializationPlanValue(json.RawMessage(`{"targets":["requirement","resource_commitment"]}`), campaignKindCollection); err != nil {
		t.Fatalf("explicit requirement targets rejected: %v", err)
	}
}

func TestReviewRecipeLibraryAndCampaignPublish(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "review-recipe-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspace := createWorkspaceFor(t, app, token, "审核方案工作空间")
	workspaceID := workspace["id"].(string)
	production := createProductionFor(t, app, token, workspaceID, "审核方案活动", "", "")
	productionID := production["id"].(string)

	global := authedRequest(t, app, token, http.MethodGet, "/v1/review-recipes?status=published", nil)
	if global.Code != http.StatusOK {
		t.Fatalf("list system recipes = %d: %s", global.Code, global.Body.String())
	}
	var globalBody struct {
		Items []reviewRecipeTemplateItem `json:"items"`
		Total int64                      `json:"total"`
	}
	if err := json.Unmarshal(global.Body.Bytes(), &globalBody); err != nil {
		t.Fatal(err)
	}
	if len(globalBody.Items) != 1 || globalBody.Total != 1 || globalBody.Items[0].PublishedVersionID == nil || *globalBody.Items[0].PublishedVersionID != defaultReviewRecipeVersionID {
		t.Fatalf("selectable system recipes = %#v, want only single-round v2", globalBody.Items)
	}
	versions := authedRequest(t, app, token, http.MethodGet, "/v1/review-recipes/review_recipe_single_manual/versions", nil)
	if versions.Code != http.StatusOK || !strings.Contains(versions.Body.String(), defaultReviewRecipeVersionID) {
		t.Fatalf("list recipe versions = %d: %s", versions.Code, versions.Body.String())
	}

	created := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/campaigns", map[string]any{
		"name": "单轮审核报名", "kind": campaignKindCollection,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create blank campaign = %d: %s", created.Code, created.Body.String())
	}
	var createdBody map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &createdBody); err != nil {
		t.Fatal(err)
	}
	draft := createdBody["draft_revision"].(map[string]any)
	if draft["review_recipe_version_id"] != defaultReviewRecipeVersionID {
		t.Fatalf("draft recipe source = %#v", draft["review_recipe_version_id"])
	}
	campaignID := createdBody["campaign"].(map[string]any)["id"].(string)
	revisionPath := "/v1/campaigns/" + campaignID + "/revisions/" + draft["id"].(string)
	unassigned := authedRequestWithHeaders(t, app, token, http.MethodPost, revisionPath+"/publish", map[string]any{}, map[string]string{"If-Match": draft["etag"].(string)})
	if unassigned.Code != http.StatusUnprocessableEntity || !strings.Contains(unassigned.Body.String(), "reviewer_required") {
		t.Fatalf("unassigned publish = %d: %s", unassigned.Code, unassigned.Body.String())
	}
	assignedWorkflow := defaultSingleRoundReviewRecipe()
	var workflow map[string]any
	if err := json.Unmarshal(assignedWorkflow, &workflow); err != nil {
		t.Fatal(err)
	}
	workflow["rounds"].([]any)[0].(map[string]any)["reviewer_policy"].(map[string]any)["member_ids"] = []string{uid}
	updated := authedRequestWithHeaders(t, app, token, http.MethodPatch, revisionPath, map[string]any{"review_workflow": workflow}, map[string]string{"If-Match": draft["etag"].(string)})
	if updated.Code != http.StatusOK {
		t.Fatalf("assign reviewer = %d: %s", updated.Code, updated.Body.String())
	}
	var updatedBody map[string]any
	_ = json.Unmarshal(updated.Body.Bytes(), &updatedBody)
	published := authedRequestWithHeaders(t, app, token, http.MethodPost, revisionPath+"/publish", map[string]any{}, map[string]string{"If-Match": updatedBody["etag"].(string)})
	if published.Code != http.StatusOK {
		t.Fatalf("publish assigned campaign = %d: %s", published.Code, published.Body.String())
	}
	inheritedRevision := authedRequest(t, app, token, http.MethodPost, "/v1/campaigns/"+campaignID+"/revisions", map[string]any{})
	if inheritedRevision.Code != http.StatusCreated || !strings.Contains(inheritedRevision.Body.String(), defaultReviewRecipeVersionID) {
		t.Fatalf("inherit published recipe = %d: %s", inheritedRevision.Code, inheritedRevision.Body.String())
	}

	inlineReview := map[string]any{
		"schema_version": 1,
		"mode":           "MANUAL_DECISION",
		"rounds": []any{map[string]any{
			"key": "screening", "name": "资格筛选", "execution": "parallel",
			"reviewer_policy": map[string]any{"source": "production_roles", "role_keys": []string{"producer"}},
			"completion":      map[string]any{"mode": "all"},
			"feedback":        map[string]any{"kind": "binary"},
		}},
		"request_changes": map[string]any{"enabled": false, "target": "same_round"},
		"final_decision":  "manual",
	}
	inlineCampaign := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/campaigns", map[string]any{
		"name": "自定义审核报名", "kind": campaignKindCollection, "review_workflow": inlineReview,
	})
	if inlineCampaign.Code != http.StatusCreated {
		t.Fatalf("create inline review campaign = %d: %s", inlineCampaign.Code, inlineCampaign.Body.String())
	}
	var inlineBody map[string]any
	_ = json.Unmarshal(inlineCampaign.Body.Bytes(), &inlineBody)
	inlineCampaignID := inlineBody["campaign"].(map[string]any)["id"].(string)
	inlineRevisionID := inlineBody["draft_revision"].(map[string]any)["id"].(string)
	inlinePublished := authedRequestWithHeaders(t, app, token, http.MethodPost, "/v1/campaigns/"+inlineCampaignID+"/revisions/"+inlineRevisionID+"/publish", map[string]any{}, map[string]string{"If-Match": inlineBody["draft_revision"].(map[string]any)["etag"].(string)})
	if inlinePublished.Code != http.StatusOK {
		t.Fatalf("publish inline review campaign = %d: %s", inlinePublished.Code, inlinePublished.Body.String())
	}
	inheritedInline := authedRequest(t, app, token, http.MethodPost, "/v1/campaigns/"+inlineCampaignID+"/revisions", map[string]any{})
	if inheritedInline.Code != http.StatusCreated || !strings.Contains(inheritedInline.Body.String(), "screening") {
		t.Fatalf("inherit inline review snapshot = %d: %s", inheritedInline.Code, inheritedInline.Body.String())
	}

	explicitReview := map[string]any{
		"schema_version": 1,
		"mode":           "MANUAL_DECISION",
		"rounds": []any{map[string]any{
			"key": "screening", "name": "资格筛选", "execution": "parallel",
			"reviewer_policy": map[string]any{"source": "explicit_members", "member_ids": []string{uid}},
			"completion":      map[string]any{"mode": "all"},
			"feedback":        map[string]any{"kind": "binary"},
		}},
		"request_changes": map[string]any{"enabled": false, "target": "same_round"},
		"final_decision":  "manual",
	}
	explicitCampaign := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/campaigns", map[string]any{
		"name": "指定成员审核报名", "kind": campaignKindCollection, "review_workflow": explicitReview,
	})
	if explicitCampaign.Code != http.StatusCreated {
		t.Fatalf("create explicit reviewer campaign = %d: %s", explicitCampaign.Code, explicitCampaign.Body.String())
	}
	var explicitBody map[string]any
	_ = json.Unmarshal(explicitCampaign.Body.Bytes(), &explicitBody)
	explicitPublished := authedRequestWithHeaders(t, app, token, http.MethodPost, "/v1/campaigns/"+explicitBody["campaign"].(map[string]any)["id"].(string)+"/revisions/"+explicitBody["draft_revision"].(map[string]any)["id"].(string)+"/publish", map[string]any{}, map[string]string{"If-Match": explicitBody["draft_revision"].(map[string]any)["etag"].(string)})
	if explicitPublished.Code != http.StatusOK {
		t.Fatalf("publish explicit reviewer campaign = %d: %s", explicitPublished.Code, explicitPublished.Body.String())
	}
}

func TestReviewRecipeVersionTenantBoundary(t *testing.T) {
	app := newIntegrationApp(t)
	ownerA := createTestUser(t, app, "review-recipe-a-"+newID()+"@example.test")
	ownerB := createTestUser(t, app, "review-recipe-b-"+newID()+"@example.test")
	tokenA, tokenB := issueTestToken(t, app, ownerA), issueTestToken(t, app, ownerB)
	workspaceA := createWorkspaceFor(t, app, tokenA, "审核方案租户 A")
	workspaceB := createWorkspaceFor(t, app, tokenB, "审核方案租户 B")
	productionB := createProductionFor(t, app, tokenB, workspaceB["id"].(string), "审核方案活动 B", "", "")
	templateID, versionID := newID(), newID()
	definition := `{"schema_version":1,"mode":"AUTO_ACCEPT","rounds":[],"request_changes":{"enabled":false,"target":"same_round"},"final_decision":"auto_accept"}`
	if _, err := app.db.Exec(t.Context(), `INSERT INTO review_recipe_templates(id,workspace_id,scope,key,name,status,latest_version,created_by) VALUES($1,$2,'workspace','tenant_recipe','租户方案','published',1,$3)`, templateID, workspaceA["id"], ownerA); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO review_recipe_versions(id,template_id,workspace_id,version,schema_version,definition,created_by,published_at) VALUES($1,$2,$3,1,1,$4::jsonb,$5,NOW())`, versionID, templateID, workspaceA["id"], definition, ownerA); err != nil {
		t.Fatal(err)
	}
	foreign := authedRequest(t, app, tokenB, http.MethodPost, "/v1/productions/"+productionB["id"].(string)+"/campaigns", map[string]any{
		"name": "跨租户方案", "kind": campaignKindCollection, "review_recipe_version_id": versionID,
	})
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("cross tenant recipe reference = %d: %s", foreign.Code, foreign.Body.String())
	}
}

func TestPublishedReviewRecipeVersionIsImmutable(t *testing.T) {
	app := newIntegrationApp(t)
	if _, err := app.db.Exec(t.Context(), `UPDATE review_recipe_versions SET definition=definition WHERE id='review_recipe_auto_accept_v1'`); err == nil {
		t.Fatal("published recipe version update should be rejected")
	}
	if _, err := app.db.Exec(t.Context(), `DELETE FROM review_recipe_templates WHERE id='review_recipe_auto_accept'`); err == nil {
		t.Fatal("system recipe template delete should be rejected")
	}
}
