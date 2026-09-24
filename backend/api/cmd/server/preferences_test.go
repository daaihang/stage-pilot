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

	response := authedRequest(t, app, token, http.MethodPatch, "/me/preferences", map[string]string{"detail_open_mode": "exclusive"})
	if response.Code != http.StatusOK {
		t.Fatalf("patch exclusive status = %d body = %s", response.Code, response.Body.String())
	}
	if got := get()["detail_open_mode"]; got != "exclusive" {
		t.Fatalf("saved detail_open_mode = %v, want exclusive", got)
	}

	response = authedRequest(t, app, token, http.MethodPatch, "/me/preferences", map[string]string{})
	if response.Code != http.StatusOK {
		t.Fatalf("patch omitted status = %d body = %s", response.Code, response.Body.String())
	}
	if got := get()["detail_open_mode"]; got != "exclusive" {
		t.Fatalf("omitted detail_open_mode changed to %v", got)
	}

	response = authedRequest(t, app, token, http.MethodPatch, "/me/preferences", map[string]string{"detail_open_mode": "invalid"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid detail_open_mode status = %d body = %s", response.Code, response.Body.String())
	}

	response = authedRequest(t, app, token, http.MethodPatch, "/me/preferences", map[string]string{"detail_open_mode": "overlay"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("legacy overlay detail_open_mode status = %d body = %s", response.Code, response.Body.String())
	}
}

func TestCloudPreferencesRoundTrip(t *testing.T) {
	app := newIntegrationApp(t)
	uid := createTestUser(t, app, "cloud-preferences-"+newID()+"@example.test")
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

	defaults := get()
	for key, want := range map[string]any{
		"theme": "light", "content_width": "standard", "show_titlebar_title": true,
		"sidebar_rail_enabled": true, "category_tabs_pinned": false,
		"floating_action_expand_at_end": true, "notifications_enabled": true,
	} {
		if got := defaults[key]; got != want {
			t.Fatalf("default %s = %v, want %v", key, got, want)
		}
	}

	patch := map[string]any{
		"theme": "dark", "content_width": "wide", "show_titlebar_title": false,
		"sidebar_rail_enabled": false, "category_tabs_pinned": true,
		"floating_action_expand_at_end": false, "notifications_enabled": false,
	}
	response := authedRequest(t, app, token, http.MethodPatch, "/me/preferences", patch)
	if response.Code != http.StatusOK {
		t.Fatalf("patch cloud preferences status = %d body = %s", response.Code, response.Body.String())
	}
	saved := get()
	for key, want := range patch {
		if got := saved[key]; got != want {
			t.Errorf("saved %s = %v, want %v", key, got, want)
		}
	}

	response = authedRequest(t, app, token, http.MethodPatch, "/me/preferences", map[string]string{"content_width": "ultra"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid content_width status = %d body = %s", response.Code, response.Body.String())
	}
}
