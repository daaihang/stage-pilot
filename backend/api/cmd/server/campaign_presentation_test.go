package main

import (
	"encoding/json"
	"testing"
)

func TestNormalizePresentationPromotesLegacyBlocks(t *testing.T) {
	rawBlocks := json.RawMessage(`[
		{"id":"welcome","type":"welcome","title":"开始报名","body":"请先阅读说明"},
		{"id":"field_name","type":"field","field_key":"name"},
		{"id":"end","type":"end","title":"收到啦","body":"等待审核"}
	]`)
	presentation := normalizePresentationJSON(nil, json.RawMessage(`{}`), rawBlocks)
	var value map[string]any
	if err := json.Unmarshal(presentation, &value); err != nil {
		t.Fatal(err)
	}
	welcome := value["welcome"].(map[string]any)
	ending := value["ending"].(map[string]any)
	if welcome["enabled"] != true || welcome["title_mode"] != "custom" || welcome["title_override"] != "开始报名" {
		t.Fatalf("welcome presentation = %#v", welcome)
	}
	if ending["mode"] != "custom" || ending["title"] != "收到啦" || ending["body"] != "等待审核" {
		t.Fatalf("ending presentation = %#v", ending)
	}
}

func TestValidatePresentationRequiresHTTPSRedirect(t *testing.T) {
	form := formDefinition{
		SchemaVersion: 1,
		Blocks:        json.RawMessage(`[]`),
		Fields:        json.RawMessage(`[]`),
		LogicRules:    json.RawMessage(`[]`),
		Presentation:  json.RawMessage(`{"public_title":"公开表单","welcome":{"enabled":false,"title_mode":"inherit","start_label":"开始填写"},"ending":{"mode":"redirect","redirect_url":"http://example.com"}}`),
		EndScreen:     json.RawMessage(`{}`),
	}
	if err := validateFormDefinitionDraftValue(form); err == nil {
		t.Fatal("expected http redirect to be rejected")
	} else if formErr, ok := err.(*formValidationError); !ok || formErr.Code != "invalid_redirect_url" {
		t.Fatalf("unexpected validation error: %#v", err)
	}
}
