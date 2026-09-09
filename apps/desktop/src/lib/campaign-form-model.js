const FIELD_TYPES = new Set(["text", "textarea", "number", "email", "phone", "url", "date", "datetime", "select", "radio", "checkbox", "multiselect", "file", "hidden"]);
const BLOCK_TYPES = new Set(["welcome", "text", "section", "field", "consent", "upload", "divider", "end"]);

let idSequence = 0;
export function makeId(prefix = "item") {
  idSequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSequence.toString(36)}`;
}

export function emptyFormVersion() {
  return { schemaVersion: 1, blocks: [], fields: [], logicRules: [], endScreen: {} };
}

export function normalizeFormVersion(value = {}) {
  const source = value || {};
  const fields = Array.isArray(source.fields) ? source.fields : [];
  const blocks = Array.isArray(source.blocks) ? source.blocks : [];
  const logicRules = Array.isArray(source.logicRules || source.logic_rules) ? (source.logicRules || source.logic_rules) : [];
  return {
    schemaVersion: Number(source.schemaVersion ?? source.schema_version ?? 1) || 1,
    blocks: blocks.map((block, index) => ({ id: block.id || makeId(`block${index}`), type: block.type || "text", ...block })),
    fields: fields.map((field, index) => ({ id: field.id || field.key || makeId(`field${index}`), type: field.type || "text", label: field.label || "", required: Boolean(field.required), ...field })),
    logicRules: logicRules.map((rule, index) => ({ id: rule.id || makeId(`rule${index}`), ...rule })),
    endScreen: source.endScreen || source.end_screen || {},
  };
}

function withArrays(form) {
  return normalizeFormVersion(form);
}

export function addContentBlock(form, type = "text", properties = {}) {
  const next = withArrays(form);
  const block = { id: makeId("block"), type, ...properties };
  return { ...next, blocks: [...next.blocks, block] };
}

export function addField(form, properties = {}, blockProperties = {}) {
  const next = withArrays(form);
  const field = { id: makeId("field"), type: "text", label: "新字段", required: false, ...properties };
  const block = { id: makeId("block"), type: "field", field_key: field.id, ...blockProperties };
  return { ...next, fields: [...next.fields, field], blocks: [...next.blocks, block] };
}

export function updateField(form, fieldId, patch) {
  const next = withArrays(form);
  return { ...next, fields: next.fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field) };
}

export function updateBlock(form, blockId, patch) {
  const next = withArrays(form);
  return { ...next, blocks: next.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block) };
}

export function removeField(form, fieldId) {
  const next = withArrays(form);
  return {
    ...next,
    fields: next.fields.filter((field) => field.id !== fieldId),
    blocks: next.blocks.filter((block) => block.field_key !== fieldId),
    logicRules: next.logicRules.filter((rule) => JSON.stringify(rule).indexOf(fieldId) === -1),
  };
}

export function removeBlock(form, blockId) {
  const next = withArrays(form);
  return { ...next, blocks: next.blocks.filter((block) => block.id !== blockId) };
}

export function duplicateField(form, fieldId) {
  const next = withArrays(form);
  const field = next.fields.find((item) => item.id === fieldId);
  if (!field) return next;
  const copy = { ...field, id: makeId("field"), label: `${field.label || "字段"}（副本）` };
  const index = next.fields.findIndex((item) => item.id === fieldId);
  const fields = [...next.fields]; fields.splice(index + 1, 0, copy);
  const block = { id: makeId("block"), type: "field", field_key: copy.id };
  const blockIndex = next.blocks.findIndex((item) => item.field_key === fieldId);
  const blocks = [...next.blocks]; blocks.splice(blockIndex < 0 ? blocks.length : blockIndex + 1, 0, block);
  return { ...next, fields, blocks };
}

export function moveArrayItem(items, from, to) {
  const result = [...items];
  if (from < 0 || to < 0 || from >= result.length || to >= result.length || from === to) return result;
  const [item] = result.splice(from, 1); result.splice(to, 0, item); return result;
}

export function moveBlock(form, from, to) {
  const next = withArrays(form); return { ...next, blocks: moveArrayItem(next.blocks, from, to) };
}

export function moveField(form, from, to) {
  const next = withArrays(form); return { ...next, fields: moveArrayItem(next.fields, from, to) };
}

export function referencedFieldIds(form) {
  const next = withArrays(form);
  const refs = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, child]) => {
      if (["field_id", "field_key", "target_field_id", "target_field_key", "source_field_id", "depends_on"].includes(key) && typeof child === "string") refs.add(child);
      visit(child);
    });
  };
  visit(next.logicRules); return refs;
}

export function repairReferences(form) {
  const next = withArrays(form);
  const fieldIds = new Set(next.fields.map((field) => field.id));
  const blocks = next.blocks.filter((block) => block.type !== "field" || fieldIds.has(block.field_key));
  const rules = next.logicRules.filter((rule) => {
    const refs = new Set();
    const visit = (value) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.entries(value).forEach(([key, child]) => {
        if (["field_id", "field_key", "target_field_id", "target_field_key", "source_field_id", "depends_on"].includes(key) && typeof child === "string") refs.add(child);
        visit(child);
      });
    };
    visit(rule);
    return [...refs].every((id) => fieldIds.has(id));
  });
  return { ...next, blocks, logicRules: rules };
}

export function evaluateLogic(form, answers = {}) {
  const next = withArrays(form);
  const state = Object.fromEntries(next.fields.map((field) => [field.id, { visible: true, required: Boolean(field.required) }]));
  const compare = (value, operator, expected) => {
    if (operator === "empty") return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (operator === "not_empty") return !compare(value, "empty");
    if (operator === "contains") return Array.isArray(value) ? value.includes(expected) : String(value ?? "").includes(String(expected ?? ""));
    if (operator === "equals") return Array.isArray(value) ? value.includes(expected) : value === expected;
    if (operator === "not_equals") return !compare(value, "equals", expected);
    if (operator === "greater_than") return Number(value) > Number(expected);
    if (operator === "greater_or_equal") return Number(value) >= Number(expected);
    if (operator === "less_than") return Number(value) < Number(expected);
    if (operator === "less_or_equal") return Number(value) <= Number(expected);
    return false;
  };
  for (const rule of next.logicRules) {
    const conditions = rule.conditions?.items || [];
    const matches = conditions.length ? (rule.conditions.match === "any" ? conditions.some((item) => compare(answers[item.field_id], item.operator, item.value)) : conditions.every((item) => compare(answers[item.field_id], item.operator, item.value))) : false;
    const target = rule.target_field_id || rule.target_field_key;
    if (target && state[target] && matches) {
      if (rule.effect === "show") state[target].visible = true;
      if (rule.effect === "hide") state[target].visible = false;
      if (rule.effect === "required") state[target].required = true;
      if (rule.effect === "optional") state[target].required = false;
    }
  }
  return state;
}

export function clientValidateForm(form) {
  const next = withArrays(form);
  const issues = [];
  if (next.schemaVersion !== 1) issues.push({ severity: "error", code: "unsupported_form_schema", path: "/schemaVersion", message: "不支持的表单版本" });
  const ids = new Set();
  next.fields.forEach((field, index) => {
    if (!field.id || ids.has(field.id)) issues.push({ severity: "error", code: "invalid_form_field", path: `/fields/${index}/id`, message: "字段标识必须唯一" });
    ids.add(field.id);
    if (!FIELD_TYPES.has(field.type)) issues.push({ severity: "error", code: "invalid_form_field", path: `/fields/${index}/type`, message: "字段类型无效" });
    if (!String(field.label || "").trim()) issues.push({ severity: "error", code: "missing_required_field", path: `/fields/${index}/label`, message: "字段标签不能为空" });
    if (["select", "radio", "checkbox", "multiselect"].includes(field.type) && (!Array.isArray(field.options) || field.options.length === 0)) issues.push({ severity: "error", code: "field_options_required", path: `/fields/${index}/options`, message: "选择字段必须配置选项" });
  });
  const blockIds = new Set();
  next.blocks.forEach((block, index) => {
    if (!block.id || blockIds.has(block.id)) issues.push({ severity: "error", code: "invalid_form_block", path: `/blocks/${index}/id`, message: "内容块标识必须唯一" });
    blockIds.add(block.id);
    if (!BLOCK_TYPES.has(block.type)) issues.push({ severity: "error", code: "invalid_form_block", path: `/blocks/${index}/type`, message: "内容块类型无效" });
    if (block.type === "field" && !ids.has(block.field_key)) issues.push({ severity: "error", code: "unknown_form_field_reference", path: `/blocks/${index}/field_key`, message: "内容块引用了不存在的字段" });
  });
  referencedFieldIds(next).forEach((id) => { if (!ids.has(id)) issues.push({ severity: "error", code: "unknown_logic_field", path: "/logicRules", message: "条件逻辑引用了不存在的字段" }); });
  if (next.fields.length === 0) issues.push({ severity: "warning", code: "no_fields", path: "/fields", message: "表单尚未添加字段" });
  return issues;
}

export { FIELD_TYPES, BLOCK_TYPES };
