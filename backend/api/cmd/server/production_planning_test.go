package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestProductionPlanningLifecycleAndDefaultOccurrence(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "planning-owner-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspaceID := createWorkspaceFor(t, app, token, "排程工作空间")["id"].(string)
	productionID := createProductionFor(t, app, token, workspaceID, "排程活动", "", "")["id"].(string)

	listed := authedRequest(t, app, token, http.MethodGet, "/v1/productions/"+productionID+"/occurrences", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("list occurrences = %d: %s", listed.Code, listed.Body.String())
	}
	var occurrences []map[string]any
	if err := json.Unmarshal(listed.Body.Bytes(), &occurrences); err != nil {
		t.Fatal(err)
	}
	if len(occurrences) != 1 || occurrences[0]["name"] != "默认场次" {
		t.Fatalf("default occurrences = %#v", occurrences)
	}
	id := occurrences[0]["id"].(string)

	started := authedRequest(t, app, token, http.MethodPatch, "/v1/productions/"+productionID+"/occurrences/"+id, map[string]any{"status": "live"})
	if started.Code != http.StatusOK {
		t.Fatalf("start occurrence = %d: %s", started.Code, started.Body.String())
	}
	var startedBody map[string]any
	_ = json.Unmarshal(started.Body.Bytes(), &startedBody)
	if startedBody["actual_start_at"] == nil {
		t.Fatal("start must set actual_start_at")
	}
	finished := authedRequest(t, app, token, http.MethodPatch, "/v1/productions/"+productionID+"/occurrences/"+id, map[string]any{"status": "completed"})
	if finished.Code != http.StatusOK {
		t.Fatalf("complete occurrence = %d: %s", finished.Code, finished.Body.String())
	}
	var finishedBody map[string]any
	_ = json.Unmarshal(finished.Body.Bytes(), &finishedBody)
	if finishedBody["actual_end_at"] == nil {
		t.Fatal("complete must set actual_end_at")
	}

	rehearsal := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/rehearsals", map[string]any{"name": "技术彩排", "kind": "technical", "occurrence_id": id})
	if rehearsal.Code != http.StatusCreated {
		t.Fatalf("create rehearsal = %d: %s", rehearsal.Code, rehearsal.Body.String())
	}
	var rehearsalBody map[string]any
	_ = json.Unmarshal(rehearsal.Body.Bytes(), &rehearsalBody)
	if rehearsalBody["occurrence_id"] != id {
		t.Fatalf("rehearsal occurrence_id = %v, want %s", rehearsalBody["occurrence_id"], id)
	}
}

func TestProductionPlanningRejectsCrossProductionOccurrence(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "planning-isolation-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspaceID := createWorkspaceFor(t, app, token, "排程隔离工作空间")["id"].(string)
	p1 := createProductionFor(t, app, token, workspaceID, "活动一", "", "")["id"].(string)
	p2 := createProductionFor(t, app, token, workspaceID, "活动二", "", "")["id"].(string)
	other := authedRequest(t, app, token, http.MethodGet, "/v1/productions/"+p2+"/occurrences", nil)
	var rows []map[string]any
	_ = json.Unmarshal(other.Body.Bytes(), &rows)
	if len(rows) != 1 {
		t.Fatalf("default occurrence count = %d", len(rows))
	}
	if response := authedRequest(t, app, token, http.MethodPatch, "/v1/productions/"+p1+"/occurrences/"+rows[0]["id"].(string), map[string]any{"name": "越界"}); response.Code != http.StatusNotFound {
		t.Fatalf("cross production update = %d: %s", response.Code, response.Body.String())
	}
}
