package main

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizeInvitationCode(t *testing.T) {
	for _, value := range []string{"ABCDE-FGHIJ", "abcde fghij", "ABCDO-FGHIJ", "ABCDI-FGHIL"} {
		if normalized, err := normalizeInvitationCode(value); err != nil || len(normalized) != 10 {
			t.Fatalf("normalize %q = %q, %v", value, normalized, err)
		}
	}
	for _, value := range []string{"short", "ABCDE-FGHI!", "ABCDEFGHIJK"} {
		if _, err := normalizeInvitationCode(value); err == nil {
			t.Fatalf("normalize %q should fail", value)
		}
	}
}

func TestInvitationCodeFormatAndHash(t *testing.T) {
	app := &application{jwtSecret: []byte("test-secret")}
	code, err := generateInvitationCode()
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 10 || formatInvitationCode(code) != code[:5]+"-"+code[5:] {
		t.Fatalf("unexpected generated code %q", code)
	}
	if invitationCodeHash(app, code) != invitationCodeHash(app, code) {
		t.Fatal("same invitation code must hash deterministically")
	}
	if !strings.Contains(formatInvitationCode(code), "-") {
		t.Fatal("formatted invitation code must contain a separator")
	}
	encrypted, err := encryptInvitationCode(app, code)
	if err != nil {
		t.Fatal(err)
	}
	decrypted, err := decryptInvitationCode(app, encrypted)
	if err != nil || decrypted != code {
		t.Fatalf("decrypt = %q, %v", decrypted, err)
	}
}

func TestInvitationRotationAllowedOnlyForLiveInvitations(t *testing.T) {
	now := time.Now().UTC()
	if !invitationRotationAllowed(now, now.Add(-time.Minute), now.Add(time.Hour), nil, 0, 1) {
		t.Fatal("pending invitation should be rotatable")
	}
	if invitationRotationAllowed(now, now.Add(-time.Minute), now.Add(time.Hour), nil, 1, 1) {
		t.Fatal("accepted invitation should not be rotatable")
	}
	if invitationRotationAllowed(now, now.Add(-time.Minute), now.Add(-time.Second), nil, 0, 1) {
		t.Fatal("expired invitation should not be rotatable")
	}
}
