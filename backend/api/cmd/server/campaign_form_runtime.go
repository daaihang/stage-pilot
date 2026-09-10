package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
)

// publicFormRuntime is the server-side interpretation of FormVersion answers.
// It intentionally contains no database or HTTP concerns so the public
// submission path and contract tests use one deterministic implementation.
type publicFormRuntime struct {
	fields       map[string]map[string]any
	fieldOrder   map[string]int
	consents     map[string]map[string]any
	consentOrder map[string]int
	rules        []map[string]any
}

type publicFormRuntimeResult struct {
	Answers map[string]any
	Contact string
	State   publicFormRuntimeState
}

type publicFormRuntimeState struct {
	Visible       map[string]bool
	Required      map[string]bool
	EndTriggered  bool
	EndBlockIndex int
}

var runtimeDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func newPublicFormRuntime(form json.RawMessage) (publicFormRuntime, error) {
	var definition map[string]any
	if err := json.Unmarshal(form, &definition); err != nil {
		return publicFormRuntime{}, errors.New("表单定义不存在")
	}
	runtime := publicFormRuntime{
		fields:       map[string]map[string]any{},
		fieldOrder:   map[string]int{},
		consents:     map[string]map[string]any{},
		consentOrder: map[string]int{},
	}
	if raw, ok := definition["fields"].([]any); ok {
		for _, value := range raw {
			field, ok := value.(map[string]any)
			if !ok {
				continue
			}
			id := stringValue(field, "id")
			if id == "" {
				id = stringValue(field, "key")
				if id != "" {
					field["id"] = id
				}
			}
			if id != "" {
				runtime.fields[id] = field
			}
		}
	}
	if raw, ok := definition["blocks"].([]any); ok {
		for index, value := range raw {
			block, ok := value.(map[string]any)
			if !ok {
				continue
			}
			switch stringValue(block, "type") {
			case "field":
				if id := stringValue(block, "field_key"); id != "" {
					if _, exists := runtime.fieldOrder[id]; !exists {
						runtime.fieldOrder[id] = index
					}
				}
			case "consent":
				if id := stringValue(block, "id"); id != "" {
					runtime.consents[id] = block
					runtime.consentOrder[id] = index
				}
			}
		}
	}
	if raw, ok := definition["logic_rules"].([]any); ok {
		for _, value := range raw {
			if rule, ok := value.(map[string]any); ok {
				runtime.rules = append(runtime.rules, rule)
			}
		}
	}
	return runtime, nil
}

func runtimeEmpty(value any) bool {
	if value == nil {
		return true
	}
	switch current := value.(type) {
	case string:
		return current == ""
	case []any:
		return len(current) == 0
	case []string:
		return len(current) == 0
	default:
		return false
	}
}

func runtimeEqual(value, expected any) bool {
	switch current := value.(type) {
	case []any:
		for _, item := range current {
			if runtimeEqual(item, expected) {
				return true
			}
		}
		return false
	case []string:
		for _, item := range current {
			if runtimeEqual(item, expected) {
				return true
			}
		}
		return false
	default:
		// Values have already been normalized by field type. Avoid fmt.Sprint
		// comparisons, which make 1, "1" and true accidentally equivalent.
		return reflect.DeepEqual(value, expected)
	}
}

func runtimeCompare(value any, operator string, expected any) bool {
	switch operator {
	case "empty":
		return runtimeEmpty(value)
	case "not_empty":
		return !runtimeEmpty(value)
	case "equals":
		return runtimeEqual(value, expected)
	case "not_equals":
		return !runtimeEqual(value, expected)
	case "contains":
		switch current := value.(type) {
		case []any:
			return runtimeEqual(current, expected)
		case []string:
			return runtimeEqual(current, expected)
		case string:
			expectedText, ok := expected.(string)
			return ok && strings.Contains(current, expectedText)
		default:
			return false
		}
	case "greater_than", "greater_or_equal", "less_than", "less_or_equal":
		left, leftOK := value.(float64)
		right, rightOK := expected.(float64)
		if !leftOK || !rightOK {
			return false
		}
		switch operator {
		case "greater_than":
			return left > right
		case "greater_or_equal":
			return left >= right
		case "less_than":
			return left < right
		default:
			return left <= right
		}
	default:
		return false
	}
}

