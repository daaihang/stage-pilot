package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorkspaceReviewCatalogAuthorizationAndUpdates(t *testing.T) {
	app := newIntegrationApp(t)
	ownerID := createTestUser(t, app, "review-catalog-owner-"+newID()+"@example.test")
	memberID := createTestUser(t, app, "review-catalog-member-"+newID()+"@example.test")
	ownerToken, memberToken := issueTestToken(t, app, ownerID), issueTestToken(t, app, memberID)
	workspace := createWorkspaceFor(t, app, ownerToken, "审核目录工作空间")
	workspaceID := workspace["id"].(string)
	if _, err := app.db.Exec(t.Context(), `INSERT INTO workspace_memberships(id,workspace_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`, newID(), workspaceID, memberID); err != nil {
		t.Fatal(err)
	}

	path := "/v1/workspaces/" + workspaceID + "/review-catalog"
	for _, token := range []string{ownerToken, memberToken} {
		response := authedRequest(t, app, token, http.MethodGet, path, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("read catalog = %d: %s", response.Code, response.Body.String())
		}
		var catalog workspaceReviewCatalogResponse
		if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil {
			t.Fatal(err)
		}
		if catalog.DefaultKey != defaultWorkspaceReviewRecipeKey || len(catalog.EnabledKeys) != 1 || len(catalog.Items) != 1 || len(catalog.AvailableItems) != 1 {
			t.Fatalf("unexpected effective workspace catalog: %#v", catalog)
		}
		item := catalog.Items[0]
		if item.Key != defaultWorkspaceReviewRecipeKey || item.PublishedVersionID != defaultReviewRecipeVersionID || item.Scope != "system" {
			t.Fatalf("unexpected default catalog item: %#v", item)
		}
	}

	settingsPath := "/v1/workspaces/" + workspaceID + "/settings"
	settings := authedRequest(t, app, ownerToken, http.MethodGet, settingsPath, nil)
	if settings.Code != http.StatusOK || !strings.Contains(settings.Body.String(), `"enabled_review_recipe_keys":["single_manual"]`) || !strings.Contains(settings.Body.String(), `"default_review_recipe_key":"single_manual"`) {
		t.Fatalf("workspace review settings were not initialized: %d %s", settings.Code, settings.Body.String())
	}
	for _, body := range []map[string]any{
		{"enabled_review_recipe_keys": []string{}, "default_review_recipe_key": defaultWorkspaceReviewRecipeKey},
		{"enabled_review_recipe_keys": []string{"AUTO_ACCEPT"}, "default_review_recipe_key": "AUTO_ACCEPT"},
		{"enabled_review_recipe_keys": []string{defaultWorkspaceReviewRecipeKey}, "default_review_recipe_key": "not-enabled"},
	} {
		response := authedRequest(t, app, ownerToken, http.MethodPatch, settingsPath, body)
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("invalid catalog update = %d: %s", response.Code, response.Body.String())
		}
	}
	validOwnerUpdate := authedRequest(t, app, ownerToken, http.MethodPatch, settingsPath, map[string]any{
		"enabled_review_recipe_keys": []string{defaultWorkspaceReviewRecipeKey},
		"default_review_recipe_key":  defaultWorkspaceReviewRecipeKey,
	})
	if validOwnerUpdate.Code != http.StatusOK {
		t.Fatalf("owner update = %d: %s", validOwnerUpdate.Code, validOwnerUpdate.Body.String())
	}

	denied := authedRequest(t, app, memberToken, http.MethodPatch, settingsPath, map[string]any{
		"enabled_review_recipe_keys": []string{defaultWorkspaceReviewRecipeKey},
		"default_review_recipe_key":  defaultWorkspaceReviewRecipeKey,
	})
	if denied.Code != http.StatusForbidden {
		t.Fatalf("member update = %d: %s", denied.Code, denied.Body.String())
	}

	unchanged := authedRequest(t, app, ownerToken, http.MethodGet, path, nil)
	if unchanged.Code != http.StatusOK || !strings.Contains(unchanged.Body.String(), `"default_key":"single_manual"`) {
		t.Fatalf("failed updates partially changed catalog: %d %s", unchanged.Code, unchanged.Body.String())
	}

	// Recipe definitions remain readable, but the workspace recipe library and
	// all recipe write routes have been retired in favor of the catalog policy.
	retired := []struct{ method, path string }{
		{http.MethodGet, "/v1/workspaces/" + workspaceID + "/review-recipes"},
		{http.MethodPost, "/v1/workspaces/" + workspaceID + "/review-recipes"},
		{http.MethodPatch, "/v1/review-recipes/review_recipe_single_manual"},
		{http.MethodPost, "/v1/review-recipes/review_recipe_single_manual/versions"},
		{http.MethodPatch, "/v1/review-recipes/review_recipe_single_manual/versions/review_recipe_single_manual_v2"},
		{http.MethodPost, "/v1/review-recipes/review_recipe_single_manual/versions/review_recipe_single_manual_v2/publish"},
	}
	for _, route := range retired {
		response := authedRequest(t, app, ownerToken, route.method, route.path, map[string]any{})
		if response.Code == http.StatusOK || response.Code == http.StatusCreated {
			t.Errorf("retired route %s %s unexpectedly succeeded: %s", route.method, route.path, response.Body.String())
		}
	}
}

