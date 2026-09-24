package main

import (
	"encoding/json"
	"testing"
)

func TestValidatePublicAnswers(t *testing.T) {
	form := json.RawMessage(`{"schema_version":1,"blocks":[{"id":"field_name","type":"field","field_key":"name"},{"id":"field_email","type":"field","field_key":"email"}],"fields":[{"id":"name","type":"text","label":"姓名","required":true},{"id":"email","type":"email","label":"邮箱","required":true,"semantic_key":"CONTACT_EMAIL"}],"logic_rules":[],"end_screen":{}}`)
	contact, err := validatePublicAnswers(form, map[string]any{"name": "张三", "email": "person@example.com"})
	if err != nil || contact != "person@example.com" {
		t.Fatalf("validate answers = %q, %v", contact, err)
	}
	if _, err := validatePublicAnswers(form, map[string]any{"name": "张三", "email": "invalid"}); err == nil {
		t.Fatal("expected invalid email")
	}
	if _, err := validatePublicAnswers(form, map[string]any{"name": "张三", "email": "person@example.com", "unknown": "x"}); err == nil {
		t.Fatal("expected unknown field rejection")
	}
}

func TestValidatePublicAnswersLogicRequired(t *testing.T) {
	form := json.RawMessage(`{"schema_version":1,"blocks":[{"id":"field_kind","type":"field","field_key":"kind"},{"id":"field_detail","type":"field","field_key":"detail"}],"fields":[{"id":"kind","type":"select","label":"类型","options":[{"value":"other","label":"其他"}]},{"id":"detail","type":"text","label":"说明"}],"logic_rules":[{"id":"r1","conditions":{"match":"all","items":[{"field_id":"kind","operator":"equals","value":"other"}]},"effect":"required","target_field_id":"detail"}],"end_screen":{}}`)
	if _, err := validatePublicAnswers(form, map[string]any{"kind": "other"}); err == nil {
		t.Fatal("expected dynamic required rejection")
	}
	if _, err := validatePublicAnswers(form, map[string]any{"kind": "other", "detail": "说明"}); err != nil {
		t.Fatalf("dynamic required validation failed: %v", err)
	}
}

func TestPublicSubmissionRequestHashBindsRevisionAndAnswers(t *testing.T) {
	first, err := publicSubmissionRequestHash("revision-1", map[string]any{"name": "A", "email": "a@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	reordered, err := publicSubmissionRequestHash("revision-1", map[string]any{"email": "a@example.com", "name": "A"})
	if err != nil {
		t.Fatal(err)
	}
	changedRevision, err := publicSubmissionRequestHash("revision-2", map[string]any{"name": "A", "email": "a@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	changedAnswers, err := publicSubmissionRequestHash("revision-1", map[string]any{"name": "B", "email": "a@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if first != reordered || first == changedRevision || first == changedAnswers {
		t.Fatalf("request fingerprints should be map-order stable and bind revision/answers: %q %q %q %q", first, reordered, changedRevision, changedAnswers)
	}
}

func TestPublicSubmissionPolicyCompatibility(t *testing.T) {
	requiredEmail := json.RawMessage(`[{"id":"email","semantic_key":"CONTACT_EMAIL","required":true}]`)
	optionalEmail := json.RawMessage(`[{"id":"email","semantic_key":"contact_email","required":false}]`)
	if err := validatePublicSubmissionCompatibility(json.RawMessage(`{"per_actor_limit":1}`), requiredEmail, json.RawMessage(`{"mode":"MANUAL_DECISION"}`)); err != nil {
		t.Fatalf("required email should satisfy actor limit: %v", err)
	}
	if err := validatePublicSubmissionCompatibility(json.RawMessage(`{"per_actor_limit":1}`), optionalEmail, nil); err == nil || err.(*formValidationError).Code != "contact_email_required_for_actor_limit" {
		t.Fatalf("optional email should fail actor limit compatibility, got %v", err)
	}
	if err := validatePublicSubmissionCompatibility(json.RawMessage(`{"per_actor_limit":0}`), optionalEmail, nil); err != nil {
		t.Fatalf("zero actor limit should be unlimited: %v", err)
	}
	if err := validatePublicSubmissionCompatibility(json.RawMessage(`{}`), requiredEmail, json.RawMessage(`{"mode":"AUTO_ACCEPT"}`)); err == nil || err.(*formValidationError).Code != "auto_accept_unavailable" {
		t.Fatalf("auto accept should be blocked, got %v", err)
	}
	if reason := publicSubmissionUnavailableReason(json.RawMessage(`{"close_behavior":"accept_to_waitlist"}`), json.RawMessage(`{"fields":[{"id":"email","semantic_key":"CONTACT_EMAIL","required":true}]}`), nil); reason != "close_behavior_unsupported" {
		t.Fatalf("legacy close behavior reason = %q", reason)
	}
	if reason := publicSubmissionUnavailableReason(json.RawMessage(`{"per_actor_limit":1}`), json.RawMessage(`{"fields":[{"id":"email","semantic_key":"contact_email","required":true}]}`), nil); reason != "" {
		t.Fatalf("public form with required contact email should be available, reason=%q", reason)
	}
}

func TestPolicyLimitNullAndZeroMeanUnlimited(t *testing.T) {
	var policy map[string]any
	if err := json.Unmarshal([]byte(`{"submission_limit":null,"capacity":0,"waitlist_limit":3}`), &policy); err != nil {
		t.Fatal(err)
	}
	if policyLimit(policy, "submission_limit") != 0 || policyLimit(policy, "capacity") != 0 || policyLimit(policy, "waitlist_limit") != 3 {
		t.Fatalf("unexpected policy limits: %#v", policy)
	}
}
