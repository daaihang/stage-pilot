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
	workflow := json.RawMessage(`{"schema_version":1,"mode":"MANUAL_DECISION","rounds":[{"key":"screen","name":"初审","execution":"parallel","reviewer_policy":{"source":"explicit_members","member_ids":["member"],"role_keys":[]},"completion":{"mode":"all"},"feedback":{"kind":"binary"}}],"request_changes":{"enabled":false,"target":"same_round"},"final_decision":"manual"}`)
	if err := validatePublicSubmissionCompatibility(intakeSingleRoundDecision, json.RawMessage(`{"per_actor_limit":1}`), requiredEmail, workflow); err != nil {
		t.Fatalf("required email should satisfy actor limit: %v", err)
	}
	if err := validatePublicSubmissionCompatibility(intakeSingleRoundDecision, json.RawMessage(`{"per_actor_limit":1}`), optionalEmail, nil); err == nil || err.(*formValidationError).Code != "contact_email_required_for_actor_limit" {
		t.Fatalf("optional email should fail actor limit compatibility, got %v", err)
	}
	if err := validatePublicSubmissionCompatibility(intakeSingleRoundDecision, json.RawMessage(`{"per_actor_limit":0}`), optionalEmail, workflow); err != nil {
		t.Fatalf("zero actor limit should be unlimited: %v", err)
	}
	if err := validatePublicSubmissionCompatibility(intakeSingleRoundDecision, json.RawMessage(`{}`), requiredEmail, json.RawMessage(`{"mode":"AUTO_ACCEPT"}`)); err == nil || err.(*formValidationError).Code != "auto_accept_unavailable" {
		t.Fatalf("auto accept should be blocked, got %v", err)
	}
	if err := validatePublicSubmissionCompatibility(intakeCollectOnly, json.RawMessage(`{"capacity":1,"waitlist_limit":1}`), optionalEmail, json.RawMessage(`{"mode":"AUTO_ACCEPT"}`)); err != nil {
		t.Fatalf("collection-only should not require review workflow or contact email when actor limit is off: %v", err)
	}
	for _, mode := range []string{intakeDirectManualDecision, intakeAutoAccept} {
		if err := validatePublicSubmissionCompatibility(mode, json.RawMessage(`{"capacity":1,"waitlist_enabled":true}`), optionalEmail, json.RawMessage(`{"mode":"AUTO_ACCEPT"}`)); err != nil {
			t.Fatalf("%s should ignore dormant review settings: %v", mode, err)
		}
	}
	if reason := publicSubmissionUnavailableReason(intakeSingleRoundDecision, json.RawMessage(`{"close_behavior":"accept_to_waitlist"}`), json.RawMessage(`{"fields":[{"id":"email","semantic_key":"CONTACT_EMAIL","required":true}]}`), nil); reason != "close_behavior_unsupported" {
		t.Fatalf("legacy close behavior reason = %q", reason)
	}
	if reason := publicSubmissionUnavailableReason(intakeSingleRoundDecision, json.RawMessage(`{"per_actor_limit":1}`), json.RawMessage(`{"fields":[{"id":"email","semantic_key":"contact_email","required":true}]}`), workflow); reason != "" {
		t.Fatalf("public form with required contact email should be available, reason=%q", reason)
	}
	if reason := publicSubmissionUnavailableReason(intakeCollectOnly, json.RawMessage(`{"capacity":1,"waitlist_enabled":false}`), json.RawMessage(`{"fields":[]}`), json.RawMessage(`{"mode":"AUTO_ACCEPT"}`)); reason != "" {
		t.Fatalf("collection-only should ignore dormant review settings and decision capacity: reason=%q", reason)
	}
	if reason := publicSubmissionUnavailableReason(intakeAutoAccept, json.RawMessage(`{"capacity":1}`), json.RawMessage(`{"fields":[]}`), json.RawMessage(`{}`)); reason != "" {
		t.Fatalf("auto accept should not require a ReviewRun workflow: reason=%q", reason)
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
