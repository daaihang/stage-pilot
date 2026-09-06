package main

import (
	"testing"
	"time"
)

func TestDeriveInvitationStatus(t *testing.T) {
	now := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name            string
		revoked         bool
		starts, expires time.Time
		accepted, max   int
		want            string
	}{
		{"pending", false, now.Add(-time.Hour), now.Add(time.Hour), 0, 1, invitationPending},
		{"scheduled", false, now.Add(time.Hour), now.Add(2 * time.Hour), 0, 1, invitationScheduled},
		{"accepted", false, now.Add(-time.Hour), now.Add(time.Hour), 1, 1, invitationAccepted},
		{"exhausted", false, now.Add(-time.Hour), now.Add(time.Hour), 2, 2, invitationExhausted},
		{"expired", false, now.Add(-2 * time.Hour), now, 0, 1, invitationExpired},
		{"revoked", true, now.Add(-time.Hour), now.Add(time.Hour), 0, 1, invitationRevoked},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var revoked *time.Time
			if tc.revoked {
				value := now
				revoked = &value
			}
			if got := deriveInvitationStatus(now, tc.starts, tc.expires, revoked, tc.accepted, tc.max); got != tc.want {
				t.Fatalf("status = %q, want %q", got, tc.want)
			}
		})
	}
}
