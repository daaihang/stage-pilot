package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

type publicCampaignFixture struct {
	workspaceID  string
	productionID string
	campaignID   string
	revisionID   string
	shareToken   string
	ownerToken   string
	ownerID      string
}

func createPublicCampaignFixture(t *testing.T, app *application, availability, workflow string) publicCampaignFixture {
	t.Helper()
	requireCampaignSchemaV1(t, app)
	ownerID := createTestUser(t, app, "public-intake-"+newID()+"@example.test")
	ownerToken := issueTestToken(t, app, ownerID)
	workspace := createWorkspaceFor(t, app, ownerToken, "公开收件测试")
	workspaceID := workspace["id"].(string)
	production := createProductionFor(t, app, ownerToken, workspaceID, "公开收件活动", "", "")
	productionID := production["id"].(string)
	campaignID, revisionID, formVersionID := newID(), newID(), newID()
	shareToken := newID()
	fields := `[ {"id":"email","type":"email","label":"联系邮箱","required":true,"semantic_key":"CONTACT_EMAIL"} ]`
	blocks := `[{"id":"email_block","type":"field","field_key":"email"}]`
	if _, err := app.db.Exec(t.Context(), `INSERT INTO form_versions(id,workspace_id,fields,blocks,created_by) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)`, formVersionID, workspaceID, fields, blocks, ownerID); err != nil {
		t.Fatalf("insert public form: %v", err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO campaigns(id,workspace_id,production_id,kind,name,status,created_by) VALUES($1,$2,$3,'COLLECTION','公开收件测试','published',$4)`, campaignID, workspaceID, productionID, ownerID); err != nil {
		t.Fatalf("insert public campaign: %v", err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO campaign_revisions(id,workspace_id,campaign_id,revision_no,status,form_version_id,availability_policy,review_workflow,created_by) VALUES($1,$2,$3,1,'published',$4,$5::jsonb,$6::jsonb,$7)`, revisionID, workspaceID, campaignID, formVersionID, availability, workflow, ownerID); err != nil {
		t.Fatalf("insert public revision: %v", err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE campaigns SET published_revision_id=$1 WHERE id=$2 AND workspace_id=$3`, revisionID, campaignID, workspaceID); err != nil {
		t.Fatalf("publish public revision: %v", err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO campaign_share_links(id,workspace_id,production_id,campaign_id,long_token_hash,short_code_hash,long_token_ciphertext,short_code_ciphertext,created_by) VALUES($1,$2,$3,$4,$5,$6,'test','test',$7)`, newID(), workspaceID, productionID, campaignID, tokenHash(shareToken), tokenHash("short-"+shareToken), ownerID); err != nil {
		t.Fatalf("insert public share: %v", err)
	}
	return publicCampaignFixture{workspaceID: workspaceID, productionID: productionID, campaignID: campaignID, revisionID: revisionID, shareToken: shareToken, ownerToken: ownerToken, ownerID: ownerID}
}

func publicSubmitRequest(t *testing.T, app *application, token, revisionID, email, idempotencyKey, remoteIP string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"expected_revision_id": revisionID,
		"answers":              map[string]any{"email": email},
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/public/campaign-shares/"+token+"/entries", bytes.NewReader(body))
	req.RemoteAddr = remoteIP + ":43120"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", idempotencyKey)
	rec := httptest.NewRecorder()
	app.routes().ServeHTTP(rec, req)
	return rec
}

func publishNextPublicRevision(t *testing.T, app *application, fixture publicCampaignFixture, availability, workflow string) string {
	t.Helper()
	formVersionID, revisionID := newID(), newID()
	fields := `[{"id":"email","type":"email","label":"联系邮箱","required":true,"semantic_key":"CONTACT_EMAIL"}]`
	blocks := `[{"id":"email_block","type":"field","field_key":"email"}]`
	if _, err := app.db.Exec(t.Context(), `INSERT INTO form_versions(id,workspace_id,fields,blocks,created_by) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)`, formVersionID, fixture.workspaceID, fields, blocks, fixture.ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE campaign_revisions SET status='superseded' WHERE workspace_id=$1 AND campaign_id=$2 AND status='published'`, fixture.workspaceID, fixture.campaignID); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO campaign_revisions(id,workspace_id,campaign_id,revision_no,status,form_version_id,availability_policy,review_workflow,created_by) VALUES($1,$2,$3,2,'published',$4,$5::jsonb,$6::jsonb,$7)`, revisionID, fixture.workspaceID, fixture.campaignID, formVersionID, availability, workflow, fixture.ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE campaigns SET published_revision_id=$1 WHERE id=$2 AND workspace_id=$3`, revisionID, fixture.campaignID, fixture.workspaceID); err != nil {
		t.Fatal(err)
	}
	return revisionID
}

func publicResponseErrorCode(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode public error response: %v (%s)", err, response.Body.String())
	}
	return body.Error.Code
}

func TestPublicCampaignRevisionConflictAndReplay(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"submission_limit":2,"per_actor_limit":1,"waitlist_enabled":true}`, `{"mode":"MANUAL_DECISION"}`)
	missing := httptest.NewRequest(http.MethodPost, "/v1/public/campaign-shares/"+fixture.shareToken+"/entries", bytes.NewBufferString(`{"answers":{}}`))
	missing.Header.Set("Idempotency-Key", "missing-revision")
	missingResponse := httptest.NewRecorder()
	app.routes().ServeHTTP(missingResponse, missing)
	if missingResponse.Code != http.StatusBadRequest || publicResponseErrorCode(t, missingResponse) != "expected_revision_required" {
		t.Fatalf("missing revision = %d: %s", missingResponse.Code, missingResponse.Body.String())
	}

	first := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, " Person@Example.com ", "retry-after-publish", "192.0.2.1")
	if first.Code != http.StatusCreated {
		t.Fatalf("first submit = %d: %s", first.Code, first.Body.String())
	}
	reusedAnswers := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "different@example.com", "retry-after-publish", "192.0.2.7")
	if reusedAnswers.Code != http.StatusConflict || publicResponseErrorCode(t, reusedAnswers) != "idempotency_key_reused" {
		t.Fatalf("same idempotency key with different answers = %d: %s", reusedAnswers.Code, reusedAnswers.Body.String())
	}
	actorLimit := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "person@example.com", "actor-limit", "192.0.2.2")
	if actorLimit.Code != http.StatusConflict || publicResponseErrorCode(t, actorLimit) != "per_actor_limit_reached" {
		t.Fatalf("per-actor limit = %d: %s", actorLimit.Code, actorLimit.Body.String())
	}

	get := httptest.NewRequest(http.MethodGet, "/v1/public/campaign-shares/"+fixture.shareToken, nil)
	getResponse := httptest.NewRecorder()
	app.routes().ServeHTTP(getResponse, get)
	var publicBody map[string]any
	if err := json.Unmarshal(getResponse.Body.Bytes(), &publicBody); err != nil {
		t.Fatal(err)
	}
	if _, leaked := publicBody["review_workflow"]; leaked {
		t.Fatalf("public payload leaked review workflow: %s", getResponse.Body.String())
	}

	latestRevisionID := publishNextPublicRevision(t, app, fixture, `{"submission_limit":2,"per_actor_limit":1,"waitlist_enabled":true}`, `{"mode":"MANUAL_DECISION"}`)
	replayed := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, " Person@Example.com ", "retry-after-publish", "192.0.2.3")
	var originalBody, replayedBody any
	if err := json.Unmarshal(first.Body.Bytes(), &originalBody); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(replayed.Body.Bytes(), &replayedBody); err != nil {
		t.Fatal(err)
	}
	if replayed.Code != http.StatusCreated || replayed.Header().Get("Idempotent-Replayed") != "true" || !jsonEqual(replayedBody, originalBody) {
		t.Fatalf("same old-revision request should replay after publish: %d replay=%q body=%s", replayed.Code, replayed.Header().Get("Idempotent-Replayed"), replayed.Body.String())
	}
	stale := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "other@example.com", "stale-version", "192.0.2.4")
	if stale.Code != http.StatusConflict || publicResponseErrorCode(t, stale) != "form_version_changed" || !bytes.Contains(stale.Body.Bytes(), []byte(latestRevisionID)) {
		t.Fatalf("stale revision = %d: %s", stale.Code, stale.Body.String())
	}
	reused := publicSubmitRequest(t, app, fixture.shareToken, latestRevisionID, " Person@Example.com ", "retry-after-publish", "192.0.2.5")
	if reused.Code != http.StatusConflict || publicResponseErrorCode(t, reused) != "idempotency_key_reused" {
		t.Fatalf("same key with different revision should conflict: %d: %s", reused.Code, reused.Body.String())
	}
	second := publicSubmitRequest(t, app, fixture.shareToken, latestRevisionID, "other@example.com", "second-entry", "192.0.2.6")
	if second.Code != http.StatusCreated {
		t.Fatalf("submit latest revision = %d: %s", second.Code, second.Body.String())
	}
	closed := httptest.NewRecorder()
	app.routes().ServeHTTP(closed, httptest.NewRequest(http.MethodGet, "/v1/public/campaign-shares/"+fixture.shareToken, nil))
	if !bytes.Contains(closed.Body.Bytes(), []byte(`"accepting":false`)) || !bytes.Contains(closed.Body.Bytes(), []byte(`"accepting_reason":"submission_limit_reached"`)) {
		t.Fatalf("public GET should mirror submission cap: %s", closed.Body.String())
	}
	var entryCount, idemCount int
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM entries WHERE campaign_id=$1`, fixture.campaignID).Scan(&entryCount); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM campaign_public_submission_idempotency WHERE campaign_id=$1`, fixture.campaignID).Scan(&idemCount); err != nil {
		t.Fatal(err)
	}
	if entryCount != 2 || idemCount != 2 {
		t.Fatalf("stale/limited requests wrote rows: entries=%d idempotency=%d", entryCount, idemCount)
	}
}

