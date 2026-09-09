package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPasswordHash(t *testing.T) {
	hash, err := hashPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if hash == "correct horse battery" || !verifyPassword(hash, "correct horse battery") {
		t.Fatal("password hash did not verify")
	}
	if verifyPassword(hash, "wrong password") {
		t.Fatal("wrong password verified")
	}
}

func TestNormalizeEmail(t *testing.T) {
	if got := normalizeEmail("  User@Example.COM "); got != "user@example.com" {
		t.Fatalf("got %q", got)
	}
}

func TestCORSPreflightAllowsDesktopPreview(t *testing.T) {
	handler := corsMiddleware(map[string]struct{}{"http://localhost:1420": {}})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("preflight must not reach the application handler")
	}))
	request := httptest.NewRequest(http.MethodOptions, "/auth/register", nil)
	request.Header.Set("Origin", "http://localhost:1420")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "content-type, idempotency-key, if-match")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:1420" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Fatal("missing allow methods header")
	}
	if got := recorder.Header().Get("Access-Control-Allow-Headers"); got == "" {
		t.Fatal("missing allow headers header")
	} else {
		for _, want := range []string{"Authorization", "Content-Type", "Idempotency-Key", "If-Match"} {
			if !strings.Contains(strings.ToLower(got), strings.ToLower(want)) {
				t.Fatalf("allow headers = %q, missing %q", got, want)
			}
		}
	}
}

func TestCORSRejectsUnknownOrigin(t *testing.T) {
	handler := corsMiddleware(map[string]struct{}{"http://localhost:1420": {}})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	request := httptest.NewRequest(http.MethodOptions, "/auth/register", nil)
	request.Header.Set("Origin", "https://untrusted.example")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("content type = %q, want application/json", got)
	}
}
