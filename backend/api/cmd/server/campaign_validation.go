package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

var validFormFieldTypes = map[string]bool{
	"text": true, "textarea": true, "number": true, "email": true, "phone": true,
	"url": true, "date": true, "datetime": true, "select": true, "radio": true,
	"checkbox": true, "multiselect": true, "file": true, "hidden": true,
}

var semanticFieldTypes = map[string]map[string]bool{
	"PROGRAM_TITLE":        {"text": true, "textarea": true},
	"PROGRAM_TYPE":         {"text": true, "select": true, "radio": true},
	"PROGRAM_PARTICIPANTS": {"text": true, "textarea": true, "multiselect": true},
	"PROGRAM_DURATION":     {"number": true},
	"PROGRAM_AUDIO":        {"file": true},
	"PROGRAM_LYRICS":       {"file": true, "textarea": true},
	"TECH_REQUIREMENTS":    {"text": true, "textarea": true},
	"PERSON_NAME":          {"text": true, "textarea": true},
	"PERSON_CONTACT":       {"text": true, "email": true, "phone": true},
	"PERSON_ROLES":         {"select": true, "radio": true, "checkbox": true, "multiselect": true, "text": true},
	"SUBJECT_NAME":         {"text": true, "textarea": true},
	"CONTACT_EMAIL":        {"email": true, "text": true},
	"PARTICIPANT_COUNT":    {"number": true},
}

type formValidationError struct {
	Code    string
	Message string
}

func (e *formValidationError) Error() string { return e.Message }

func validateFormDefinitionValue(form formDefinition) error {
	if form.SchemaVersion != 1 {
		return &formValidationError{"unsupported_form_schema", "不支持的表单版本"}
	}
	var blocks []map[string]any
	if err := json.Unmarshal(form.Blocks, &blocks); err != nil {
		return &formValidationError{"invalid_form_blocks", "表单内容块格式无效"}
	}
	var fields []map[string]any
	if err := json.Unmarshal(form.Fields, &fields); err != nil {
		return &formValidationError{"invalid_form_fields", "表单字段格式无效"}
	}
	fieldIDs := make(map[string]bool, len(fields))
	semanticKeys := make(map[string]bool)
	for _, field := range fields {
		fieldID := stringValue(field, "id")
		if fieldID == "" {
			fieldID = stringValue(field, "key")
		}
		fieldType := stringValue(field, "type")
		if fieldID == "" || fieldIDs[fieldID] || !validFormFieldTypes[fieldType] {
			return &formValidationError{"invalid_form_field", "表单字段标识或类型无效"}
		}
		fieldIDs[fieldID] = true
		if label, ok := field["label"]; ok && label != nil && strings.TrimSpace(fmt.Sprint(label)) == "" {
			return &formValidationError{"invalid_form_field_label", "表单字段标签不能为空"}
		}
		if required, ok := field["required"]; ok && required != nil {
			if _, ok := required.(bool); !ok {
				return &formValidationError{"invalid_form_field_required", "表单字段必填标记无效"}
			}
		}
		if semanticKey := stringValue(field, "semantic_key"); semanticKey != "" {
			if semanticKeys[semanticKey] {
				return &formValidationError{"duplicate_semantic_field", "表单语义字段不能重复"}
			}
			semanticKeys[semanticKey] = true
			expected := semanticFieldTypes[semanticKey]
			if expected == nil {
				return &formValidationError{"unknown_semantic_field", "表单语义字段无效"}
			}
			if !expected[fieldType] {
				return &formValidationError{"semantic_field_type_mismatch", "语义字段类型不兼容"}
			}
		}
	}
	blockIDs := make(map[string]bool, len(blocks))
	for _, block := range blocks {
		blockID := stringValue(block, "id")
		blockType := stringValue(block, "type")
		if blockID == "" || blockIDs[blockID] || !validFormBlockType(blockType) {
			return &formValidationError{"invalid_form_block", "表单内容块标识或类型无效"}
		}
		blockIDs[blockID] = true
		fieldKey := stringValue(block, "field_key")
		if blockType == "field" && fieldKey == "" {
			return &formValidationError{"missing_form_field_reference", "字段内容块必须引用字段"}
		}
		if fieldKey != "" && !fieldIDs[fieldKey] {
			return &formValidationError{"unknown_form_field_reference", "内容块引用了不存在的字段"}
		}
	}
	var rules []map[string]any
	if err := json.Unmarshal(form.LogicRules, &rules); err != nil {
		return &formValidationError{"invalid_logic_rules", "条件逻辑格式无效"}
	}
	graph := map[string][]string{}
	for _, rule := range rules {
		if len(rule) == 0 {
			return &formValidationError{"invalid_logic_rule", "条件逻辑规则不能为空"}
		}
		if err := validateLogicRule(rule, fieldIDs, graph); err != nil {
			return err
		}
	}
	if hasFieldReferenceCycle(graph) {
		return &formValidationError{"logic_cycle", "条件逻辑不能形成循环"}
	}
	return nil
}

