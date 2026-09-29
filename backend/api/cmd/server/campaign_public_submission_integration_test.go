package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const integrationManualReviewWorkflow = `{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"review","name":"单轮审核","execution":"parallel","reviewer_policy":{"source":"production_roles","member_ids":[],"role_keys":["producer"]},"completion":{"mode":"all"},"feedback":{"kind":"binary"}}],"request_changes":{"enabled":false,"target":"same_round"},"final_decision":"manual"}`

type publicCampaignFixture struct {
	workspaceID  string
	productionID string
	campaignID   string
	revisionID   string
	shareToken   string
	shortCode    string
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
	shortCode, err := generateInvitationCode()
	if err != nil {
		t.Fatal(err)
	}
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
	if _, err := app.db.Exec(t.Context(), `INSERT INTO campaign_share_links(id,workspace_id,production_id,campaign_id,long_token_hash,short_code_hash,long_token_ciphertext,short_code_ciphertext,created_by) VALUES($1,$2,$3,$4,$5,$6,'test','test',$7)`, newID(), workspaceID, productionID, campaignID, tokenHash(shareToken), tokenHash(shortCode), ownerID); err != nil {
		t.Fatalf("insert public share: %v", err)
	}
	return publicCampaignFixture{workspaceID: workspaceID, productionID: productionID, campaignID: campaignID, revisionID: revisionID, shareToken: shareToken, shortCode: shortCode, ownerToken: ownerToken, ownerID: ownerID}
}

func publicSubmitRequest(t *testing.T, app *application, token, revisionID, email, idempotencyKey, remoteIP string) *httptest.ResponseRecorder {
	return publicSubmitRequestAt(t, app, token, false, revisionID, email, idempotencyKey, remoteIP)
}

func publicSubmitShortRequest(t *testing.T, app *application, code, revisionID, email, idempotencyKey, remoteIP string) *httptest.ResponseRecorder {
	return publicSubmitRequestAt(t, app, code, true, revisionID, email, idempotencyKey, remoteIP)
}

func publicSubmitRequestAt(t *testing.T, app *application, token string, short bool, revisionID, email, idempotencyKey, remoteIP string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"expected_revision_id": revisionID,
		"answers":              map[string]any{"email": email},
	})
	if err != nil {
		t.Fatal(err)
	}
	path := "/v1/public/campaign-shares/" + token + "/entries"
	if short {
		path = "/v1/public/campaign-shares/short/" + token + "/entries"
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
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

func setPublicCampaignProcessingMode(t *testing.T, app *application, fixture publicCampaignFixture, mode string) {
	t.Helper()
	if _, err := app.db.Exec(t.Context(), `UPDATE campaign_revisions SET processing_mode=$1 WHERE id=$2 AND workspace_id=$3`, mode, fixture.revisionID, fixture.workspaceID); err != nil {
		t.Fatalf("set public processing mode: %v", err)
	}
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
	fixture := createPublicCampaignFixture(t, app, `{"submission_limit":2,"per_actor_limit":1,"waitlist_enabled":true}`, integrationManualReviewWorkflow)
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

	latestRevisionID := publishNextPublicRevision(t, app, fixture, `{"submission_limit":2,"per_actor_limit":1,"waitlist_enabled":true}`, integrationManualReviewWorkflow)
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
	var replayRunCount, replayTaskCount int
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int,(SELECT COUNT(*)::int FROM entry_review_tasks t JOIN entries e ON e.workspace_id=t.workspace_id AND e.id=t.entry_id WHERE e.campaign_id=$1) FROM entry_review_runs r JOIN entries e ON e.workspace_id=r.workspace_id AND e.id=r.entry_id WHERE e.campaign_id=$1`, fixture.campaignID).Scan(&replayRunCount, &replayTaskCount); err != nil {
		t.Fatal(err)
	}
	if replayRunCount != 1 || replayTaskCount != 1 {
		t.Fatalf("idempotent replay duplicated review work: runs=%d tasks=%d", replayRunCount, replayTaskCount)
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

func TestCollectOnlySubmissionSkipsReviewAndDecisionPaths(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"submission_limit":3,"capacity":1,"waitlist_enabled":false}`, `{"mode":"AUTO_ACCEPT"}`)
	if _, err := app.db.Exec(t.Context(), `UPDATE campaign_revisions SET processing_mode='COLLECT_ONLY' WHERE id=$1 AND workspace_id=$2`, fixture.revisionID, fixture.workspaceID); err != nil {
		t.Fatal(err)
	}
	// A full acceptance capacity must not stop a collection-only form from
	// receiving submissions.
	if _, err := app.db.Exec(t.Context(), `INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status,contact_email,submitted_at,last_activity_at) VALUES($1,$2,$3,$4,$5,'accepted','already-accepted@example.test',NOW(),NOW())`, newID(), fixture.workspaceID, fixture.productionID, fixture.campaignID, fixture.revisionID); err != nil {
		t.Fatal(err)
	}
	publicGet := httptest.NewRecorder()
	app.routes().ServeHTTP(publicGet, httptest.NewRequest(http.MethodGet, "/v1/public/campaign-shares/"+fixture.shareToken, nil))
	if publicGet.Code != http.StatusOK || !bytes.Contains(publicGet.Body.Bytes(), []byte(`"accepting":true`)) {
		t.Fatalf("collect-only GET should accept at full decision capacity: %d %s", publicGet.Code, publicGet.Body.String())
	}

	key := "collect-only-submit"
	created := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "collect@example.test", key, "198.51.100.40")
	if created.Code != http.StatusCreated || !bytes.Contains(created.Body.Bytes(), []byte(`"status":"submitted"`)) {
		t.Fatalf("collect-only submission = %d: %s", created.Code, created.Body.String())
	}
	replayed := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "collect@example.test", key, "198.51.100.41")
	if replayed.Code != http.StatusCreated || replayed.Header().Get("Idempotent-Replayed") != "true" {
		t.Fatalf("collect-only idempotency replay = %d, replay=%q: %s", replayed.Code, replayed.Header().Get("Idempotent-Replayed"), replayed.Body.String())
	}
	var entryID string
	if err := app.db.QueryRow(t.Context(), `SELECT entry_id FROM campaign_public_submission_idempotency WHERE campaign_id=$1 AND entry_id IS NOT NULL ORDER BY completed_at DESC LIMIT 1`, fixture.campaignID).Scan(&entryID); err != nil {
		t.Fatal(err)
	}
	var status, mode string
	var runs, decisions, materializations int
	if err := app.db.QueryRow(t.Context(), `SELECT e.status,cr.processing_mode,(SELECT COUNT(*)::int FROM entry_review_runs r WHERE r.workspace_id=e.workspace_id AND r.entry_id=e.id),(SELECT COUNT(*)::int FROM decisions d WHERE d.workspace_id=e.workspace_id AND d.entry_id=e.id),(SELECT COUNT(*)::int FROM entry_materializations m WHERE m.workspace_id=e.workspace_id AND m.entry_id=e.id) FROM entries e JOIN campaign_revisions cr ON cr.workspace_id=e.workspace_id AND cr.id=e.campaign_revision_id WHERE e.id=$1`, entryID).Scan(&status, &mode, &runs, &decisions, &materializations); err != nil {
		t.Fatal(err)
	}
	if status != "submitted" || mode != intakeCollectOnly || runs != 0 || decisions != 0 || materializations != 0 {
		t.Fatalf("unexpected collect-only Entry runtime: status=%s mode=%s runs=%d decisions=%d materializations=%d", status, mode, runs, decisions, materializations)
	}

	detail := authedRequest(t, app, fixture.ownerToken, http.MethodGet, "/v1/entries/"+entryID, nil)
	var detailBody struct {
		Entry struct {
			ProcessingMode string `json:"processing_mode"`
		} `json:"entry"`
		CanDecide       bool `json:"can_decide"`
		CanManageReview bool `json:"can_manage_review"`
	}
	if detail.Code != http.StatusOK || json.Unmarshal(detail.Body.Bytes(), &detailBody) != nil || detailBody.Entry.ProcessingMode != intakeCollectOnly || detailBody.CanDecide || detailBody.CanManageReview {
		t.Fatalf("collect-only Entry detail = %d: %s", detail.Code, detail.Body.String())
	}
	listing := authedRequest(t, app, fixture.ownerToken, http.MethodGet, "/v1/campaigns/"+fixture.campaignID+"/entries", nil)
	var listBody struct {
		Items []struct {
			ProcessingMode string `json:"processing_mode"`
		} `json:"items"`
	}
	if listing.Code != http.StatusOK || json.Unmarshal(listing.Body.Bytes(), &listBody) != nil {
		t.Fatalf("collect-only Entry list = %d: %s", listing.Code, listing.Body.String())
	}
	foundCollection := false
	for _, item := range listBody.Items {
		if item.ProcessingMode == intakeCollectOnly {
			foundCollection = true
		}
	}
	if !foundCollection {
		t.Fatalf("Entry list did not expose its pinned processing mode: %s", listing.Body.String())
	}

	for _, body := range []map[string]any{
		{"type": "accept", "reason": "legacy attempt"},
		{"type": "accept", "reason": "legacy attempt", "legacy_override": true},
	} {
		response := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", body)
		if response.Code != http.StatusConflict || publicResponseErrorCode(t, response) != "decision_not_applicable" {
			t.Fatalf("collect-only decision = %d: %s", response.Code, response.Body.String())
		}
	}
	assignment := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/review-tasks", map[string]any{"reviewer_id": fixture.ownerID, "reason": "不应适用于仅收集"})
	if assignment.Code != http.StatusConflict || publicResponseErrorCode(t, assignment) != "review_not_applicable" {
		t.Fatalf("collect-only review assignment = %d: %s", assignment.Code, assignment.Body.String())
	}

	// A later publication cannot change the processing semantics pinned to this
	// Entry. The old successful public request still replays before revision
	// conflict handling, as it did before collection-only was added.
	publishNextPublicRevision(t, app, fixture, `{}`, integrationManualReviewWorkflow)
	entryDetailAfterPublish := authedRequest(t, app, fixture.ownerToken, http.MethodGet, "/v1/entries/"+entryID, nil)
	if !bytes.Contains(entryDetailAfterPublish.Body.Bytes(), []byte(`"processing_mode":"COLLECT_ONLY"`)) {
		t.Fatalf("new campaign Revision rewrote the Entry's processing mode: %s", entryDetailAfterPublish.Body.String())
	}
	oldReplay := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "collect@example.test", key, "198.51.100.42")
	if oldReplay.Code != http.StatusCreated || oldReplay.Header().Get("Idempotent-Replayed") != "true" {
		t.Fatalf("old successful collect-only request should replay after publication: %d %s", oldReplay.Code, oldReplay.Body.String())
	}
}

