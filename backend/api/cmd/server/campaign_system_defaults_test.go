package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSystemTemplateSingleRoundPublicWorkflow(t *testing.T) {
	app := newIntegrationApp(t)
	requireCampaignSchemaV1(t, app)
	ownerID := createTestUser(t, app, "system-template-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, ownerID)
	workspace := createWorkspaceFor(t, app, token, "系统模板审核验收")
	production := createProductionFor(t, app, token, workspace["id"].(string), "系统模板活动", "", "")
	productionID := production["id"].(string)

	cases := []struct {
		name, templateID, kind string
		answers                map[string]any
	}{
		{"blank", "", campaignKindCollection, map[string]any{}},
		{"program", "system_program_submission", campaignKindSubmission, map[string]any{"program_title": "开场曲", "program_type": "器乐", "performers": "乐队", "duration_seconds": 180, "demo": "https://example.com/demo"}},
		{"crew", "system_crew_recruitment", campaignKindRecruitment, map[string]any{"display_name": "审核测试", "contact": "test@example.com", "roles": "舞台协助"}},
		{"registration", "system_event_registration", campaignKindRegistration, map[string]any{"display_name": "测试团队", "email": "team@example.com", "participant_count": 2}},
		{"collection", "system_general_collection", campaignKindCollection, map[string]any{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := map[string]any{"name": "审核验收 " + tc.name, "kind": tc.kind}
			if tc.templateID != "" {
				input["template_id"] = tc.templateID
			}
			created := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/campaigns", input)
			if created.Code != http.StatusCreated {
				t.Fatalf("create = %d: %s", created.Code, created.Body.String())
			}
			var body struct {
				Campaign struct {
					ID string `json:"id"`
				} `json:"campaign"`
				Draft struct {
					ID                    string `json:"id"`
					ETag                  string `json:"etag"`
					ReviewRecipeVersionID string `json:"review_recipe_version_id"`
					ReviewRecipeSource    struct {
						VersionID string `json:"version_id"`
						Key       string `json:"key"`
						Version   int    `json:"version"`
						IsCurrent bool   `json:"is_current"`
						Enabled   bool   `json:"enabled"`
					} `json:"review_recipe_source"`
					ReviewWorkflow json.RawMessage `json:"review_workflow"`
					FormVersion    struct {
						Fields json.RawMessage `json:"fields"`
					} `json:"form_version"`
				} `json:"draft_revision"`
			}
			if err := json.Unmarshal(created.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Draft.ReviewRecipeVersionID != defaultReviewRecipeVersionID {
				t.Fatalf("source = %q", body.Draft.ReviewRecipeVersionID)
			}
			if body.Draft.ReviewRecipeSource.VersionID != defaultReviewRecipeVersionID || body.Draft.ReviewRecipeSource.Key != defaultWorkspaceReviewRecipeKey || !body.Draft.ReviewRecipeSource.IsCurrent || !body.Draft.ReviewRecipeSource.Enabled {
				t.Fatalf("source metadata = %+v", body.Draft.ReviewRecipeSource)
			}
			if err := validateSingleRoundReviewWorkflowWithUnbound(body.Draft.ReviewWorkflow); err != nil {
				t.Fatalf("draft workflow = %s: %v", body.Draft.ReviewWorkflow, err)
			}
			if campaignPublishedFormHasFiles(json.RawMessage(`{"fields":` + string(body.Draft.FormVersion.Fields) + `}`)) {
				t.Fatalf("template contains file field: %s", body.Draft.FormVersion.Fields)
			}
			revisionPath := "/v1/campaigns/" + body.Campaign.ID + "/revisions/" + body.Draft.ID
			unassigned := authedRequestWithHeaders(t, app, token, http.MethodPost, revisionPath+"/publish", map[string]any{}, map[string]string{"If-Match": body.Draft.ETag})
			if unassigned.Code != http.StatusUnprocessableEntity || !strings.Contains(unassigned.Body.String(), "reviewer_required") {
				t.Fatalf("unassigned publish = %d: %s", unassigned.Code, unassigned.Body.String())
			}
			var workflow map[string]any
			if err := json.Unmarshal(body.Draft.ReviewWorkflow, &workflow); err != nil {
				t.Fatal(err)
			}
			workflow["rounds"].([]any)[0].(map[string]any)["reviewer_policy"].(map[string]any)["member_ids"] = []string{ownerID}
			updated := authedRequestWithHeaders(t, app, token, http.MethodPatch, revisionPath, map[string]any{"review_workflow": workflow}, map[string]string{"If-Match": body.Draft.ETag})
			if updated.Code != http.StatusOK {
				t.Fatalf("assign = %d: %s", updated.Code, updated.Body.String())
			}
			var saved struct {
				ETag string `json:"etag"`
			}
			if err := json.Unmarshal(updated.Body.Bytes(), &saved); err != nil {
				t.Fatal(err)
			}
			published := authedRequestWithHeaders(t, app, token, http.MethodPost, revisionPath+"/publish", map[string]any{}, map[string]string{"If-Match": saved.ETag})
			if published.Code != http.StatusOK {
				t.Fatalf("publish = %d: %s", published.Code, published.Body.String())
			}
			share := authedRequest(t, app, token, http.MethodPost, "/v1/campaigns/"+body.Campaign.ID+"/share-links", map[string]any{})
			if share.Code != http.StatusCreated {
				t.Fatalf("share = %d: %s", share.Code, share.Body.String())
			}
			var shareBody struct {
				LongURL string `json:"long_url"`
			}
			if err := json.Unmarshal(share.Body.Bytes(), &shareBody); err != nil {
				t.Fatal(err)
			}
			shareToken := shareBody.LongURL[strings.LastIndex(shareBody.LongURL, "/")+1:]
			publicPath := "/v1/public/campaign-shares/" + shareToken
			get := httptest.NewRecorder()
			app.routes().ServeHTTP(get, httptest.NewRequest(http.MethodGet, publicPath, nil))
			if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), `"accepting":true`) {
				t.Fatalf("public get = %d: %s", get.Code, get.Body.String())
			}
			if strings.Contains(get.Body.String(), "review_workflow") {
				t.Fatal("public response leaked review workflow")
			}
			submitBody, _ := json.Marshal(map[string]any{"expected_revision_id": body.Draft.ID, "answers": tc.answers})
			submit := func() *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodPost, publicPath+"/entries", bytes.NewReader(submitBody))
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("Idempotency-Key", "submit-"+tc.name)
				response := httptest.NewRecorder()
				app.routes().ServeHTTP(response, request)
				return response
			}
			first := submit()
			if first.Code != http.StatusCreated {
				t.Fatalf("submit = %d: %s", first.Code, first.Body.String())
			}
			replayed := submit()
			if replayed.Code != http.StatusCreated || replayed.Header().Get("Idempotent-Replayed") != "true" {
				t.Fatalf("replay = %d: %s", replayed.Code, replayed.Body.String())
			}
			var status, pinnedRevision string
			var entries, runs, tasks int
			if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int,MAX(status),MAX(campaign_revision_id) FROM entries WHERE campaign_id=$1`, body.Campaign.ID).Scan(&entries, &status, &pinnedRevision); err != nil {
				t.Fatal(err)
			}
			if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM entry_review_runs WHERE campaign_revision_id=$1`, body.Draft.ID).Scan(&runs); err != nil {
				t.Fatal(err)
			}
			if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM entry_review_tasks task JOIN entry_review_runs run ON run.workspace_id=task.workspace_id AND run.id=task.run_id WHERE run.campaign_revision_id=$1`, body.Draft.ID).Scan(&tasks); err != nil {
				t.Fatal(err)
			}
			if entries != 1 || runs != 1 || tasks != 1 || status != "in_review" || pinnedRevision != body.Draft.ID {
				t.Fatalf("entries=%d runs=%d tasks=%d status=%q revision=%q", entries, runs, tasks, status, pinnedRevision)
			}
		})
	}
}

func validateSingleRoundReviewWorkflowWithUnbound(raw json.RawMessage) error {
	definition, _, err := parseReviewRecipeDefinition(raw, true)
	if err != nil {
		return err
	}
	if definition.Mode != "MANUAL_DECISION" || len(definition.Rounds) != 1 || definition.RequestChanges.Enabled || definition.Rounds[0].Feedback.Kind != "binary" {
		return reviewRecipeError("invalid_seed", "system seed is not a P1 single-round workflow")
	}
	return nil
}

func TestBlankWorkspaceTemplateKeepsCustomizedReviewSnapshot(t *testing.T) {
	app := newIntegrationApp(t)
	requireCampaignSchemaV1(t, app)
	ownerID := createTestUser(t, app, "blank-template-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, ownerID)
	workspace := createWorkspaceFor(t, app, token, "空白表单模板验收")
	workspaceID := workspace["id"].(string)
	production := createProductionFor(t, app, token, workspaceID, "空白模板活动", "", "")
	template := authedRequest(t, app, token, http.MethodPost, "/v1/workspaces/"+workspaceID+"/campaign-templates", map[string]any{"name": "可复用模板", "kind": campaignKindCollection})
	if template.Code != http.StatusCreated {
		t.Fatalf("create template = %d: %s", template.Code, template.Body.String())
	}
	var initial struct {
		Template struct {
			ID string `json:"id"`
		} `json:"template"`
		Draft struct {
			ID                    string `json:"id"`
			ETag                  string `json:"etag"`
			ReviewRecipeVersionID string `json:"review_recipe_version_id"`
			ReviewRecipeSource    struct {
				VersionID string `json:"version_id"`
				Key       string `json:"key"`
				Version   int    `json:"version"`
				Enabled   bool   `json:"enabled"`
			} `json:"review_recipe_source"`
			Definition struct {
				ReviewWorkflow json.RawMessage `json:"review_workflow"`
			} `json:"definition"`
		} `json:"draft_version"`
	}
	if err := json.Unmarshal(template.Body.Bytes(), &initial); err != nil {
		t.Fatal(err)
	}
	if initial.Draft.ReviewRecipeVersionID != defaultReviewRecipeVersionID {
		t.Fatalf("blank template recipe source = %q", initial.Draft.ReviewRecipeVersionID)
	}
	if initial.Draft.ReviewRecipeSource.VersionID != defaultReviewRecipeVersionID || initial.Draft.ReviewRecipeSource.Key != defaultWorkspaceReviewRecipeKey || !initial.Draft.ReviewRecipeSource.Enabled {
		t.Fatalf("template source metadata = %+v", initial.Draft.ReviewRecipeSource)
	}
	if err := validateSingleRoundReviewWorkflowWithUnbound(initial.Draft.Definition.ReviewWorkflow); err != nil {
		t.Fatal(err)
	}
	versionPath := "/v1/campaign-templates/" + initial.Template.ID + "/versions/" + initial.Draft.ID
	validUnbound := authedRequestWithHeaders(t, app, token, http.MethodPost, versionPath+"/validate", map[string]any{}, map[string]string{"If-Match": initial.Draft.ETag})
	if validUnbound.Code != http.StatusOK || !strings.Contains(validUnbound.Body.String(), `"valid":true`) {
		t.Fatalf("unbound template validation = %d: %s", validUnbound.Code, validUnbound.Body.String())
	}
	var templateDefinition map[string]any
	if err := app.db.QueryRow(t.Context(), `SELECT definition FROM campaign_template_versions WHERE id=$1`, initial.Draft.ID).Scan(&templateDefinition); err != nil {
		t.Fatal(err)
	}
	unsupportedWorkflow := map[string]any{"schema_version": 1, "mode": "AUTO_ACCEPT", "rounds": []any{}, "request_changes": map[string]any{"enabled": false}, "final_decision": "auto_accept"}
	templateDefinition["review_workflow"] = unsupportedWorkflow
	unsupportedUpdate := authedRequestWithHeaders(t, app, token, http.MethodPatch, versionPath, map[string]any{"definition": templateDefinition}, map[string]string{"If-Match": initial.Draft.ETag})
	if unsupportedUpdate.Code != http.StatusOK {
		t.Fatalf("save unsupported draft for validation = %d: %s", unsupportedUpdate.Code, unsupportedUpdate.Body.String())
	}
	var unsupportedBody struct {
		Version struct {
			ETag string `json:"etag"`
		} `json:"version"`
	}
	if err := json.Unmarshal(unsupportedUpdate.Body.Bytes(), &unsupportedBody); err != nil {
		t.Fatal(err)
	}
	unsupportedValidation := authedRequestWithHeaders(t, app, token, http.MethodPost, versionPath+"/validate", map[string]any{}, map[string]string{"If-Match": unsupportedBody.Version.ETag})
	if unsupportedValidation.Code != http.StatusOK || !strings.Contains(unsupportedValidation.Body.String(), `"valid":false`) || !strings.Contains(unsupportedValidation.Body.String(), "single_round_manual_required") {
		t.Fatalf("unsupported template validation = %d: %s", unsupportedValidation.Code, unsupportedValidation.Body.String())
	}
	unsupportedPublish := authedRequestWithHeaders(t, app, token, http.MethodPost, versionPath+"/publish", map[string]any{}, map[string]string{"If-Match": unsupportedBody.Version.ETag})
	if unsupportedPublish.Code != http.StatusUnprocessableEntity || !strings.Contains(unsupportedPublish.Body.String(), "single_round_manual_required") {
		t.Fatalf("unsupported template publish = %d: %s", unsupportedPublish.Code, unsupportedPublish.Body.String())
	}
	if err := app.db.QueryRow(t.Context(), `SELECT definition FROM campaign_template_versions WHERE id=$1`, initial.Draft.ID).Scan(&templateDefinition); err != nil {
		t.Fatal(err)
	}
	definition := templateDefinition["review_workflow"].(map[string]any)
	definition["schema_version"] = float64(1)
	definition["mode"] = "MANUAL_DECISION"
	definition["rounds"] = []any{map[string]any{"key": "review", "name": "单轮审核", "execution": "parallel", "reviewer_policy": map[string]any{"source": "production_roles", "member_ids": []any{}, "role_keys": []string{"producer"}}, "completion": map[string]any{"mode": "all"}, "feedback": map[string]any{"kind": "binary"}}}
	definition["request_changes"] = map[string]any{"enabled": false, "target": "same_round"}
	definition["final_decision"] = "manual"
	templateDefinition["review_workflow"] = definition
	updated := authedRequestWithHeaders(t, app, token, http.MethodPatch, versionPath, map[string]any{"definition": templateDefinition}, map[string]string{"If-Match": unsupportedBody.Version.ETag})
	if updated.Code != http.StatusOK {
		t.Fatalf("update template = %d: %s", updated.Code, updated.Body.String())
	}
	var updatedBody struct {
		Version struct {
			ETag string `json:"etag"`
		} `json:"version"`
	}
	if err := json.Unmarshal(updated.Body.Bytes(), &updatedBody); err != nil {
		t.Fatal(err)
	}
	published := authedRequestWithHeaders(t, app, token, http.MethodPost, versionPath+"/publish", map[string]any{}, map[string]string{"If-Match": updatedBody.Version.ETag})
	if published.Code != http.StatusOK {
		t.Fatalf("publish template = %d: %s", published.Code, published.Body.String())
	}
	newDraft := authedRequest(t, app, token, http.MethodPost, "/v1/campaign-templates/"+initial.Template.ID+"/versions", map[string]any{})
	if newDraft.Code != http.StatusCreated {
		t.Fatalf("create newer template draft = %d: %s", newDraft.Code, newDraft.Body.String())
	}
	override := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+production["id"].(string)+"/campaigns", map[string]any{
		"name": "拒绝覆盖模板快照", "template_id": initial.Template.ID,
		"review_recipe_version_id": defaultReviewRecipeVersionID,
		"review_workflow":          definition,
	})
	if override.Code != http.StatusUnprocessableEntity || !strings.Contains(override.Body.String(), "template_review_snapshot_override") {
		t.Fatalf("template snapshot override = %d: %s", override.Code, override.Body.String())
	}
	nullOverride := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+production["id"].(string)+"/campaigns", map[string]any{
		"name": "拒绝空覆盖模板快照", "template_id": initial.Template.ID, "review_workflow": nil,
	})
	if nullOverride.Code != http.StatusUnprocessableEntity || !strings.Contains(nullOverride.Body.String(), "template_review_snapshot_override") {
		t.Fatalf("null template snapshot override = %d: %s", nullOverride.Code, nullOverride.Body.String())
	}
	created := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+production["id"].(string)+"/campaigns", map[string]any{"name": "从模板创建", "template_id": initial.Template.ID, "template_version": 1})
	if created.Code != http.StatusCreated {
		t.Fatalf("create campaign from template = %d: %s", created.Code, created.Body.String())
	}
	var campaign struct {
		Campaign struct {
			SourceTemplateVersion int `json:"source_template_version"`
		} `json:"campaign"`
		Draft struct {
			ReviewRecipeVersionID string `json:"review_recipe_version_id"`
			ReviewWorkflow        struct {
				Rounds []struct {
					ReviewerPolicy struct {
						RoleKeys []string `json:"role_keys"`
					} `json:"reviewer_policy"`
				} `json:"rounds"`
			} `json:"review_workflow"`
		} `json:"draft_revision"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &campaign); err != nil {
		t.Fatal(err)
	}
	if campaign.Campaign.SourceTemplateVersion != 1 || campaign.Draft.ReviewRecipeVersionID != defaultReviewRecipeVersionID || len(campaign.Draft.ReviewWorkflow.Rounds) != 1 || len(campaign.Draft.ReviewWorkflow.Rounds[0].ReviewerPolicy.RoleKeys) != 1 || campaign.Draft.ReviewWorkflow.Rounds[0].ReviewerPolicy.RoleKeys[0] != "producer" {
		t.Fatalf("template snapshot overwritten by source: %s", created.Body.String())
	}
}
