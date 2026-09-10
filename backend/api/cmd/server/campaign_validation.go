package main

import (
	"encoding/json"
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

// validateFormDefinitionDraftValue performs the structural checks that are
// safe while a user is editing a draft. Drafts may intentionally be empty or
// incomplete; publish validation below applies the stricter semantic rules.
func validateFormDefinitionDraftValue(form formDefinition) error {
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
		if required, ok := field["required"]; ok && required != nil {
			if _, ok := required.(bool); !ok {
				return &formValidationError{"invalid_form_field_required", "表单字段必填标记无效"}
			}
		}
	}
	blockIDs := make(map[string]bool, len(blocks))
	fieldBlockCounts := make(map[string]int, len(fields))
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
		if blockType == "field" {
			fieldBlockCounts[fieldKey]++
			if fieldBlockCounts[fieldKey] > 1 {
				return &formValidationError{"duplicate_field_block", "每个字段只能对应一个字段内容块"}
			}
		}
		if blockType == "consent" {
			if fieldIDs[blockID] {
				return &formValidationError{"duplicate_form_answer_key", "同意确认标识不能与字段标识重复"}
			}
			if required, ok := block["required"]; ok && required != nil {
				if _, ok := required.(bool); !ok {
					return &formValidationError{"invalid_consent_block", "同意确认的必选标记无效"}
				}
			}
		}
		if fieldKey != "" && !fieldIDs[fieldKey] {
			return &formValidationError{"unknown_form_field_reference", "内容块引用了不存在的字段"}
		}
	}
	for fieldID := range fieldIDs {
		if fieldBlockCounts[fieldID] == 0 {
			return &formValidationError{"missing_field_block", "每个字段必须对应一个字段内容块"}
		}
	}
	var rules []map[string]any
	if err := json.Unmarshal(form.LogicRules, &rules); err != nil {
		return &formValidationError{"invalid_logic_rules", "条件逻辑格式无效"}
	}
	ruleIDs := make(map[string]bool, len(rules))
	graph := map[string][]string{}
	for _, rule := range rules {
		if len(rule) == 0 {
			return &formValidationError{"invalid_logic_rule", "条件逻辑规则不能为空"}
		}
		if ruleID := stringValue(rule, "id"); ruleID != "" {
			if ruleIDs[ruleID] {
				return &formValidationError{"duplicate_logic_rule", "条件逻辑规则标识不能重复"}
			}
			ruleIDs[ruleID] = true
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

func validateFormDefinitionValue(form formDefinition) error {
	if err := validateFormDefinitionDraftValue(form); err != nil {
		return err
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
	fieldTypes := make(map[string]string, len(fields))
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
		fieldTypes[fieldID] = fieldType
		label, labelOK := field["label"].(string)
		if !labelOK || strings.TrimSpace(label) == "" {
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
		if fieldType == "select" || fieldType == "radio" || fieldType == "multiselect" {
			if err := validateFieldOptions(field); err != nil {
				return err
			}
		}
		if fieldType == "file" {
			if err := validateFileField(field); err != nil {
				return err
			}
		}
	}
	blockIDs := make(map[string]bool, len(blocks))
	fieldOrder := make(map[string]int)
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
		if blockType == "field" && fieldKey != "" {
			fieldOrder[fieldKey] = len(fieldOrder)
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
		if err := validateLogicRuleFieldTypes(rule, fieldTypes); err != nil {
			return err
		}
		if err := validateLogicRuleOrder(rule, fieldOrder); err != nil {
			return err
		}
	}
	if hasFieldReferenceCycle(graph) {
		return &formValidationError{"logic_cycle", "条件逻辑不能形成循环"}
	}
	for _, rule := range rules {
		if stringValue(rule, "id") == "" {
			return &formValidationError{"invalid_logic_rule", "条件逻辑规则必须包含唯一标识"}
		}
	}
	return nil
}

func validateLogicRuleOrder(rule map[string]any, fieldOrder map[string]int) error {
	from := firstReference(rule, "field_id", "field_key", "source_field_id", "depends_on")
	to := firstReference(rule, "target_field_id", "target_field_key")
	if from == "" || to == "" || from == to {
		return nil
	}
	fromOrder, fromOK := fieldOrder[from]
	toOrder, toOK := fieldOrder[to]
	if fromOK && toOK && toOrder <= fromOrder {
		return &formValidationError{"logic_target_order_invalid", "条件逻辑目标字段必须位于来源字段之后"}
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

func validateFieldOptions(field map[string]any) error {
	raw, ok := field["options"]
	if !ok {
		return &formValidationError{"field_options_required", "选择字段必须配置选项"}
	}
	options, ok := raw.([]any)
	if !ok || len(options) == 0 {
		return &formValidationError{"invalid_field_options", "字段选项格式无效"}
	}
	seen := map[string]bool{}
	for _, option := range options {
		var value, label string
		switch item := option.(type) {
		case string:
			value, label = strings.TrimSpace(item), strings.TrimSpace(item)
		case map[string]any:
			value = stringValue(item, "value")
			label = stringValue(item, "label")
		default:
			return &formValidationError{"invalid_field_options", "字段选项格式无效"}
		}
		if value == "" || label == "" || seen[value] {
			return &formValidationError{"invalid_field_options", "字段选项值和标签必须唯一且非空"}
		}
		seen[value] = true
	}
	return nil
}

func validateFileField(field map[string]any) error {
	raw, ok := field["file"]
	if !ok {
		if constraints, hasConstraints := field["constraints"]; hasConstraints {
			raw = constraints
			ok = true
		}
	}
	if !ok {
		// Accept the compact editor representation as well.
		if _, hasSize := field["max_bytes"]; !hasSize {
			return &formValidationError{"file_constraints_required", "文件字段必须配置大小限制和类型限制"}
		}
		raw = field
	}
	constraints, ok := raw.(map[string]any)
	if !ok {
		return &formValidationError{"invalid_file_constraints", "文件限制格式无效"}
	}
	max, ok := constraints["max_bytes"].(float64)
	if !ok || max <= 0 {
		return &formValidationError{"file_constraints_required", "文件字段必须配置正数大小限制"}
	}
	accept, ok := constraints["accept"].([]any)
	if !ok || len(accept) == 0 {
		return &formValidationError{"file_constraints_required", "文件字段必须配置类型限制"}
	}
	for _, item := range accept {
		if text, ok := item.(string); !ok || strings.TrimSpace(text) == "" {
			return &formValidationError{"invalid_file_constraints", "文件类型限制格式无效"}
		}
	}
	return nil
}

func validateLogicRule(rule map[string]any, fields map[string]bool, graph map[string][]string) error {
	if effect := stringValue(rule, "effect"); effect != "" {
		switch effect {
		case "show", "hide", "required", "optional", "end":
		default:
			return &formValidationError{"invalid_logic_effect", "条件逻辑动作无效"}
		}
	}
	if conditions, ok := rule["conditions"]; ok {
		conditionMap, ok := conditions.(map[string]any)
		if !ok {
			return &formValidationError{"invalid_logic_conditions", "条件逻辑条件格式无效"}
		}
		match := stringValue(conditionMap, "match")
		if match != "all" && match != "any" {
			return &formValidationError{"invalid_logic_match", "条件逻辑匹配方式无效"}
		}
		items, ok := conditionMap["items"].([]any)
		if !ok || len(items) == 0 {
			return &formValidationError{"invalid_logic_conditions", "条件逻辑至少需要一个条件"}
		}
		for _, item := range items {
			condition, ok := item.(map[string]any)
			if !ok {
				return &formValidationError{"invalid_logic_condition", "条件逻辑项格式无效"}
			}
			fieldID := stringValue(condition, "field_id")
			if fieldID == "" || !fields[fieldID] {
				return &formValidationError{"unknown_logic_field", "条件逻辑引用了不存在的字段"}
			}
			switch stringValue(condition, "operator") {
			case "equals", "not_equals", "contains", "empty", "not_empty", "greater_than", "greater_or_equal", "less_than", "less_or_equal":
			default:
				return &formValidationError{"invalid_logic_operator", "条件逻辑操作符无效"}
			}
		}
	}
	if effect := stringValue(rule, "effect"); effect != "" && effect != "end" {
		if firstReference(rule, "target_field_id", "target_field_key") == "" {
			return &formValidationError{"missing_logic_target", "条件逻辑动作必须指定目标字段"}
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
	} else if from != "" && to != "" && from == to {
		return &formValidationError{"logic_self_reference", "条件逻辑不能引用自身"}
	}
	return nil
}

func validateLogicRuleFieldTypes(rule map[string]any, fieldTypes map[string]string) error {
	conditions, ok := rule["conditions"].(map[string]any)
	if !ok {
		return nil
	}
	items, ok := conditions["items"].([]any)
	if !ok {
		return nil
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		fieldType := fieldTypes[stringValue(item, "field_id")]
		switch operator := stringValue(item, "operator"); operator {
		case "greater_than", "greater_or_equal", "less_than", "less_or_equal":
			if fieldType != "number" {
				return &formValidationError{"logic_operator_type_mismatch", "数字比较只能用于数字字段"}
			}
			if _, ok := item["value"].(float64); !ok {
				return &formValidationError{"logic_value_type_mismatch", "数字比较条件必须使用数字"}
			}
		case "contains":
			if fieldType != "text" && fieldType != "textarea" && fieldType != "phone" && fieldType != "url" && fieldType != "select" && fieldType != "radio" && fieldType != "multiselect" {
				return &formValidationError{"logic_operator_type_mismatch", "包含操作只能用于文本或选择字段"}
			}
		case "equals", "not_equals":
			if fieldType == "number" {
				if _, ok := item["value"].(float64); !ok {
					return &formValidationError{"logic_value_type_mismatch", "数字条件必须使用数字"}
				}
			}
		}
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
	if enabled, ok := policy["waitlist_enabled"]; ok && enabled != nil {
		if _, ok := enabled.(bool); !ok {
			return &formValidationError{"invalid_waitlist_policy", "候补开关格式无效"}
		}
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
	if rawDraft, ok := policy["draft_policy"]; ok && rawDraft != nil {
		draft, ok := rawDraft.(map[string]any)
		if !ok {
			return &formValidationError{"invalid_draft_policy", "草稿恢复规则格式无效"}
		}
		if enabled, exists := draft["enabled"]; exists {
			if _, ok := enabled.(bool); !ok {
				return &formValidationError{"invalid_draft_policy", "草稿恢复开关格式无效"}
			}
		}
		if retention, exists := draft["retention_hours"]; exists && retention != nil {
			number, ok := retention.(float64)
			if !ok || number < 1 || number != float64(int64(number)) {
				return &formValidationError{"invalid_draft_retention", "草稿保留时长必须是正整数"}
			}
		}
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
