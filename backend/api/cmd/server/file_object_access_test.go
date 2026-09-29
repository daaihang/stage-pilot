package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseMinIOAuditEventKeepsOnlySafeAccessFields(t *testing.T) {
	payload := `{"time":"2026-09-29T10:11:12.123Z","requestID":"req-123","requestQuery":{"X-Amz-Signature":"do-not-store"},"requestHeader":{"Authorization":"do-not-store"},"api":{"name":"GetObject","bucket":"stagepilot","object":"ws/w1/versions/v1","status":"OK","statusCode":200}}`
	event, err := parseMinIOAuditEvent(strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if event.Operation != "GetObject" || event.Bucket != "stagepilot" || event.Object != "ws/w1/versions/v1" || event.RequestID != "req-123" || event.StatusCode != 200 {
		t.Fatalf("unexpected parsed object audit event: %#v", event)
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "do-not-store") || strings.Contains(string(encoded), "Signature") {
		t.Fatalf("signed request material was retained: %s", encoded)
	}
}

func TestParseMinIOAuditEventRejectsOversizedOrTrailingPayload(t *testing.T) {
	if _, err := parseMinIOAuditEvent(strings.NewReader(`{"api":{}} {}`)); err == nil {
		t.Fatal("accepted multiple JSON events in one request")
	}
	if _, err := parseMinIOAuditEvent(strings.NewReader(strings.Repeat("x", maxStorageAuditEventBytes+1))); err == nil {
		t.Fatal("accepted an oversized audit event")
	}
}