func TestDirectManualDecisionNeedsNoReviewRunAndKeepsDecisionHistory(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"capacity":1,"waitlist_enabled":true,"waitlist_limit":1}`, `{"mode":"AUTO_ACCEPT"}`)
	setPublicCampaignProcessingMode(t, app, fixture, intakeDirectManualDecision)
	capacityEntryID, capacityDecisionID := newID(), newID()
	if _, err := app.db.Exec(t.Context(), `INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status) VALUES($1,$2,$3,$4,$5,'accepted')`, capacityEntryID, fixture.workspaceID, fixture.productionID, fixture.campaignID, fixture.revisionID); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO decisions(id,workspace_id,entry_id,campaign_id,type,decided_by) VALUES($1,$2,$3,$4,'accept',$5)`, capacityDecisionID, fixture.workspaceID, capacityEntryID, fixture.campaignID, fixture.ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE entries SET current_decision_id=$1 WHERE id=$2`, capacityDecisionID, capacityEntryID); err != nil {
		t.Fatal(err)
	}

	publicGet := httptest.NewRecorder()
	app.routes().ServeHTTP(publicGet, httptest.NewRequest(http.MethodGet, "/v1/public/campaign-shares/"+fixture.shareToken, nil))
	if publicGet.Code != http.StatusOK || !bytes.Contains(publicGet.Body.Bytes(), []byte(`"accepting":true`)) {
		t.Fatalf("direct manual decision must accept independently of acceptance capacity: %d %s", publicGet.Code, publicGet.Body.String())
	}

	created := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "direct@example.test", "direct-manual-submit", "198.51.100.50")
	if created.Code != http.StatusCreated || !bytes.Contains(created.Body.Bytes(), []byte(`"status":"submitted"`)) {
		t.Fatalf("direct manual submission = %d: %s", created.Code, created.Body.String())
	}
	var entryID string
	if err := app.db.QueryRow(t.Context(), `SELECT entry_id FROM campaign_public_submission_idempotency WHERE campaign_id=$1 AND entry_id IS NOT NULL`, fixture.campaignID).Scan(&entryID); err != nil {
		t.Fatal(err)
	}
	var status string
	var reviewCount, decisionCount int
	if err := app.db.QueryRow(t.Context(), `SELECT e.status,
		(SELECT COUNT(*)::int FROM entry_review_runs r WHERE r.workspace_id=e.workspace_id AND r.entry_id=e.id),
		(SELECT COUNT(*)::int FROM decisions d WHERE d.workspace_id=e.workspace_id AND d.entry_id=e.id)
		FROM entries e WHERE e.id=$1`, entryID).Scan(&status, &reviewCount, &decisionCount); err != nil {
		t.Fatal(err)
	}
	if status != "submitted" || reviewCount != 0 || decisionCount != 0 {
		t.Fatalf("direct manual submission state: status=%s reviews=%d decisions=%d", status, reviewCount, decisionCount)
	}
	detail := authedRequest(t, app, fixture.ownerToken, http.MethodGet, "/v1/entries/"+entryID, nil)
	var detailBody struct {
		CanDecide       bool `json:"can_decide"`
		CanManageReview bool `json:"can_manage_review"`
	}
	if detail.Code != http.StatusOK || json.Unmarshal(detail.Body.Bytes(), &detailBody) != nil || !detailBody.CanDecide || detailBody.CanManageReview {
		t.Fatalf("direct manual Entry permissions = %d: %s", detail.Code, detail.Body.String())
	}
	assignment := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/review-tasks", map[string]any{"reviewer_id": fixture.ownerID, "reason": "不应适用于免评审决定"})
	if assignment.Code != http.StatusConflict || publicResponseErrorCode(t, assignment) != "review_not_applicable" {
		t.Fatalf("direct manual assignment = %d: %s", assignment.Code, assignment.Body.String())
	}
	legacy := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "accept", "legacy_override": true})
	if legacy.Code != http.StatusConflict || publicResponseErrorCode(t, legacy) != "legacy_override_not_applicable" {
		t.Fatalf("direct manual must not use legacy override = %d: %s", legacy.Code, legacy.Body.String())
	}
	fullCapacity := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "accept"})
	if fullCapacity.Code != http.StatusConflict || publicResponseErrorCode(t, fullCapacity) != "campaign_capacity_reached" {
		t.Fatalf("direct manual acceptance at capacity = %d: %s", fullCapacity.Code, fullCapacity.Body.String())
	}
	for _, action := range []map[string]any{
		{"type": "waitlist", "reason": "复核后转为候补"},
		{"type": "reject", "reason": "复核后不符合条件"},
	} {
		response := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", action)
		if response.Code != http.StatusOK {
			t.Fatalf("direct manual decision %v = %d: %s", action, response.Code, response.Body.String())
		}
	}
	var currentID string
	var currentCount, historyCount int
	if err := app.db.QueryRow(t.Context(), `SELECT current_decision_id FROM entries WHERE id=$1`, entryID).Scan(&currentID); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*) FILTER (WHERE is_current)::int,COUNT(*)::int FROM decisions WHERE entry_id=$1`, entryID).Scan(&currentCount, &historyCount); err != nil {
		t.Fatal(err)
	}
	if currentCount != 1 || historyCount != 2 {
		t.Fatalf("direct manual history current=%d total=%d", currentCount, historyCount)
	}
	var latestSupersedes *string
	var latestActorType string
	if err := app.db.QueryRow(t.Context(), `SELECT supersedes_id,actor_type FROM decisions WHERE id=$1`, currentID).Scan(&latestSupersedes, &latestActorType); err != nil {
		t.Fatal(err)
	}
	if latestSupersedes == nil || latestActorType != "user" {
		t.Fatalf("manual decision history did not retain supersede/user attribution: supersedes=%v actor=%s", latestSupersedes, latestActorType)
	}
	secondEntryID := newID()
	thirdEntryID := newID()
	if _, err := app.db.Exec(t.Context(), `INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status) VALUES($1,$2,$3,$4,$5,'submitted')`, secondEntryID, fixture.workspaceID, fixture.productionID, fixture.campaignID, fixture.revisionID); err != nil {
		t.Fatal(err)
	}
	if _, err := app.db.Exec(t.Context(), `INSERT INTO entries(id,workspace_id,production_id,campaign_id,campaign_revision_id,status) VALUES($1,$2,$3,$4,$5,'submitted')`, thirdEntryID, fixture.workspaceID, fixture.productionID, fixture.campaignID, fixture.revisionID); err != nil {
		t.Fatal(err)
	}
	firstWaitlist := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+secondEntryID+"/decisions", map[string]any{"type": "waitlist"})
	if firstWaitlist.Code != http.StatusOK {
		t.Fatalf("first direct manual waitlist = %d: %s", firstWaitlist.Code, firstWaitlist.Body.String())
	}
	waitlistFull := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+thirdEntryID+"/decisions", map[string]any{"type": "waitlist"})
	if waitlistFull.Code != http.StatusConflict || publicResponseErrorCode(t, waitlistFull) != "waitlist_limit_reached" {
		t.Fatalf("direct manual waitlist limit = %d: %s", waitlistFull.Code, waitlistFull.Body.String())
	}
	if _, err := app.db.Exec(t.Context(), `UPDATE campaign_revisions SET availability_policy='{"capacity":1,"waitlist_enabled":false,"waitlist_limit":1}'::jsonb WHERE id=$1`, fixture.revisionID); err != nil {
		t.Fatal(err)
	}
	waitlistDisabled := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+thirdEntryID+"/decisions", map[string]any{"type": "waitlist"})
	if waitlistDisabled.Code != http.StatusConflict || publicResponseErrorCode(t, waitlistDisabled) != "waitlist_disabled" {
		t.Fatalf("direct manual disabled waitlist = %d: %s", waitlistDisabled.Code, waitlistDisabled.Body.String())
	}
	finalDetail := authedRequest(t, app, fixture.ownerToken, http.MethodGet, "/v1/entries/"+entryID, nil)
	if finalDetail.Code != http.StatusOK || !bytes.Contains(finalDetail.Body.Bytes(), []byte(`"decision_history":[`)) || !bytes.Contains(finalDetail.Body.Bytes(), []byte(`"actor_type":"user"`)) {
		t.Fatalf("direct manual decision history response = %d: %s", finalDetail.Code, finalDetail.Body.String())
	}
}

