package main

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestRebaseScheduledInstantPreservesWallClock(t *testing.T) {
	source, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	value := time.Date(2026, time.September, 18, 10, 30, 0, 0, source)
	result, err := rebaseScheduledInstant(&value, "Asia/Shanghai", "America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	if got := result.UTC().Format(time.RFC3339); got != "2026-09-18T14:30:00Z" {
		t.Fatalf("rebased instant = %s, want 2026-09-18T14:30:00Z", got)
	}
	if local := result.In(source).Format("2006-01-02 15:04"); local != "2026-09-18 22:30" {
		t.Fatalf("source local time after rebase = %s, want 2026-09-18 22:30", local)
	}
	newYork, _ := time.LoadLocation("America/New_York")
	if local := result.In(newYork).Format("2006-01-02 15:04"); local != "2026-09-18 10:30" {
		t.Fatalf("target local time after rebase = %s, want 2026-09-18 10:30", local)
	}
}

func TestRebaseScheduledInstantRejectsDSTGapAndFold(t *testing.T) {
	source, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	gap := time.Date(2026, time.March, 8, 2, 30, 0, 0, source) // 02:30 in New York does not exist.
	if _, err := rebaseScheduledInstant(&gap, "Asia/Shanghai", "America/New_York"); err == nil || err.(*timezoneRebaseError).Code != "timezone_nonexistent_time" {
		t.Fatalf("DST gap error = %v, want timezone_nonexistent_time", err)
	}
	fold := time.Date(2026, time.November, 1, 1, 30, 0, 0, source) // 01:30 in New York occurs twice.
	if _, err := rebaseScheduledInstant(&fold, "Asia/Shanghai", "America/New_York"); err == nil || err.(*timezoneRebaseError).Code != "timezone_ambiguous_time" {
		t.Fatalf("DST fold error = %v, want timezone_ambiguous_time", err)
	}
}

func TestProductionTimezoneChangeStrategies(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "production-timezone-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)
	workspaceID := createWorkspaceFor(t, app, token, "活动时区同步")["id"].(string)
	created := createProductionFor(t, app, token, workspaceID, "墙钟活动", "2026-09-18T02:00:00Z", "2026-09-18T04:00:00Z")
	productionID := created["id"].(string)
	occurrenceResponse := authedRequest(t, app, token, http.MethodPost, "/v1/productions/"+productionID+"/occurrences", map[string]any{
		"name": "计划场次", "scheduled_start_at": "2026-09-18T02:00:00Z", "scheduled_end_at": "2026-09-18T03:00:00Z",
	})
	if occurrenceResponse.Code != http.StatusCreated {
		t.Fatalf("create occurrence = %d: %s", occurrenceResponse.Code, occurrenceResponse.Body.String())
	}
	var occurrence map[string]any
	if err := json.Unmarshal(occurrenceResponse.Body.Bytes(), &occurrence); err != nil {
		t.Fatal(err)
	}
	occurrenceID := occurrence["id"].(string)
	liveResponse := authedRequest(t, app, token, http.MethodPatch, "/v1/productions/"+productionID+"/occurrences/"+occurrenceID, map[string]any{"status": "live"})
	if liveResponse.Code != http.StatusOK {
		t.Fatalf("start occurrence = %d: %s", liveResponse.Code, liveResponse.Body.String())
	}
	var live map[string]any
	if err := json.Unmarshal(liveResponse.Body.Bytes(), &live); err != nil {
		t.Fatal(err)
	}
	actualStart := live["actual_start_at"]

	wallResponse := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/productions/"+productionID, map[string]any{
		"timezone": "America/New_York", "timezone_change_strategy": keepWallTimeStrategy,
	})
	if wallResponse.Code != http.StatusOK {
		t.Fatalf("keep wall time = %d: %s", wallResponse.Code, wallResponse.Body.String())
	}
	var wall map[string]any
	if err := json.Unmarshal(wallResponse.Body.Bytes(), &wall); err != nil {
		t.Fatal(err)
	}
	if wall["timezone"] != "America/New_York" || wall["planned_start_at"] != "2026-09-18T14:00:00Z" || wall["planned_end_at"] != "2026-09-18T16:00:00Z" {
		t.Fatalf("wall-time production = %#v", wall)
	}
	listed := authedRequest(t, app, token, http.MethodGet, "/v1/productions/"+productionID+"/occurrences", nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("list occurrences = %d: %s", listed.Code, listed.Body.String())
	}
	var rows []map[string]any
	if err := json.Unmarshal(listed.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	var changed map[string]any
	for _, row := range rows {
		if row["id"] == occurrenceID {
			changed = row
			break
		}
	}
	if changed == nil || changed["timezone"] != "America/New_York" || changed["scheduled_start_at"] != "2026-09-18T14:00:00Z" || changed["scheduled_end_at"] != "2026-09-18T15:00:00Z" {
		t.Fatalf("wall-time occurrence = %#v", changed)
	}
	if changed["actual_start_at"] != actualStart {
		t.Fatalf("actual_start_at changed from %v to %v", actualStart, changed["actual_start_at"])
	}

	instantResponse := authedRequest(t, app, token, http.MethodPatch, "/v1/workspaces/"+workspaceID+"/productions/"+productionID, map[string]any{
		"timezone": "Asia/Shanghai", "timezone_change_strategy": keepInstantStrategy,
	})
	if instantResponse.Code != http.StatusOK {
		t.Fatalf("keep instant = %d: %s", instantResponse.Code, instantResponse.Body.String())
	}
	var instant map[string]any
	if err := json.Unmarshal(instantResponse.Body.Bytes(), &instant); err != nil {
		t.Fatal(err)
	}
	if instant["timezone"] != "Asia/Shanghai" || instant["planned_start_at"] != "2026-09-18T14:00:00Z" {
		t.Fatalf("instant-time production = %#v", instant)
	}
}