func runtimeRuleMatches(rule map[string]any, answers map[string]any) bool {
	conditions, ok := rule["conditions"].(map[string]any)
	if !ok {
		return false
	}
	items, ok := conditions["items"].([]any)
	if !ok || len(items) == 0 {
		return false
	}
	match, _ := conditions["match"].(string)
	if match == "any" {
		for _, value := range items {
			item, ok := value.(map[string]any)
			if !ok {
				continue
			}
			fieldID, _ := item["field_id"].(string)
			if runtimeCompare(answers[fieldID], stringValue(item, "operator"), item["value"]) {
				return true
			}
		}
		return false
	}
	for _, value := range items {
		item, ok := value.(map[string]any)
		if !ok {
			return false
		}
		fieldID, _ := item["field_id"].(string)
		if !runtimeCompare(answers[fieldID], stringValue(item, "operator"), item["value"]) {
			return false
		}
	}
	return true
}

func (runtime publicFormRuntime) evaluate(answers map[string]any) publicFormRuntimeState {
	state := publicFormRuntimeState{Visible: map[string]bool{}, Required: map[string]bool{}, EndBlockIndex: -1}
	hidden, shown := map[string]bool{}, map[string]bool{}
	required, optional := map[string]bool{}, map[string]bool{}
	for id, field := range runtime.fields {
		state.Visible[id] = true
		if value, ok := field["required"].(bool); ok {
			state.Required[id] = value
		}
	}
	for _, rule := range runtime.rules {
		if !runtimeRuleMatches(rule, answers) {
			continue
		}
		effect := stringValue(rule, "effect")
		if effect == "end" {
			state.EndTriggered = true
			if conditions, ok := rule["conditions"].(map[string]any); ok {
				if items, ok := conditions["items"].([]any); ok {
					for _, value := range items {
						item, _ := value.(map[string]any)
						fieldID, _ := item["field_id"].(string)
						if index, exists := runtime.fieldOrder[fieldID]; exists && index > state.EndBlockIndex {
							state.EndBlockIndex = index
						}
					}
				}
			}
			continue
		}
		target := firstReference(rule, "target_field_id", "target_field_key")
		if target == "" {
			continue
		}
		switch effect {
		case "hide":
			hidden[target] = true
		case "show":
			shown[target] = true
		case "required":
			required[target] = true
		case "optional":
			optional[target] = true
		}
	}
	for id := range runtime.fields {
		state.Visible[id] = !hidden[id]
		if !state.Visible[id] {
			state.Required[id] = false
		} else if required[id] {
			state.Required[id] = true
		} else if optional[id] {
			state.Required[id] = false
		}
		_ = shown[id] // hide always wins over show
	}
	return state
}

func runtimePastEnd(order, endIndex int) bool {
	return endIndex >= 0 && order > endIndex
}

func runtimeOptionValues(field map[string]any) map[string]bool {
	allowed := map[string]bool{}
	options, _ := field["options"].([]any)
	for _, value := range options {
		switch item := value.(type) {
		case string:
			allowed[item] = true
		case map[string]any:
			if option, ok := item["value"].(string); ok && option != "" {
				allowed[option] = true
			}
		}
	}
	return allowed
}

func runtimeNormalizeDatetime(value any, timezone string) (string, error) {
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", errors.New("日期时间格式无效")
	}
	if parsed, err := time.Parse(time.RFC3339, text); err == nil {
		return parsed.UTC().Format(time.RFC3339), nil
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		location = time.UTC
	}
	for _, layout := range []string{"2006-01-02T15:04", "2006-01-02T15:04:05"} {
		if parsed, parseErr := time.ParseInLocation(layout, text, location); parseErr == nil {
			return parsed.UTC().Format(time.RFC3339), nil
		}
	}
	return "", errors.New("日期时间格式无效")
}

func runtimeAnswerEmptyForRequired(field map[string]any, value any) bool {
	if stringValue(field, "type") == "checkbox" {
		checked, ok := value.(bool)
		return !ok || !checked
	}
	return runtimeEmpty(value)
}