func TestAutoAcceptCreatesAuditedDecisionAndReplaysAcrossCapacityAndRevision(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"capacity":1,"waitlist_enabled":true,"waitlist_limit":1}`, `{"mode":"MANUAL_DECISION"}`)
	setPublicCampaignProcessingMode(t, app, fixture, intakeAutoAccept)

	get := httptest.NewRecorder()
	app.routes().ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/v1/public/campaign-shares/"+fixture.shareToken, nil))
	if get.Code != http.StatusOK || !bytes.Contains(get.Body.Bytes(), []byte(`"accepting":true`)) {
		t.Fatalf("auto-accept GET before capacity = %d: %s", get.Code, get.Body.String())
	}

	key := "auto-accept-submit"
	created := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "automatic@example.test", key, "198.51.100.60")
	if created.Code != http.StatusCreated || !bytes.Contains(created.Body.Bytes(), []byte(`"status":"submitted"`)) {
		t.Fatalf("auto-accept public receipt must remain neutral = %d: %s", created.Code, created.Body.String())
	}
	var entryID string
	if err := app.db.QueryRow(t.Context(), `SELECT entry_id FROM campaign_public_submission_idempotency WHERE campaign_id=$1 AND entry_id IS NOT NULL`, fixture.campaignID).Scan(&entryID); err != nil {
		t.Fatal(err)
	}
	var status, actorType string
	var currentDecisionID, decisionID string
	var decidedBy *string
	var decisionCount, runCount, materializationCount int
	var metadata json.RawMessage
	if err := app.db.QueryRow(t.Context(), `SELECT e.status,e.current_decision_id,d.id,d.actor_type,d.decided_by,d.metadata,
		(SELECT COUNT(*)::int FROM decisions x WHERE x.entry_id=e.id),
		(SELECT COUNT(*)::int FROM entry_review_runs r WHERE r.entry_id=e.id),
		(SELECT COUNT(*)::int FROM entry_materializations m WHERE m.entry_id=e.id)
		FROM entries e JOIN decisions d ON d.workspace_id=e.workspace_id AND d.id=e.current_decision_id
		WHERE e.id=$1`, entryID).Scan(&status, &currentDecisionID, &decisionID, &actorType, &decidedBy, &metadata, &decisionCount, &runCount, &materializationCount); err != nil {
		t.Fatal(err)
	}
	var audit map[string]any
	if err := json.Unmarshal(metadata, &audit); err != nil {
		t.Fatal(err)
	}
	if status != "accepted" || currentDecisionID != decisionID || actorType != "system" || decidedBy != nil || audit["automation"] != "AUTO_ACCEPT" || audit["trigger"] != "public_submission" || audit["campaign_revision_id"] != fixture.revisionID || decisionCount != 1 || runCount != 0 || materializationCount != 0 {
		t.Fatalf("auto-accept state status=%s pointer=%s decision=%s actor=%s by=%v metadata=%v counts=%d/%d/%d", status, currentDecisionID, decisionID, actorType, decidedBy, audit, decisionCount, runCount, materializationCount)
	}

	fullGet := httptest.NewRecorder()
	app.routes().ServeHTTP(fullGet, httptest.NewRequest(http.MethodGet, "/v1/public/campaign-shares/"+fixture.shareToken, nil))
	if fullGet.Code != http.StatusOK || !bytes.Contains(fullGet.Body.Bytes(), []byte(`"accepting":false`)) || !bytes.Contains(fullGet.Body.Bytes(), []byte(`"accepting_reason":"campaign_capacity_reached"`)) {
		t.Fatalf("auto-accept GET at capacity = %d: %s", fullGet.Code, fullGet.Body.String())
	}
	fullPost := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "second@example.test", "auto-accept-at-capacity", "198.51.100.61")
	if fullPost.Code != http.StatusConflict || publicResponseErrorCode(t, fullPost) != "campaign_capacity_reached" {
		t.Fatalf("auto-accept POST at capacity = %d: %s", fullPost.Code, fullPost.Body.String())
	}
	var entryCount, idemCount int
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM entries WHERE campaign_id=$1 AND deleted_at IS NULL`, fixture.campaignID).Scan(&entryCount); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM campaign_public_submission_idempotency WHERE campaign_id=$1`, fixture.campaignID).Scan(&idemCount); err != nil {
		t.Fatal(err)
	}
	if entryCount != 1 || idemCount != 1 {
		t.Fatalf("capacity conflict wrote partial data: entries=%d idempotency=%d", entryCount, idemCount)
	}

	noReason := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "reject"})
	if noReason.Code != http.StatusUnprocessableEntity || publicResponseErrorCode(t, noReason) != "decision_reason_required" {
		t.Fatalf("auto-accept correction without reason = %d: %s", noReason.Code, noReason.Body.String())
	}
	corrected := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "waitlist", "reason": "人工复核后改为候补"})
	if corrected.Code != http.StatusOK || !bytes.Contains(corrected.Body.Bytes(), []byte(`"status":"waitlisted"`)) {
		t.Fatalf("auto-accept manual correction = %d: %s", corrected.Code, corrected.Body.String())
	}
	var correctedBody struct {
		Decision entryDecisionResponse `json:"decision"`
	}
	if err := json.Unmarshal(corrected.Body.Bytes(), &correctedBody); err != nil {
		t.Fatal(err)
	}
	if correctedBody.Decision.ActorType != "user" || correctedBody.Decision.DecidedBy == nil || *correctedBody.Decision.DecidedBy != fixture.ownerID {
		t.Fatalf("manual correction actor not exposed: %#v", correctedBody.Decision)
	}
	var supersedesID, correctedActorType string
	var correctionReason string
	if err := app.db.QueryRow(t.Context(), `SELECT supersedes_id,actor_type,reason FROM decisions WHERE id=$1`, correctedBody.Decision.ID).Scan(&supersedesID, &correctedActorType, &correctionReason); err != nil {
		t.Fatal(err)
	}
	if supersedesID != decisionID || correctedActorType != "user" || correctionReason != "人工复核后改为候补" {
		t.Fatalf("auto decision history not preserved: supersedes=%s actor=%s reason=%s", supersedesID, correctedActorType, correctionReason)
	}

	detail := authedRequest(t, app, fixture.ownerToken, http.MethodGet, "/v1/entries/"+entryID, nil)
	if detail.Code != http.StatusOK || !bytes.Contains(detail.Body.Bytes(), []byte(`"actor_type":"system"`)) || !bytes.Contains(detail.Body.Bytes(), []byte(`"decided_by":null`)) {
		t.Fatalf("system actor should be visible in decision history: %d %s", detail.Code, detail.Body.String())
	}

	// Both actor combinations that would confuse or forge attribution are
	// rejected by the database. The rows are non-current so this specifically
	// exercises the actor consistency constraint, not the current-decision index.
	tx, err := app.db.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	expectMigrationConstraintError(t, tx, `INSERT INTO decisions(id,workspace_id,entry_id,campaign_id,type,actor_type,decided_by,is_current) VALUES($1,$2,$3,$4,'accept','system',$5,false)`, newID(), fixture.workspaceID, entryID, fixture.campaignID, fixture.ownerID)
	expectMigrationConstraintError(t, tx, `INSERT INTO decisions(id,workspace_id,entry_id,campaign_id,type,actor_type,decided_by,is_current) VALUES($1,$2,$3,$4,'accept','user',NULL,false)`, newID(), fixture.workspaceID, entryID, fixture.campaignID)
	if err := tx.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentAutoAcceptAcrossLongAndShortLinksUsesSingleCapacitySlot(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"capacity":1}`, `{}`)
	setPublicCampaignProcessingMode(t, app, fixture, intakeAutoAccept)

	type submitResult struct {
		code     int
		key      string
		short    bool
		response *httptest.ResponseRecorder
	}
	start := make(chan struct{})
	results := make(chan submitResult, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		<-start
		response := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "long@example.test", "auto-long-link", "198.51.100.70")
		results <- submitResult{code: response.Code, key: "auto-long-link", response: response}
	}()
	go func() {
		defer wait.Done()
		<-start
		response := publicSubmitShortRequest(t, app, fixture.shortCode, fixture.revisionID, "short@example.test", "auto-short-link", "198.51.100.71")
		results <- submitResult{code: response.Code, key: "auto-short-link", short: true, response: response}
	}()
	close(start)
	wait.Wait()
	close(results)
	succeeded, capacityRejected := 0, 0
	var success submitResult
	for result := range results {
		switch result.code {
		case http.StatusCreated:
			succeeded++
			success = result
		case http.StatusConflict:
			capacityRejected++
			if publicResponseErrorCode(t, result.response) != "campaign_capacity_reached" {
				t.Errorf("concurrent loser did not receive capacity conflict: %s", result.response.Body.String())
			}
		default:
			t.Errorf("unexpected concurrent submission response: %d %s", result.code, result.response.Body.String())
		}
	}
	if succeeded != 1 || capacityRejected != 1 {
		t.Fatalf("long/short auto-accept race succeeded=%d rejected=%d", succeeded, capacityRejected)
	}
	var acceptedEntries, currentSystemDecisions, idempotencyRecords int
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM entries WHERE campaign_id=$1 AND status IN ('accepted','converted') AND deleted_at IS NULL`, fixture.campaignID).Scan(&acceptedEntries); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM decisions d JOIN entries e ON e.workspace_id=d.workspace_id AND e.id=d.entry_id WHERE e.campaign_id=$1 AND d.actor_type='system' AND d.is_current`, fixture.campaignID).Scan(&currentSystemDecisions); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM campaign_public_submission_idempotency WHERE campaign_id=$1`, fixture.campaignID).Scan(&idempotencyRecords); err != nil {
		t.Fatal(err)
	}
	if acceptedEntries != 1 || currentSystemDecisions != 1 || idempotencyRecords != 1 {
		t.Fatalf("capacity race persisted entries=%d system decisions=%d idempotency=%d", acceptedEntries, currentSystemDecisions, idempotencyRecords)
	}

	// A successful idempotent replay remains valid even after the slot is full
	// and a newer Revision has been published.
	var replay *httptest.ResponseRecorder
	if success.short {
		replay = publicSubmitShortRequest(t, app, fixture.shortCode, fixture.revisionID, "short@example.test", success.key, "198.51.100.72")
	} else {
		replay = publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "long@example.test", success.key, "198.51.100.72")
	}
	var originalBody, replayedBody any
	if err := json.Unmarshal(success.response.Body.Bytes(), &originalBody); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(replay.Body.Bytes(), &replayedBody); err != nil {
		t.Fatal(err)
	}
	if replay.Code != http.StatusCreated || replay.Header().Get("Idempotent-Replayed") != "true" || !jsonEqual(replayedBody, originalBody) {
		t.Fatalf("replay at capacity did not reproduce the original response: %d %s", replay.Code, replay.Body.String())
	}
	newRevisionID := publishNextPublicRevision(t, app, fixture, `{"capacity":1}`, `{}`)
	if _, err := app.db.Exec(t.Context(), `UPDATE campaign_revisions SET processing_mode='AUTO_ACCEPT' WHERE id=$1`, newRevisionID); err != nil {
		t.Fatal(err)
	}
	if success.short {
		replay = publicSubmitShortRequest(t, app, fixture.shortCode, fixture.revisionID, "short@example.test", success.key, "198.51.100.73")
	} else {
		replay = publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "long@example.test", success.key, "198.51.100.73")
	}
	if replay.Code != http.StatusCreated || replay.Header().Get("Idempotent-Replayed") != "true" {
		t.Fatalf("successful request should replay before revision conflict: %d %s", replay.Code, replay.Body.String())
	}
	if success.short {
		replay = publicSubmitShortRequest(t, app, fixture.shortCode, fixture.revisionID, "new@example.test", "stale-auto-revision", "198.51.100.74")
	} else {
		replay = publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "new@example.test", "stale-auto-revision", "198.51.100.74")
	}
	if replay.Code != http.StatusConflict || publicResponseErrorCode(t, replay) != "form_version_changed" {
		t.Fatalf("stale auto-accept revision = %d: %s", replay.Code, replay.Body.String())
	}
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM campaign_public_submission_idempotency WHERE campaign_id=$1`, fixture.campaignID).Scan(&idempotencyRecords); err != nil {
		t.Fatal(err)
	}
	if idempotencyRecords != 1 {
		t.Fatalf("capacity/version conflicts must not persist idempotency rows: %d", idempotencyRecords)
	}
}

