package main

import (
	"errors"
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

func TestNormalizeEntryDecision(t *testing.T) {
	decisionType, status, reason, err := normalizeEntryDecision(createEntryDecisionInput{Type: " accept ", Reason: "  已确认  "})
	if err != nil || decisionType != "accept" || status != "accepted" || reason != "已确认" {
		t.Fatalf("unexpected accept decision: %q %q %q %v", decisionType, status, reason, err)
	}
	if _, _, _, err = normalizeEntryDecision(createEntryDecisionInput{Type: "reject"}); !errors.Is(err, errEntryDecisionReasonRequired) {
		t.Fatalf("expected rejection reason error, got %v", err)
	}
	if _, _, _, err = normalizeEntryDecision(createEntryDecisionInput{Type: "request_changes"}); !errors.Is(err, errInvalidEntryDecisionType) {
		t.Fatalf("expected unsupported decision type error, got %v", err)
	}
}

func TestEntryDecisionStatusRules(t *testing.T) {
	for decisionType, status := range map[string]string{"accept": "accepted", "waitlist": "waitlisted", "reject": "rejected"} {
		actual, ok := entryStatusForDecision(decisionType)
		if !ok || actual != status {
			t.Fatalf("unexpected status for %s: %q, %t", decisionType, actual, ok)
		}
	}
	for _, status := range []string{"submitted", "in_review", "accepted", "waitlisted", "rejected"} {
		if !canChangeEntryDecision(status) {
			t.Fatalf("status should be mutable: %s", status)
		}
	}
	for _, status := range []string{"draft", "needs_changes", "withdrawn", "converted", "conversion_failed"} {
		if canChangeEntryDecision(status) {
			t.Fatalf("status should not be mutable: %s", status)
		}
	}
}
