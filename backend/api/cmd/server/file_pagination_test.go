package main

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestFilePageParametersDefaultsAndBounds(t *testing.T) {
	for _, test := range []struct {
		query string
		want  int
		bad   bool
	}{
		{query: "", want: 50},
		{query: "limit=1", want: 1},
		{query: "limit=100", want: 100},
		{query: "limit=0", bad: true},
		{query: "limit=101", bad: true},
		{query: "limit=not-a-number", bad: true},
	} {
		req := httptest.NewRequest("GET", "/files?"+test.query, nil)
		got, _, err := filePageParameters(req, "fingerprint")
		if test.bad && err == nil {
			t.Errorf("query %q unexpectedly accepted", test.query)
		}
		if !test.bad && (err != nil || got != test.want) {
			t.Errorf("query %q = (%d, %v), want (%d, nil)", test.query, got, err, test.want)
		}
	}
}

func TestFilePageCursorBindsFilterAndRoundTrips(t *testing.T) {
	createdAt := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	fingerprint := fileFilterFingerprint("library", "workspace-1", "workspace")
	encoded := encodeFileListCursor(createdAt, "file-42", fingerprint)
	req := httptest.NewRequest("GET", "/files?cursor="+encoded, nil)
	_, cursor, err := filePageParameters(req, fingerprint)
	if err != nil || cursor == nil || cursor.ID != "file-42" || !cursor.CreatedAt.Equal(createdAt) {
		t.Fatalf("cursor round trip = %#v, %v", cursor, err)
	}
	if _, _, err := filePageParameters(req, fileFilterFingerprint("library", "workspace-2", "workspace")); err == nil {
		t.Fatal("accepted cursor from a different Workspace filter")
	}
}
