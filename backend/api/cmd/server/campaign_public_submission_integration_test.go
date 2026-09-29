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
