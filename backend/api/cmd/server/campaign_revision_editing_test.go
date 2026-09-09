package main

import (
	"encoding/json"
	"testing"
)

func TestRevisionETagStableAcrossObjectKeyOrder(t *testing.T) {
	item := campaignRevisionItem{ID: "rev_1", CampaignID: "cmp_1", WorkspaceID: "ws_1", RevisionNo: 1, Status: "draft", FormVersionID: "form_1", AvailabilityPolicy: json.RawMessage(`{"capacity":10,"visibility":"public"}`), ReviewWorkflow: json.RawMessage(`{"mode":"AUTO_ACCEPT","schema_version":1,"rounds":[]}`), MaterializationPlan: json.RawMessage(`{"primary_target":"form_response"}`), FormVersion: &formVersionItem{ID: "form_1", SchemaVersion: 1, Blocks: json.RawMessage(`[]`), Fields: json.RawMessage(`[]`), LogicRules: json.RawMessage(`[]`), EndScreen: json.RawMessage(`{}`)}}
	second := item
	second.AvailabilityPolicy = json.RawMessage(`{"visibility":"public","capacity":10}`)
	if revisionETag(item) != revisionETag(second) {
		t.Fatal("equivalent snapshots should have the same strong ETag")
	}
}

func TestDraftFormValidationAllowsIncompleteLabels(t *testing.T) {
	form := formDefinition{SchemaVersion: 1, Blocks: json.RawMessage(`[{"id":"b1","type":"field","field_key":"f1"}]`), Fields: json.RawMessage(`[{"id":"f1","type":"text","label":""}]`), LogicRules: json.RawMessage(`[]`), EndScreen: json.RawMessage(`{}`)}
	if err := validateFormDefinitionDraftValue(form); err != nil {
		t.Fatalf("draft structural validation should allow incomplete labels: %v", err)
	}
	if err := validateFormDefinitionValue(form); err == nil {
		t.Fatal("publish validation should reject incomplete labels")
	}
}

func TestDraftFormValidationRejectsDanglingCanonicalLogic(t *testing.T) {
	form := formDefinition{SchemaVersion: 1, Blocks: json.RawMessage(`[]`), Fields: json.RawMessage(`[{"id":"f1","type":"text","label":"字段"}]`), LogicRules: json.RawMessage(`[{"id":"r1","conditions":{"match":"all","items":[{"field_id":"missing","operator":"equals","value":true}]},"effect":"show","target_field_id":"f1"}]`), EndScreen: json.RawMessage(`{}`)}
	if err := validateFormDefinitionDraftValue(form); err == nil {
		t.Fatal("dangling logic field should be rejected")
	}
}
