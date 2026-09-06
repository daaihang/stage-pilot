package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestPreferencesDetailOpenMode(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "preferences-"+newID()+"@example.test")
	token := issueTestToken(t, app, uid)

	get := func() map[string]any {
		t.Helper()
		response := authedRequest(t, app, token, http.MethodGet, "/me/preferences", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("get preferences status = %d body = %s", response.Code, response.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode preferences: %v", err)
		}
		return body
	}

	if got := get()["detail_open_mode"]; got != "inline" {
		t.Fatalf("default detail_open_mode = %v, want inline", got)
	}

	response := authedRequest(t, app, token, http.MethodPatch, "/me/preferences", map[string]string{"detail_open_mode": "overlay"})
	if response.Code != http.StatusOK {
		t.Fatalf("patch overlay status = %d body = %s", response.Code, response.Body.String())
	}
	if got := get()["detail_open_mode"]; got != "overlay" {
		t.Fatalf("saved detail_open_mode = %v, want overlay", got)
	}

	response = authedRequest(t, app, token, http.MethodPatch, "/me/preferences", map[string]string{})
	if response.Code != http.StatusOK {
		t.Fatalf("patch omitted status = %d body = %s", response.Code, response.Body.String())
	}
	if got := get()["detail_open_mode"]; got != "overlay" {
		t.Fatalf("omitted detail_open_mode changed to %v", got)
	}

	response = authedRequest(t, app, token, http.MethodPatch, "/me/preferences", map[string]string{"detail_open_mode": "invalid"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid detail_open_mode status = %d body = %s", response.Code, response.Body.String())
	}
}