func (runtime publicFormRuntime) normalizeAnswers(answers map[string]any, timezone string) (publicFormRuntimeResult, error) {
	if answers == nil {
		answers = map[string]any{}
	}
	state := runtime.evaluate(answers)
	normalized := map[string]any{}
	contact := ""
	keys := make([]string, 0, len(answers))
	for key := range answers {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, id := range keys {
		raw := answers[id]
		field, fieldOK := runtime.fields[id]
		_, consentOK := runtime.consents[id]
		if !fieldOK && !consentOK {
			return publicFormRuntimeResult{}, fmt.Errorf("未知字段 %s", id)
		}
		if fieldOK {
			if !state.Visible[id] || stringValue(field, "type") == "hidden" {
				continue
			}
			if order, exists := runtime.fieldOrder[id]; exists && runtimePastEnd(order, state.EndBlockIndex) {
				continue
			}
		}
		if consentOK {
			checked, ok := raw.(bool)
			if !ok {
				return publicFormRuntimeResult{}, fmt.Errorf("同意确认 %s 必须是布尔值", id)
			}
			normalized[id] = checked
			continue
		}
		typ := stringValue(field, "type")
		if typ == "file" {
			return publicFormRuntimeResult{}, errors.New("当前公开表单暂不支持文件字段")
		}
		if raw == nil || (typ != "checkbox" && runtimeEmpty(raw)) {
			continue
		}
		switch typ {
		case "number":
			if _, ok := raw.(float64); !ok {
				return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 必须是数字", id)
			}
			normalized[id] = raw
		case "text", "textarea", "phone", "url", "hidden":
			text, ok := raw.(string)
			if !ok {
				return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 格式无效", id)
			}
			normalized[id] = text
		case "email":
			text, ok := raw.(string)
			if !ok || !validEmail(normalizeEmail(text)) {
				return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 邮箱格式无效", id)
			}
			normalized[id] = normalizeEmail(text)
			if contact == "" {
				contact = normalizeEmail(text)
			}
		case "date":
			text, ok := raw.(string)
			if !ok || !runtimeDatePattern.MatchString(text) {
				return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 日期格式无效", id)
			}
			if _, err := time.Parse("2006-01-02", text); err != nil {
				return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 日期格式无效", id)
			}
			normalized[id] = text
		case "datetime":
			text, err := runtimeNormalizeDatetime(raw, timezone)
			if err != nil {
				return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 日期时间格式无效", id)
			}
			normalized[id] = text
		case "select", "radio":
			text, ok := raw.(string)
			if !ok || !runtimeOptionValues(field)[text] {
				return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 选项无效", id)
			}
			normalized[id] = text
		case "checkbox":
			checked, ok := raw.(bool)
			if !ok {
				return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 必须是布尔值", id)
			}
			normalized[id] = checked
		case "multiselect":
			values, ok := raw.([]any)
			if !ok || len(values) == 0 {
				continue
			}
			allowed := runtimeOptionValues(field)
			copyValues := make([]string, 0, len(values))
			for _, value := range values {
				text, textOK := value.(string)
				if !textOK || !allowed[text] {
					return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 选项无效", id)
				}
				copyValues = append(copyValues, text)
			}
			normalized[id] = copyValues
		default:
			return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 类型无效", id)
		}
		if stringValue(field, "semantic_key") == "CONTACT_EMAIL" && contact == "" {
			if text, ok := normalized[id].(string); ok && validEmail(normalizeEmail(text)) {
				contact = normalizeEmail(text)
			}
		}
	}
	for id, field := range runtime.fields {
		if order, exists := runtime.fieldOrder[id]; exists && runtimePastEnd(order, state.EndBlockIndex) {
			continue
		}
		if state.Visible[id] && state.Required[id] && runtimeAnswerEmptyForRequired(field, normalized[id]) {
			return publicFormRuntimeResult{}, fmt.Errorf("字段 %s 为必填项", id)
		}
	}
	for id, consent := range runtime.consents {
		if required, _ := consent["required"].(bool); required {
			if order, exists := runtime.consentOrder[id]; exists && runtimePastEnd(order, state.EndBlockIndex) {
				continue
			}
			if normalized[id] != true {
				return publicFormRuntimeResult{}, fmt.Errorf("同意确认 %s 必须勾选", id)
			}
		}
	}
	return publicFormRuntimeResult{Answers: normalized, Contact: contact, State: state}, nil
}
