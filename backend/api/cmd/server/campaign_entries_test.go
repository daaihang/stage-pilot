package main

import (
	"net/http"
	"net/url"
	"testing"
	"time"
)

func TestEntryInboxCursorRoundTripAndFilterBinding(t *testing.T) {
	r := &http.Request{URL: &url.URL{RawQuery: "status=submitted&is_unread=true&q=artist"}}
	fingerprint := entryInboxFilterFingerprint(r)
	original := entryInboxCursor{SortAt: time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC), ID: "ent_123", Fingerprint: fingerprint}
	raw := encodeEntryInboxCursor(original)
	decoded, err := decodeEntryInboxCursor(raw, fingerprint)
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}
	if !decoded.SortAt.Equal(original.SortAt) || decoded.ID != original.ID {
		t.Fatalf("cursor mismatch: %#v vs %#v", decoded, original)
	}
	if _, err := decodeEntryInboxCursor(raw, "different"); err == nil {
		t.Fatal("expected cursor filter mismatch")
	}
}

func TestParseEntryStatuses(t *testing.T) {
	r := &http.Request{URL: &url.URL{RawQuery: "status=submitted,in_review&status=accepted"}}
	statuses, err := parseEntryStatuses(r)
	if err != nil || len(statuses) != 3 || statuses[1] != "in_review" {
		t.Fatalf("unexpected statuses: %#v, %v", statuses, err)
	}
	r.URL.RawQuery = "status=unknown"
	if _, err := parseEntryStatuses(r); err == nil {
		t.Fatal("expected invalid status")
	}
}
