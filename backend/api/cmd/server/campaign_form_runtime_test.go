package main

import (
	"encoding/json"
	"testing"
)

func runtimeForm(t *testing.T, value string) publicFormRuntime {
	t.Helper()
	runtime, err := newPublicFormRuntime(json.RawMessage(value))
	if err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	return runtime
}

func TestPublicFormRuntimeStrictNumberAndOptionalEmpty(t *testing.T) {
	runtime := runtimeForm(t, `{"blocks":[{"id":"age_block","type":"field","field_key":"age"},{"id":"name_block","type":"field","field_key":"name"}],"fields":[{"id":"age","type":"number","label":"年龄","required":true},{"id":"name","type":"text","label":"姓名"}],"logic_rules":[]}`)
	if _, err := runtime.normalizeAnswers(map[string]any{"age": "18", "name": ""}, "Asia/Shanghai"); err == nil {
		t.Fatal("expected string number to be rejected")
	}
	result, err := runtime.normalizeAnswers(map[string]any{"age": float64(18), "name": ""}, "Asia/Shanghai")
	if err != nil {
		t.Fatalf("normalize answers: %v", err)
	}
	if len(result.Answers) != 1 || result.Answers["age"] != float64(18) {
		t.Fatalf("unexpected normalized answers: %#v", result.Answers)
	}
}

func TestPublicFormRuntimeLogicConsentAndEnd(t *testing.T) {
	runtime := runtimeForm(t, `{"blocks":[{"id":"consent_block","type":"consent","title":"规则","required":true},{"id":"kind_block","type":"field","field_key":"kind"},{"id":"detail_block","type":"field","field_key":"detail"},{"id":"last_block","type":"field","field_key":"last"}],"fields":[{"id":"kind","type":"number","label":"数量"},{"id":"detail","type":"text","label":"详情"},{"id":"last","type":"text","label":"后续"}],"logic_rules":[{"id":"hide","conditions":{"match":"all","items":[{"field_id":"kind","operator":"greater_than","value":1}]},"effect":"hide","target_field_id":"detail"},{"id":"show","conditions":{"match":"all","items":[{"field_id":"kind","operator":"greater_than","value":1}]},"effect":"show","target_field_id":"detail"},{"id":"end","conditions":{"match":"all","items":[{"field_id":"kind","operator":"greater_than","value":1}]},"effect":"end"}]}`)
	state := runtime.evaluate(map[string]any{"kind": float64(2)})
	if state.Visible["detail"] || !state.EndTriggered || state.EndBlockIndex != 1 {
		t.Fatalf("unexpected logic state: %#v", state)
	}
	result, err := runtime.normalizeAnswers(map[string]any{"kind": float64(2), "detail": "旧答案", "consent_block": false, "last": "不应保存"}, "Asia/Shanghai")
	if err == nil {
		t.Fatal("expected required consent rejection")
	}
	result, err = runtime.normalizeAnswers(map[string]any{"kind": float64(2), "detail": "旧答案", "consent_block": true, "last": "不应保存"}, "Asia/Shanghai")
	if err != nil {
		t.Fatalf("normalize end answers: %v", err)
	}
	if result.State.EndBlockIndex != 1 || result.Answers["detail"] != nil || result.Answers["last"] != nil {
		t.Fatalf("end/hidden answers were not removed: state=%#v answers=%#v", result.State, result.Answers)
	}
}

func TestPublicFormRuntimeDatetimeUsesActivityTimezone(t *testing.T) {
	runtime := runtimeForm(t, `{"blocks":[{"id":"when_block","type":"field","field_key":"when"}],"fields":[{"id":"when","type":"datetime","label":"时间","required":true}],"logic_rules":[]}`)
	result, err := runtime.normalizeAnswers(map[string]any{"when": "2026-01-01T12:00"}, "Asia/Shanghai")
	if err != nil {
		t.Fatalf("normalize datetime: %v", err)
	}
	if result.Answers["when"] != "2026-01-01T04:00:00Z" {
		t.Fatalf("unexpected datetime: %#v", result.Answers["when"])
	}
}