func TestPublicCampaignSubmissionLimitSerializesConcurrentRequests(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{"submission_limit":2}`, integrationManualReviewWorkflow)
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
	fixture := createPublicCampaignFixture(t, app, `{"per_actor_limit":1}`, integrationManualReviewWorkflow)
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

func TestSingleRoundReviewFeedbackQuorumAndDecision(t *testing.T) {
	app := newIntegrationApp(t)
	workflow := `{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"review","name":"单轮审核","execution":"parallel","reviewer_policy":{"source":"production_roles","member_ids":[],"role_keys":["producer","viewer","contributor"]},"completion":{"mode":"at_least_n","n":1},"feedback":{"kind":"binary"}}],"request_changes":{"enabled":false,"target":"same_round"},"final_decision":"manual"}`
	fixture := createPublicCampaignFixture(t, app, `{"waitlist_enabled":true}`, workflow)
	viewerID := createTestUser(t, app, "review-viewer-"+newID()+"@example.test")
	contributorID := createTestUser(t, app, "review-contributor-"+newID()+"@example.test")
	for _, member := range []struct{ id, role string }{{viewerID, "viewer"}, {contributorID, "contributor"}} {
		if _, err := app.db.Exec(t.Context(), `INSERT INTO production_memberships(id,production_id,user_id,role_key,status,invited_by) VALUES($1,$2,$3,$4,'active',$5)`, newID(), fixture.productionID, member.id, member.role, fixture.ownerID); err != nil {
			t.Fatal(err)
		}
	}
	viewerToken := issueTestToken(t, app, viewerID)
	contributorToken := issueTestToken(t, app, contributorID)
	submitted := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "review@example.test", "review-entry", "198.51.100.1")
	if submitted.Code != http.StatusCreated {
		t.Fatalf("submit review entry = %d: %s", submitted.Code, submitted.Body.String())
	}
	var entryID string
	if err := app.db.QueryRow(t.Context(), `SELECT id FROM entries WHERE campaign_id=$1 AND contact_email='review@example.test'`, fixture.campaignID).Scan(&entryID); err != nil {
		t.Fatal(err)
	}
	var runID, entryRevisionID, runStatus string
	if err := app.db.QueryRow(t.Context(), `SELECT id,entry_revision_id,status FROM entry_review_runs WHERE entry_id=$1`, entryID).Scan(&runID, &entryRevisionID, &runStatus); err != nil {
		t.Fatal(err)
	}
	if runStatus != "collecting_feedback" {
		t.Fatalf("review run status = %q", runStatus)
	}
	var ownerTaskID, viewerTaskID, contributorTaskID string
	if err := app.db.QueryRow(t.Context(), `SELECT t.id FROM entry_review_tasks t JOIN entry_review_task_assignments a ON a.task_id=t.id WHERE t.run_id=$1 AND a.reviewer_id=$2 AND a.ended_at IS NULL`, runID, fixture.ownerID).Scan(&ownerTaskID); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT t.id FROM entry_review_tasks t JOIN entry_review_task_assignments a ON a.task_id=t.id WHERE t.run_id=$1 AND a.reviewer_id=$2 AND a.ended_at IS NULL`, runID, viewerID).Scan(&viewerTaskID); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT t.id FROM entry_review_tasks t JOIN entry_review_task_assignments a ON a.task_id=t.id WHERE t.run_id=$1 AND a.reviewer_id=$2 AND a.ended_at IS NULL`, runID, contributorID).Scan(&contributorTaskID); err != nil {
		t.Fatal(err)
	}
	myTasks := authedRequest(t, app, fixture.ownerToken, http.MethodGet, "/v1/me/review-tasks?status=pending", nil)
	if myTasks.Code != http.StatusOK || !bytes.Contains(myTasks.Body.Bytes(), []byte(ownerTaskID)) {
		t.Fatalf("owner review task list = %d: %s", myTasks.Code, myTasks.Body.String())
	}
	if forbidden := authedRequest(t, app, fixture.ownerToken, http.MethodGet, "/v1/review-tasks/"+viewerTaskID, nil); forbidden.Code != http.StatusNotFound {
		t.Fatalf("non-assignee task read = %d: %s", forbidden.Code, forbidden.Body.String())
	}
	if forbidden := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/review-tasks/"+viewerTaskID+"/feedback", map[string]any{"recommendation": "recommend", "comment": "未分配成员的反馈"}); forbidden.Code != http.StatusNotFound {
		t.Fatalf("non-assignee feedback submit = %d: %s", forbidden.Code, forbidden.Body.String())
	}
	viewerTask := authedRequest(t, app, viewerToken, http.MethodGet, "/v1/review-tasks/"+viewerTaskID, nil)
	if viewerTask.Code != http.StatusOK || !bytes.Contains(viewerTask.Body.Bytes(), []byte(entryRevisionID)) || !bytes.Contains(viewerTask.Body.Bytes(), []byte(fixture.revisionID)) {
		t.Fatalf("assigned reviewer task must expose fixed versions = %d: %s", viewerTask.Code, viewerTask.Body.String())
	}
	if denied := authedRequest(t, app, viewerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "accept"}); denied.Code != http.StatusForbidden {
		t.Fatalf("review-only member decision = %d: %s", denied.Code, denied.Body.String())
	}
	if invalid := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/review-tasks/"+ownerTaskID+"/feedback", map[string]any{"recommendation": "recommend", "comment": "  "}); invalid.Code != http.StatusUnprocessableEntity {
		t.Fatalf("empty review feedback = %d: %s", invalid.Code, invalid.Body.String())
	}
	feedback := func(token, taskID, recommendation, comment, supersedes string) *httptest.ResponseRecorder {
		payload := map[string]any{"recommendation": recommendation, "comment": comment}
		if supersedes != "" {
			payload["supersedes_feedback_id"] = supersedes
		}
		return authedRequest(t, app, token, http.MethodPost, "/v1/review-tasks/"+taskID+"/feedback", payload)
	}
	firstFeedback := feedback(fixture.ownerToken, ownerTaskID, "recommend", "材料符合要求。", "")
	if firstFeedback.Code != http.StatusOK {
		t.Fatalf("submit feedback = %d: %s", firstFeedback.Code, firstFeedback.Body.String())
	}
	var firstBody map[string]any
	if err := json.Unmarshal(firstFeedback.Body.Bytes(), &firstBody); err != nil {
		t.Fatal(err)
	}
	firstFeedbackID := firstBody["id"].(string)
	var progress, required int
	if err := app.db.QueryRow(t.Context(), `SELECT (SELECT COUNT(*)::int FROM entry_review_tasks t JOIN entry_review_feedback f ON f.task_id=t.id AND f.is_current WHERE t.run_id=r.id),required_count FROM entry_review_runs r WHERE r.id=$1`, runID).Scan(&progress, &required); err != nil {
		t.Fatal(err)
	}
	if progress != 1 || required != 1 {
		t.Fatalf("quorum progress = %d/%d", progress, required)
	}
	var entryStatus string
	var decisionCount int
	if err := app.db.QueryRow(t.Context(), `SELECT status FROM entries WHERE id=$1`, entryID).Scan(&entryStatus); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int FROM decisions WHERE entry_id=$1`, entryID).Scan(&decisionCount); err != nil {
		t.Fatal(err)
	}
	if entryStatus != "in_review" || decisionCount != 0 {
		t.Fatalf("feedback must not decide Entry: status=%q decisions=%d", entryStatus, decisionCount)
	}
	secondFeedback := feedback(fixture.ownerToken, ownerTaskID, "no_opinion", "补充了核验范围。", firstFeedbackID)
	if secondFeedback.Code != http.StatusOK {
		t.Fatalf("revise feedback = %d: %s", secondFeedback.Code, secondFeedback.Body.String())
	}
	lateFeedback := feedback(viewerToken, viewerTaskID, "do_not_recommend", "存在一项待核验信息。", "")
	if lateFeedback.Code != http.StatusOK {
		t.Fatalf("feedback after quorum but before decision = %d: %s", lateFeedback.Code, lateFeedback.Body.String())
	}
	decision := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/decisions", map[string]any{"type": "accept", "reason": "已完成审核"})
	if decision.Code != http.StatusOK {
		t.Fatalf("final decision after quorum = %d: %s", decision.Code, decision.Body.String())
	}
	var finalStatus, finalRunStatus, pendingTaskStatus string
	if err := app.db.QueryRow(t.Context(), `SELECT e.status,r.status FROM entries e JOIN entry_review_runs r ON r.entry_id=e.id WHERE e.id=$1`, entryID).Scan(&finalStatus, &finalRunStatus); err != nil {
		t.Fatal(err)
	}
	if err := app.db.QueryRow(t.Context(), `SELECT status FROM entry_review_tasks WHERE id=$1`, contributorTaskID).Scan(&pendingTaskStatus); err != nil {
		t.Fatal(err)
	}
	if finalStatus != "accepted" || finalRunStatus != "decided" || pendingTaskStatus != "closed_by_decision" {
		t.Fatalf("final state entry=%q run=%q pending task=%q", finalStatus, finalRunStatus, pendingTaskStatus)
	}
	lateAfterDecision := feedback(contributorToken, contributorTaskID, "recommend", "晚到意见", "")
	if lateAfterDecision.Code != http.StatusConflict || publicResponseErrorCode(t, lateAfterDecision) != "review_feedback_closed" {
		t.Fatalf("feedback after final decision = %d: %s", lateAfterDecision.Code, lateAfterDecision.Body.String())
	}
	var feedbackCount, currentCount int
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int,COUNT(*) FILTER (WHERE is_current)::int FROM entry_review_feedback WHERE run_id=$1 AND task_id=$2`, runID, ownerTaskID).Scan(&feedbackCount, &currentCount); err != nil {
		t.Fatal(err)
	}
	if feedbackCount != 2 || currentCount != 1 {
		t.Fatalf("feedback revisions current/history=%d/%d", currentCount, feedbackCount)
	}
}

func TestSingleRoundReviewAssignmentRequiresManagerAndReason(t *testing.T) {
	app := newIntegrationApp(t)
	fixture := createPublicCampaignFixture(t, app, `{}`, integrationManualReviewWorkflow)
	firstReviewer := createTestUser(t, app, "review-assignment-first-"+newID()+"@example.test")
	secondReviewer := createTestUser(t, app, "review-assignment-second-"+newID()+"@example.test")
	managerDenied := createTestUser(t, app, "review-assignment-denied-"+newID()+"@example.test")
	for _, userID := range []string{firstReviewer, secondReviewer, managerDenied} {
		role := "viewer"
		if userID == managerDenied {
			role = "stage_manager"
		}
		if _, err := app.db.Exec(t.Context(), `INSERT INTO production_memberships(id,production_id,user_id,role_key,status,invited_by) VALUES($1,$2,$3,$4,'active',$5)`, newID(), fixture.productionID, userID, role, fixture.ownerID); err != nil {
			t.Fatal(err)
		}
	}
	submitted := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "review-assignment@example.test", "review-assignment-entry", "198.51.100.20")
	if submitted.Code != http.StatusCreated {
		t.Fatalf("submit review entry = %d: %s", submitted.Code, submitted.Body.String())
	}
	var entryID string
	if err := app.db.QueryRow(t.Context(), `SELECT id FROM entries WHERE campaign_id=$1 AND contact_email='review-assignment@example.test'`, fixture.campaignID).Scan(&entryID); err != nil {
		t.Fatal(err)
	}
	withoutReason := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/review-tasks", map[string]any{"reviewer_id": firstReviewer})
	if withoutReason.Code != http.StatusUnprocessableEntity {
		t.Fatalf("assignment without reason = %d: %s", withoutReason.Code, withoutReason.Body.String())
	}
	deniedToken := issueTestToken(t, app, managerDenied)
	withoutPermission := authedRequest(t, app, deniedToken, http.MethodPost, "/v1/entries/"+entryID+"/review-tasks", map[string]any{"reviewer_id": firstReviewer, "reason": "测试改派"})
	if withoutPermission.Code != http.StatusForbidden {
		t.Fatalf("review-only manager assignment = %d: %s", withoutPermission.Code, withoutPermission.Body.String())
	}
	added := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/review-tasks", map[string]any{"reviewer_id": firstReviewer, "reason": "补足全员审核门槛"})
	if added.Code != http.StatusOK {
		t.Fatalf("add review task = %d: %s", added.Code, added.Body.String())
	}
	var runID string
	var required, tasks int
	if err := app.db.QueryRow(t.Context(), `SELECT r.id,r.required_count,(SELECT COUNT(*)::int FROM entry_review_tasks t WHERE t.run_id=r.id) FROM entry_review_runs r WHERE r.entry_id=$1`, entryID).Scan(&runID, &required, &tasks); err != nil {
		t.Fatal(err)
	}
	if required != 2 || tasks != 2 {
		t.Fatalf("all-mode added task must increase threshold: required=%d tasks=%d", required, tasks)
	}
	var addedTaskID string
	if err := app.db.QueryRow(t.Context(), `SELECT t.id FROM entry_review_tasks t JOIN entry_review_task_assignments a ON a.workspace_id=t.workspace_id AND a.task_id=t.id AND a.ended_at IS NULL WHERE t.run_id=$1 AND a.reviewer_id=$2`, runID, firstReviewer).Scan(&addedTaskID); err != nil {
		t.Fatal(err)
	}
	reassigned := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/entries/"+entryID+"/review-tasks", map[string]any{"task_id": addedTaskID, "reviewer_id": secondReviewer, "reason": "原审核人调整为另一项任务"})
	if reassigned.Code != http.StatusOK {
		t.Fatalf("reassign review task = %d: %s", reassigned.Code, reassigned.Body.String())
	}
	var assignmentHistory, currentAssignments int
	if err := app.db.QueryRow(t.Context(), `SELECT COUNT(*)::int,COUNT(*) FILTER (WHERE ended_at IS NULL)::int FROM entry_review_task_assignments WHERE task_id=$1`, addedTaskID).Scan(&assignmentHistory, &currentAssignments); err != nil {
		t.Fatal(err)
	}
	if assignmentHistory != 2 || currentAssignments != 1 {
		t.Fatalf("reassignment history/current=%d/%d, want 2/1", assignmentHistory, currentAssignments)
	}
}

func TestReviewFeedbackAndFinalDecisionSerializeOnRun(t *testing.T) {
	app := newIntegrationApp(t)
	workflow := `{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"review","name":"单轮审核","execution":"parallel","reviewer_policy":{"source":"production_roles","member_ids":[],"role_keys":["producer"]},"completion":{"mode":"at_least_n","n":1},"feedback":{"kind":"binary"}}],"request_changes":{"enabled":false,"target":"same_round"},"final_decision":"manual"}`
	fixture := createPublicCampaignFixture(t, app, `{}`, workflow)
	submitted := publicSubmitRequest(t, app, fixture.shareToken, fixture.revisionID, "review-race@example.test", "review-race-entry", "198.51.100.21")
	if submitted.Code != http.StatusCreated {
		t.Fatalf("submit review entry = %d: %s", submitted.Code, submitted.Body.String())
	}
	var entryID, taskID string
	if err := app.db.QueryRow(t.Context(), `SELECT e.id,t.id FROM entries e JOIN entry_review_runs r ON r.entry_id=e.id JOIN entry_review_tasks t ON t.run_id=r.id JOIN entry_review_task_assignments a ON a.task_id=t.id AND a.ended_at IS NULL WHERE e.campaign_id=$1 AND e.contact_email='review-race@example.test' AND a.reviewer_id=$2`, fixture.campaignID, fixture.ownerID).Scan(&entryID, &taskID); err != nil {
		t.Fatal(err)
	}
	initial := authedRequest(t, app, fixture.ownerToken, http.MethodPost, "/v1/review-tasks/"+taskID+"/feedback", map[string]any{"recommendation": "recommend", "comment": "初始审核意见"})
	if initial.Code != http.StatusOK {
		t.Fatalf("initial feedback = %d: %s", initial.Code, initial.Body.String())
	}
	var initialBody map[string]any
	if err := json.Unmarshal(initial.Body.Bytes(), &initialBody); err != nil {
		t.Fatal(err)
	}
	feedbackID, ok := initialBody["id"].(string)
	if !ok || feedbackID == "" {
		t.Fatalf("missing initial feedback id: %s", initial.Body.String())
	}
	start := make(chan struct{})
	type response struct {
		kind string
		code int
		body string
	}
	feedbackPayload, err := json.Marshal(map[string]any{"recommendation": "no_opinion", "comment": "与决定并发的修订意见", "supersedes_feedback_id": feedbackID})
	if err != nil {
		t.Fatal(err)
	}
	decisionPayload, err := json.Marshal(map[string]any{"type": "accept"})
	if err != nil {
		t.Fatal(err)
	}
	feedbackRequest := httptest.NewRequest(http.MethodPost, "/v1/review-tasks/"+taskID+"/feedback", bytes.NewReader(feedbackPayload))
	feedbackRequest.Header.Set("Authorization", "Bearer "+fixture.ownerToken)
	feedbackRequest.Header.Set("Content-Type", "application/json")
	decisionRequest := httptest.NewRequest(http.MethodPost, "/v1/entries/"+entryID+"/decisions", bytes.NewReader(decisionPayload))
	decisionRequest.Header.Set("Authorization", "Bearer "+fixture.ownerToken)
	decisionRequest.Header.Set("Content-Type", "application/json")
	results := make(chan response, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		<-start
		recorder := httptest.NewRecorder()
		app.routes().ServeHTTP(recorder, feedbackRequest)
		results <- response{kind: "feedback", code: recorder.Code, body: recorder.Body.String()}
	}()
	go func() {
		defer wait.Done()
		<-start
		recorder := httptest.NewRecorder()
		app.routes().ServeHTTP(recorder, decisionRequest)
		results <- response{kind: "decision", code: recorder.Code, body: recorder.Body.String()}
	}()
	close(start)
	wait.Wait()
	close(results)
	var feedbackStatus, decisionStatus int
	for result := range results {
		switch result.kind {
		case "feedback":
			feedbackStatus = result.code
			if result.code != http.StatusOK && (result.code != http.StatusConflict || !strings.Contains(result.body, `"code":"review_feedback_closed"`)) {
				t.Errorf("raced feedback status = %d: %s", result.code, result.body)
			}
		case "decision":
			decisionStatus = result.code
			if result.code != http.StatusOK {
				t.Errorf("raced decision status = %d: %s", result.code, result.body)
			}
		}
	}
	if decisionStatus != http.StatusOK || (feedbackStatus != http.StatusOK && feedbackStatus != http.StatusConflict) {
		t.Fatalf("unexpected serialized race outcomes: feedback=%d decision=%d", feedbackStatus, decisionStatus)
	}
	var runStatus, entryStatus string
	var historyCount, currentCount int
	if err := app.db.QueryRow(t.Context(), `SELECT r.status,e.status,(SELECT COUNT(*)::int FROM entry_review_feedback f WHERE f.run_id=r.id),(SELECT COUNT(*) FILTER (WHERE f.is_current)::int FROM entry_review_feedback f WHERE f.run_id=r.id) FROM entry_review_runs r JOIN entries e ON e.id=r.entry_id WHERE e.id=$1`, entryID).Scan(&runStatus, &entryStatus, &historyCount, &currentCount); err != nil {
		t.Fatal(err)
	}
	wantHistory := 1
	if feedbackStatus == http.StatusOK {
		wantHistory = 2
	}
	if runStatus != "decided" || entryStatus != "accepted" || historyCount != wantHistory || currentCount != 1 {
		t.Fatalf("serialized final state run=%q entry=%q feedback=%d/%d", runStatus, entryStatus, historyCount, currentCount)
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