func TestPublicCampaignSubmissionLimitSerializesConcurrentRequests(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"submission_limit":2}`, `{"mode":"MANUAL_DECISION"}`)
	const requests = 8
	start := make(chan struct{})
	statuses := make(chan int, requests)
	var wait sync.WaitGroup
	for i := 0; i < requests; i++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			response := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, fmt.Sprintf("person-%d@example.com", index), fmt.Sprintf("concurrent-%d", index), fmt.Sprintf("192.0.2.%d", index+20))
			statuses <- response.Code
		}(i)
	}
	close(start)
	wait.Wait()
	close(statuses)
	succeeded, rejected := 0, 0
	for status := range statuses {
		switch status {
		case http.StatusCreated:
			succeeded++
		case http.StatusConflict:
			rejected++
		default:
			t.Errorf("unexpected concurrent submit status: %d", status)
		}
	}
	if succeeded != 2 || rejected != requests-2 {
		t.Fatalf("submission cap race: succeeded=%d rejected=%d", succeeded, rejected)
	}
}

func TestPublicCampaignPerActorLimitSerializesConcurrentRequests(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"per_actor_limit":1}`, `{"mode":"MANUAL_DECISION"}`)
	const requests = 6
	start := make(chan struct{})
	statuses := make(chan int, requests)
	var wait sync.WaitGroup
	for i := 0; i < requests; i++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			response := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, " Person@Example.com ", fmt.Sprintf("same-actor-%d", index), fmt.Sprintf("192.0.2.%d", index+50))
			statuses <- response.Code
		}(i)
	}
	close(start)
	wait.Wait()
	close(statuses)
	succeeded, rejected := 0, 0
	for status := range statuses {
		if status == http.StatusCreated {
			succeeded++
		} else if status == http.StatusConflict {
			rejected++
		} else {
			t.Errorf("unexpected per-actor submit status: %d", status)
		}
	}
	var count int
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM entries WHERE campaign_id=$1 AND contact_email='person@example.com'`, fixture.campaignID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if succeeded != 1 || rejected != requests-1 || count != 1 {
		t.Fatalf("per-actor limit race: succeeded=%d rejected=%d matching entries=%d", succeeded, rejected, count)
	}
}

func TestPublicUnsupportedPublishedPoliciesFailClosed(t *testing.T) {
	tests := []struct {
		name         string
		availability string
		workflow     string
		code         string
	}{
		{name: "legacy close behavior", availability: `{"close_behavior":"accept_to_waitlist"}`, workflow: `{"mode":"MANUAL_DECISION"}`, code: "close_behavior_unsupported"},
		{name: "automatic acceptance", availability: `{}`, workflow: `{"mode":"AUTO_ACCEPT"}`, code: "auto_accept_unavailable"},
		{name: "missing required email", availability: `{"per_actor_limit":1}`, workflow: `{"mode":"MANUAL_DECISION"}`, code: "contact_email_required_for_actor_limit"},
	}
	for index, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			app := newIntegrationApp(t)
			fixture := createPublicCampaignFixture(t, app, testCase.availability, testCase.workflow)
			if testCase.name == "missing required email" {
				if _, err := app.db.Exec(t.Context(), `UPDATE form_versions SET fields='[]'::jsonb WHERE id=(SELECT form_version_id FROM campaign_revisions WHERE id=$1)`, fixture.revisionID); err != nil {
					t.Fatal(err)
				}
			}
			get := httptest.NewRequest(http.MethodGet, "/v1/public/campaign-shares/"+fixture.shareToken, nil)
			getRecorder := httptest.NewRecorder()
			app.routes().ServeHTTP(getRecorder, get)
			if getRecorder.Code != http.StatusOK || !bytes.Contains(getRecorder.Body.Bytes(), []byte(`"accepting":false`)) || !bytes.Contains(getRecorder.Body.Bytes(), []byte(testCase.code)) {
				t.Fatalf("unsupported policy GET = %d: %s", getRecorder.Code, getRecorder.Body.String())
			}
			if testCase.name == "legacy close behavior" {
				var publicPayload map[string]any
				if err := json.Unmarshal(getRecorder.Body.Bytes(), &publicPayload); err != nil {
					t.Fatal(err)
				}
				availability, _ := publicPayload["availability"].(map[string]any)
				if _, leaked := availability["close_behavior"]; leaked {
					t.Fatalf("public payload exposed retired close_behavior: %s", getRecorder.Body.String())
				}
			}
			post := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "person@example.com", fmt.Sprintf("unsupported-%d", index), fmt.Sprintf("192.0.2.%d", index+70))
			if post.Code != http.StatusConflict || publicResponseErrorCode(t, post) != testCase.code {
				t.Fatalf("unsupported policy POST = %d: %s", post.Code, post.Body.String())
			}
			var entries, idempotencyRecords int
			if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM entries WHERE campaign_id=$1`, fixture.campaignID).Scan(&entries); err != nil {
				t.Fatal(err)
			}
			if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM campaign_public_submission_idempotency WHERE campaign_id=$1`, fixture.campaignID).Scan(&idempotencyRecords); err != nil {
				t.Fatal(err)
			}
			if entries != 0 || idempotencyRecords != 0 {
				t.Fatalf("closed policy wrote data: entries=%d idempotency=%d", entries, idempotencyRecords)
			}
		})
	}
}