func stringValue(value map[string]any, key string) string {
	if raw, ok := value[key]; ok {
		if text, ok := raw.(string); ok {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func validFormBlockType(blockType string) bool {
	switch blockType {
	case "welcome", "text", "section", "field", "consent", "upload", "divider", "end":
		return true
	default:
		return false
	}
}

func validateLogicRule(rule map[string]any, fields map[string]bool, graph map[string][]string) error {
	if effect := stringValue(rule, "effect"); effect != "" {
		switch effect {
		case "show", "hide", "required", "optional", "end":
		default:
			return &formValidationError{"invalid_logic_effect", "条件逻辑动作无效"}
		}
	}
	var refs []string
	collectFieldReferences(rule, &refs)
	for _, ref := range refs {
		if !fields[ref] {
			return &formValidationError{"unknown_logic_field", "条件逻辑引用了不存在的字段"}
		}
	}
	from := firstReference(rule, "field_id", "field_key", "source_field_id", "depends_on")
	to := firstReference(rule, "target_field_id", "target_field_key")
	if from != "" && to != "" && from != to {
		graph[from] = append(graph[from], to)
	}
	return nil
}

func collectFieldReferences(value any, refs *[]string) {
	switch current := value.(type) {
	case map[string]any:
		for key, child := range current {
			if key == "field_id" || key == "field_key" || key == "source_field_id" || key == "target_field_id" || key == "target_field_key" || key == "depends_on" {
				if text, ok := child.(string); ok && strings.TrimSpace(text) != "" {
					*refs = append(*refs, strings.TrimSpace(text))
				}
			}
			collectFieldReferences(child, refs)
		}
	case []any:
		for _, child := range current {
			collectFieldReferences(child, refs)
		}
	}
}

func firstReference(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if found := findReferenceByKey(value, key); found != "" {
			return found
		}
	}
	return ""
}

func findReferenceByKey(value any, key string) string {
	switch current := value.(type) {
	case map[string]any:
		if found := stringValue(current, key); found != "" {
			return found
		}
		for _, child := range current {
			if found := findReferenceByKey(child, key); found != "" {
				return found
			}
		}
	case []any:
		for _, child := range current {
			if found := findReferenceByKey(child, key); found != "" {
				return found
			}
		}
	}
	return ""
}

func hasFieldReferenceCycle(graph map[string][]string) bool {
	visiting := map[string]bool{}
	visited := map[string]bool{}
	var visit func(string) bool
	visit = func(node string) bool {
		if visiting[node] {
			return true
		}
		if visited[node] {
			return false
		}
		visiting[node] = true
		for _, next := range graph[node] {
			if visit(next) {
				return true
			}
		}
		visiting[node] = false
		visited[node] = true
		return false
	}
	for node := range graph {
		if visit(node) {
			return true
		}
	}
	return false
}

func writeFormValidationError(w http.ResponseWriter, err error) bool {
	if validationErr, ok := err.(*formValidationError); ok {
		errorJSON(w, http.StatusUnprocessableEntity, validationErr.Code, validationErr.Message)
		return true
	}
	return false
}

func validateAvailabilityPolicyValue(raw json.RawMessage) error {
	var policy map[string]any
	if err := json.Unmarshal(raw, &policy); err != nil {
		return &formValidationError{"invalid_availability_policy", "开放规则格式无效"}
	}
	if visibility := stringValue(policy, "visibility"); visibility != "" && visibility != "public" && visibility != "workspace" && visibility != "invite_only" {
		return &formValidationError{"invalid_visibility", "表单可见性无效"}
	}
	if behavior := stringValue(policy, "close_behavior"); behavior != "" && behavior != "close_to_new_entries" && behavior != "accept_to_waitlist" {
		return &formValidationError{"invalid_close_behavior", "表单关闭行为无效"}
	}
	for _, key := range []string{"submission_limit", "per_actor_limit", "capacity", "target", "waitlist_limit"} {
		if value, ok := policy[key]; ok && value != nil {
			number, ok := value.(float64)
			if !ok || number < 0 || number != float64(int64(number)) {
				return &formValidationError{"invalid_availability_number", "开放规则数量必须是非负整数"}
			}
		}
	}
	var opensAt, closesAt *time.Time
	for key, destination := range map[string]**time.Time{"opens_at": &opensAt, "closes_at": &closesAt} {
		if value, ok := policy[key]; ok && value != nil {
			text, ok := value.(string)
			if !ok {
				return &formValidationError{"invalid_availability_time", "开放时间格式无效"}
			}
			parsed, err := time.Parse(time.RFC3339, text)
			if err != nil {
				return &formValidationError{"invalid_availability_time", "开放时间必须使用 RFC3339 格式"}
			}
			*destination = &parsed
		}
	}
	if opensAt != nil && closesAt != nil && !opensAt.Before(*closesAt) {
		return &formValidationError{"invalid_availability_window", "开放时间必须早于截止时间"}
	}
	return nil
}

func validateMaterializationPlanValue(raw json.RawMessage, campaignKind string) error {
	var plan map[string]any
	if err := json.Unmarshal(raw, &plan); err != nil {
		return &formValidationError{"invalid_materialization_plan", "转化计划格式无效"}
	}
	allowed := map[string]bool{
		"production_registration": true,
		"production_program":      true,
		"production_person":       true,
		"requirement":             true,
		"resource_commitment":     true,
		"form_response":           true,
	}
	defaultTargets := map[string]string{
		campaignKindRegistration: "production_registration",
		campaignKindSubmission:   "production_program",
		campaignKindRecruitment:  "production_person",
		campaignKindCollection:   "form_response",
	}
	defaultTarget, exists := defaultTargets[campaignKind]
	if !exists {
		return &formValidationError{"invalid_campaign_kind", "表单类型无效"}
	}
	targets := make([]string, 0, 2)
	if target := stringValue(plan, "primary_target"); target != "" {
		targets = append(targets, target)
	} else if target := stringValue(plan, "target_kind"); target != "" {
		targets = append(targets, target)
	}
	if rawTargets, ok := plan["targets"]; ok {
		list, ok := rawTargets.([]any)
		if !ok {
			return &formValidationError{"invalid_materialization_target", "转化目标列表格式无效"}
		}
		for _, value := range list {
			target, ok := value.(string)
			if !ok || strings.TrimSpace(target) == "" {
				return &formValidationError{"invalid_materialization_target", "转化目标列表格式无效"}
			}
			targets = append(targets, strings.TrimSpace(target))
		}
	}
	for _, target := range targets {
		if !allowed[target] {
			return &formValidationError{"invalid_materialization_target", "转化目标不受支持"}
		}
		if target != defaultTarget && target != "requirement" && target != "resource_commitment" {
			return &formValidationError{"incompatible_materialization_target", "转化目标与表单类型不兼容"}
		}
	}
	return nil
}
