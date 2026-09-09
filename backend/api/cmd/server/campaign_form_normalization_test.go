package main

import (
	"encoding/json"
	"testing"
)

func TestNormalizeFormDefinitionAddsStableFieldBlocks(t *testing.T) {
	form := normalizeFormDefinition(formDefinition{
		SchemaVersion: 1,
		Blocks:        json.RawMessage(`[{"id":"section","type":"section"}]`),
		Fields:        json.RawMessage(`[{"id":"title","type":"text","label":"标题"},{"id":"email","type":"email","label":"邮箱"}]`),
		LogicRules:    json.RawMessage(`[]`),
		EndScreen:     json.RawMessage(`{}`),
	})
	var blocks []map[string]any
	if err := json.Unmarshal(form.Blocks, &blocks); err != nil {
		t.Fatalf("decode normalized blocks: %v", err)
	}
	if len(blocks) != 3 || blocks[1]["id"] != "field_title" || blocks[2]["id"] != "field_email" {
		t.Fatalf("unexpected normalized blocks: %#v", blocks)
	}
	if err := validateFormDefinitionDraftValue(form); err != nil {
		t.Fatalf("normalized form should be draft-safe: %v", err)
	}
}

func TestNormalizeFormDefinitionPreservesExistingBlockOrder(t *testing.T) {
	form := normalizeFormDefinition(formDefinition{
		SchemaVersion: 1,
		Blocks:        json.RawMessage(`[{"id":"email_block","type":"field","field_key":"email"},{"id":"intro","type":"text"}]`),
		Fields:        json.RawMessage(`[{"id":"title","type":"text"},{"id":"email","type":"email"}]`),
		LogicRules:    json.RawMessage(`[]`),
		EndScreen:     json.RawMessage(`{}`),
	})
	var blocks []map[string]any
	if err := json.Unmarshal(form.Blocks, &blocks); err != nil {
		t.Fatalf("decode normalized blocks: %v", err)
	}
	if blocks[0]["id"] != "email_block" || blocks[1]["id"] != "intro" || blocks[2]["field_key"] != "title" {
		t.Fatalf("existing block order was not preserved: %#v", blocks)
	}
}