func TestCampaignPublicationUsesWorkspaceRecipeKeyAndAcceptsOlderSameKeyVersion(t *testing.T) {
	app := newIntegrationApp(t)
	ownerID := createTestUser(t, app, "review-catalog-publish-"+newID()+"@example.test")
	token := issueTestToken(t, app, ownerID)
	workspace := createWorkspaceFor(t, app, token, "审核目录发布校验")
	workspaceID := workspace["id"].(string)
	key := "manual_test_" + newID()
	templateID, oldVersionID, currentVersionID := newID(), newID(), newID()
	tx, err := app.db.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO review_recipe_templates(id,scope,key,name,status,latest_version,published_version) VALUES($1,'system',$2,'测试单轮方案','published',2,2)`, templateID, key); err != nil {
		_ = tx.Rollback(t.Context())
		t.Fatal(err)
	}
	for index, versionID := range []string{oldVersionID, currentVersionID} {
		if _, err := tx.Exec(t.Context(), `INSERT INTO review_recipe_versions(id,template_id,version,schema_version,definition,published_at) VALUES($1,$2,$3,1,$4,NOW())`, versionID, templateID, index+1, defaultSingleRoundReviewRecipe()); err != nil {
			_ = tx.Rollback(t.Context())
			t.Fatal(err)
		}
	}
	if err := tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}

	settingsPath := "/v1/workspaces/" + workspaceID + "/settings"
	updatedSettings := authedRequest(t, app, token, http.MethodPatch, settingsPath, map[string]any{
		"enabled_review_recipe_keys": []string{key}, "default_review_recipe_key": key,
	})
	if updatedSettings.Code != http.StatusOK {
		t.Fatalf("enable fixture recipe = %d: %s", updatedSettings.Code, updatedSettings.Body.String())
	}
	production := createProductionFor(t, app, token, workspaceID, "审核目录发布活动", "", "")
	productionID := production["id"].(string)
	workflow := func() map[string]any {
		var definition map[string]any
		if err := json.Unmarshal(defaultSingleRoundReviewRecipe(), &definition); err != nil {
			t.Fatal(err)
		}
		definition["rounds"].([]any)[0].(map[string]any)["reviewer_policy"].(map[string]any)["member_ids"] = []string{ownerID}
		return definition
	}
	createAndPublish := func(name, sourceVersionID string) *httptest.ResponseRecorder {
		t.Helper()
		created := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/campaigns", map[string]any{
			"name": name, "kind": campaignKindCollection,
			"review_recipe_version_id": sourceVersionID, "review_workflow": workflow(),
		})
		if created.Code != http.StatusCreated {
			t.Fatalf("create campaign with source %s = %d: %s", sourceVersionID, created.Code, created.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(created.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		campaignID := body["campaign"].(map[string]any)["id"].(string)
		draft := body["draft_revision"].(map[string]any)
		return authedRequestWithHeaders(t, app, token, http.MethodPost, "/v1/campaigns/"+campaignID+"/revisions/"+draft["id"].(string)+"/publish", map[string]any{}, map[string]string{"If-Match": draft["etag"].(string)})
	}

	disabled := createAndPublish("停用方案不能发布", defaultReviewRecipeVersionID)
	if disabled.Code != http.StatusUnprocessableEntity || !strings.Contains(disabled.Body.String(), "review_recipe_not_allowed") {
		t.Fatalf("publish with disabled recipe key = %d: %s", disabled.Code, disabled.Body.String())
	}
	olderAllowed := createAndPublish("同 key 旧版本仍可发布", oldVersionID)
	if olderAllowed.Code != http.StatusOK {
		t.Fatalf("publish with older enabled-key source version = %d: %s", olderAllowed.Code, olderAllowed.Body.String())
	}

}
