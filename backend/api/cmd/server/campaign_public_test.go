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
