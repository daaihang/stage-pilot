import { evaluateFormState } from "./campaign-form-runtime.js";

const FIELD_TYPES = new Set(["text", "textarea", "number", "email", "phone", "url", "date", "datetime", "select", "radio", "checkbox", "multiselect", "file", "hidden"]);
const BLOCK_TYPES = new Set(["text", "section", "field", "consent", "upload", "divider"]);

export const DEFAULT_PRESENTATION = Object.freeze({
  publicTitle: "",
  welcome: Object.freeze({ enabled: false, titleMode: "inherit", titleOverride: "", description: "", startLabel: "开始填写" }),
  ending: Object.freeze({ mode: "default", title: "", body: "", redirectUrl: "" }),
});

function clonePresentation(value = DEFAULT_PRESENTATION) {
  return {
    publicTitle: value.publicTitle || "",
    welcome: { ...DEFAULT_PRESENTATION.welcome, ...(value.welcome || {}) },
    ending: { ...DEFAULT_PRESENTATION.ending, ...(value.ending || {}) },
  };
}

export function normalizePresentation(value, { legacyEndScreen, legacyBlocks } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length ? value : {};
  const presentation = clonePresentation({
    publicTitle: source.publicTitle ?? source.public_title ?? "",
    welcome: source.welcome,
    ending: source.ending,
  });
  if (!Object.keys(source).length) {
    const end = legacyEndScreen && typeof legacyEndScreen === "object" ? legacyEndScreen : {};
    if (String(end.title || "").trim() || String(end.body || "").trim()) {
      presentation.ending = { ...presentation.ending, mode: "custom", title: end.title || "", body: end.body || "" };
    }
    const blocks = Array.isArray(legacyBlocks) ? legacyBlocks : [];
    const welcome = blocks.find((block) => block?.type === "welcome");
    const ending = [...blocks].reverse().find((block) => block?.type === "end");
    if (welcome) presentation.welcome = { ...presentation.welcome, enabled: true, titleMode: welcome.title ? "custom" : "inherit", titleOverride: welcome.title || "", description: welcome.body || "" };
    if (ending) presentation.ending = { ...presentation.ending, mode: "custom", title: ending.title || presentation.ending.title, body: ending.body || presentation.ending.body };
  }
  const welcome = presentation.welcome;
  const ending = presentation.ending;
  welcome.enabled = Boolean(welcome.enabled);
  welcome.titleMode = welcome.titleMode === "custom" || welcome.title_mode === "custom" ? "custom" : "inherit";
  welcome.titleOverride = String(welcome.titleOverride ?? welcome.title_override ?? "").trim();
  welcome.description = String(welcome.description || "").trim();
  welcome.startLabel = String(welcome.startLabel ?? welcome.start_label ?? "开始填写").trim() || "开始填写";
  ending.mode = ["custom", "redirect"].includes(ending.mode) ? ending.mode : "default";
  ending.title = String(ending.title || "").trim();
  ending.body = String(ending.body || "").trim();
  ending.redirectUrl = String(ending.redirectUrl ?? ending.redirect_url ?? "").trim();
  presentation.publicTitle = String(presentation.publicTitle || "").trim();
  return presentation;
}

export function resolveEndingContent(form) {
  const presentation = normalizePresentation(form?.presentation, { legacyEndScreen: form?.endScreen, legacyBlocks: form?.blocks });
  if (presentation.ending.mode === "custom") return { title: presentation.ending.title || "感谢您的提交", body: presentation.ending.body || "我们已收到你的信息。", mode: "custom", redirectUrl: "" };
  if (presentation.ending.mode === "redirect") return { title: "提交成功", body: "正在跳转…", mode: "redirect", redirectUrl: presentation.ending.redirectUrl };
  return { title: "提交已收到", body: "我们已收到你提交的信息。", mode: "default", redirectUrl: "" };
}

let idSequence = 0;
export function makeId(prefix = "item") {
  idSequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSequence.toString(36)}`;
}

export function emptyFormVersion() {
  return { schemaVersion: 1, blocks: [], fields: [], logicRules: [], presentation: normalizePresentation(), endScreen: {} };
}

export function normalizeFormVersion(value = {}) {
  const source = value || {};
  const fields = Array.isArray(source.fields) ? source.fields : [];
  const blocks = Array.isArray(source.blocks) ? source.blocks : [];
  const logicRules = Array.isArray(source.logicRules || source.logic_rules) ? (source.logicRules || source.logic_rules) : [];
  const normalizedFields = fields.map((field, index) => ({ ...field, id: field.id || field.key || `field_${index + 1}`, type: field.type || "text", label: field.label || "", required: Boolean(field.required) }));
  const normalizedBlocks = blocks.filter((block) => !["welcome", "end"].includes(block?.type)).map((block, index) => ({ ...block, id: block.id || `block_${index + 1}`, type: block.type || "text" }));
  const blockFieldKeys = new Set(normalizedBlocks.filter((block) => block.type === "field" && typeof block.field_key === "string").map((block) => block.field_key));
  // Older system templates only contained section blocks while fields lived in
  // the parallel fields array. Keep their order, then append stable field
  // blocks for any field that is not represented yet. This makes blocks the
  // single renderer order without rewriting historical snapshots.
  normalizedFields.forEach((field) => {
    if (!blockFieldKeys.has(field.id)) {
      normalizedBlocks.push({ id: `field_${field.id}`, type: "field", field_key: field.id });
    }
  });
  const presentation = normalizePresentation(source.presentation, { legacyEndScreen: source.endScreen || source.end_screen, legacyBlocks: blocks });
  return {
    schemaVersion: Number(source.schemaVersion ?? source.schema_version ?? 1) || 1,
    blocks: normalizedBlocks,
    fields: normalizedFields,
    logicRules: logicRules.map((rule, index) => ({ ...rule, id: rule.id || `rule_${index + 1}` })),
    presentation,
    endScreen: { title: presentation.ending.title, body: presentation.ending.body },
  };
}

function withArrays(form) {
  return normalizeFormVersion(form);
}

export function addContentBlock(form, type = "text", properties = {}) {
  const next = withArrays(form);
  if (!BLOCK_TYPES.has(type) || type === "field") return next;
  const block = { ...properties, id: properties.id || makeId("block"), type: properties.type || type };
  return { ...next, blocks: [...next.blocks, block] };
}

export function addField(form, properties = {}, blockProperties = {}) {
  const next = withArrays(form);
  const field = { ...properties, id: properties.id || makeId("field"), type: properties.type || "text", label: properties.label || "新字段", required: Boolean(properties.required) };
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
  const referencesField = (value) => {
    if (Array.isArray(value)) return value.some(referencesField);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, child]) => {
      if (["field_id", "field_key", "target_field_id", "target_field_key", "source_field_id", "depends_on"].includes(key) && child === fieldId) return true;
      return referencesField(child);
    });
  };
  return {
    ...next,
    fields: next.fields.filter((field) => field.id !== fieldId),
    blocks: next.blocks.filter((block) => block.field_key !== fieldId),
    logicRules: next.logicRules.filter((rule) => !referencesField(rule)),
  };
}

export function removeBlock(form, blockId) {
  const next = withArrays(form);
  const block = next.blocks.find((item) => item.id === blockId);
  if (block?.type === "field" && block.field_key) return removeField(next, block.field_key);
  return { ...next, blocks: next.blocks.filter((item) => item.id !== blockId) };
}

export function duplicateBlock(form, blockId) {
  const next = withArrays(form);
  const block = next.blocks.find((item) => item.id === blockId);
  if (!block || block.type === "field") return next;
  const copy = { ...block, id: makeId("block"), title: `${block.title || "内容块"}（副本）` };
  const index = next.blocks.findIndex((item) => item.id === blockId);
  const blocks = [...next.blocks];
  blocks.splice(index + 1, 0, copy);
  return { ...next, blocks };
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
  const next = withArrays(form);
  const field = next.fields[from];
  if (!field) return next;
  const blockIndex = next.blocks.findIndex((block) => block.type === "field" && block.field_key === field.id);
  const targetField = next.fields[to];
  const targetBlockIndex = targetField ? next.blocks.findIndex((block) => block.type === "field" && block.field_key === targetField.id) : -1;
  const fields = moveArrayItem(next.fields, from, to);
  const blocks = blockIndex >= 0 && targetBlockIndex >= 0 ? moveArrayItem(next.blocks, blockIndex, targetBlockIndex) : next.blocks;
  return { ...next, fields, blocks };
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
  return evaluateFormState(withArrays(form), answers).fields;
}

export function clientValidateForm(form) {
  const next = withArrays(form);
  const issues = [];
  const presentation = normalizePresentation(next.presentation, { legacyEndScreen: next.endScreen, legacyBlocks: next.blocks });
  if (!presentation.publicTitle.trim()) issues.push({ severity: "warning", code: "missing_public_title", path: "/presentation/publicTitle", message: "未设置对外标题，发布时将使用活动名称" });
  if (!["inherit", "custom"].includes(presentation.welcome.titleMode)) issues.push({ severity: "error", code: "invalid_welcome_title_mode", path: "/presentation/welcome/titleMode", message: "欢迎页标题模式无效" });
  if (!["default", "custom", "redirect"].includes(presentation.ending.mode)) issues.push({ severity: "error", code: "invalid_ending_mode", path: "/presentation/ending/mode", message: "结束页模式无效" });
  if (presentation.welcome.startLabel.length > 24) issues.push({ severity: "error", code: "invalid_welcome_start_label", path: "/presentation/welcome/startLabel", message: "开始按钮文案不能超过 24 字" });
  if (presentation.publicTitle.length > 120 || presentation.welcome.titleOverride.length > 120 || presentation.ending.title.length > 120) issues.push({ severity: "error", code: "invalid_presentation_title", path: "/presentation", message: "展示标题不能超过 120 字" });
  if (presentation.welcome.description.length > 2000 || presentation.ending.body.length > 2000) issues.push({ severity: "error", code: "invalid_presentation_body", path: "/presentation", message: "展示说明不能超过 2000 字" });
  if (presentation.ending.mode === "redirect" && !/^https:\/\/[^\s]+$/i.test(presentation.ending.redirectUrl)) issues.push({ severity: "error", code: "invalid_redirect_url", path: "/presentation/ending/redirectUrl", message: "结束页跳转地址必须是 HTTPS URL" });
  if (next.schemaVersion !== 1) issues.push({ severity: "error", code: "unsupported_form_schema", path: "/schemaVersion", message: "不支持的表单版本" });
  const ids = new Set();
  next.fields.forEach((field, index) => {
    if (!field.id || ids.has(field.id)) issues.push({ severity: "error", code: "invalid_form_field", path: `/fields/${index}/id`, message: "字段标识必须唯一" });
    ids.add(field.id);
    if (!FIELD_TYPES.has(field.type)) issues.push({ severity: "error", code: "invalid_form_field", path: `/fields/${index}/type`, message: "字段类型无效" });
    if (!String(field.label || "").trim()) issues.push({ severity: "error", code: "missing_required_field", path: `/fields/${index}/label`, message: "字段标签不能为空" });
    if (["select", "radio", "multiselect"].includes(field.type)) {
      if (!Array.isArray(field.options) || field.options.length === 0) issues.push({ severity: "error", code: "field_options_required", path: `/fields/${index}/options`, message: "选择字段必须配置选项" });
      else {
        const optionValues = field.options.map((option) => typeof option === "string" ? option.trim() : String(option?.value || "").trim());
        if (optionValues.some((value) => !value) || new Set(optionValues).size !== optionValues.length) issues.push({ severity: "error", code: "invalid_field_options", path: `/fields/${index}/options`, message: "字段选项值必须唯一且非空" });
      }
    }
    if (field.type === "file" && (!(Number(field.max_bytes) > 0) || !Array.isArray(field.accept) || field.accept.length === 0)) issues.push({ severity: "warning", code: "file_constraints_required", path: `/fields/${index}`, message: "文件字段需要配置大小和类型限制" });
  });
  const blockIds = new Set();
  const fieldBlockCounts = new Map();
  next.blocks.forEach((block, index) => {
    if (!block.id || blockIds.has(block.id)) issues.push({ severity: "error", code: "invalid_form_block", path: `/blocks/${index}/id`, message: "内容块标识必须唯一" });
    blockIds.add(block.id);
    if (block.type === "consent" && ids.has(block.id)) issues.push({ severity: "error", code: "duplicate_form_answer_key", path: `/blocks/${index}/id`, message: "同意确认标识不能与字段标识重复" });
    if (!BLOCK_TYPES.has(block.type)) issues.push({ severity: "error", code: "invalid_form_block", path: `/blocks/${index}/type`, message: "内容块类型无效" });
    if (block.type === "field") {
      if (!ids.has(block.field_key)) issues.push({ severity: "error", code: "unknown_form_field_reference", path: `/blocks/${index}/field_key`, message: "内容块引用了不存在的字段" });
      fieldBlockCounts.set(block.field_key, (fieldBlockCounts.get(block.field_key) || 0) + 1);
    }
    if (block.type === "consent" && block.required != null && typeof block.required !== "boolean") issues.push({ severity: "error", code: "invalid_consent_block", path: `/blocks/${index}/required`, message: "同意确认的必选标记无效" });
  });
  next.fields.forEach((field, index) => {
    const count = fieldBlockCounts.get(field.id) || 0;
    if (count === 0) issues.push({ severity: "error", code: "missing_field_block", path: `/fields/${index}/id`, message: "每个字段必须对应一个字段内容块" });
    if (count > 1) issues.push({ severity: "error", code: "duplicate_field_block", path: `/fields/${index}/id`, message: "每个字段只能对应一个字段内容块" });
  });
  const fieldById = new Map(next.fields.map((field) => [field.id, field]));
  const numericOperators = new Set(["greater_than", "greater_or_equal", "less_than", "less_or_equal"]);
  next.logicRules.forEach((rule, index) => {
    const items = Array.isArray(rule.conditions?.items) ? rule.conditions.items : [];
    items.forEach((item, itemIndex) => {
      const source = fieldById.get(item.field_id);
      if (numericOperators.has(item.operator) && source?.type !== "number") issues.push({ severity: "error", code: "logic_operator_type_mismatch", path: `/logicRules/${index}/conditions/items/${itemIndex}/operator`, message: "数字比较只能用于数字字段" });
      if (numericOperators.has(item.operator) && typeof item.value !== "number") issues.push({ severity: "error", code: "logic_value_type_mismatch", path: `/logicRules/${index}/conditions/items/${itemIndex}/value`, message: "数字比较条件必须使用数字" });
      if (["equals", "not_equals"].includes(item.operator) && source && !logicValueMatchesFieldType(source.type, item.value)) issues.push({ severity: "error", code: "logic_value_type_mismatch", path: `/logicRules/${index}/conditions/items/${itemIndex}/value`, message: "条件值类型与字段类型不匹配" });
      if (item.operator === "contains" && source && (!["text", "textarea", "phone", "url", "select", "radio", "multiselect"].includes(source.type) || typeof item.value !== "string")) issues.push({ severity: "error", code: "logic_value_type_mismatch", path: `/logicRules/${index}/conditions/items/${itemIndex}/value`, message: "包含条件必须使用文本或选项值" });
    });
  });
  referencedFieldIds(next).forEach((id) => { if (!ids.has(id)) issues.push({ severity: "error", code: "unknown_logic_field", path: "/logicRules", message: "条件逻辑引用了不存在的字段" }); });
  if (next.fields.length === 0) issues.push({ severity: "warning", code: "no_fields", path: "/fields", message: "表单尚未添加字段" });
  return issues;
}

function logicValueMatchesFieldType(type, value) {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "checkbox") return typeof value === "boolean";
  return ["text", "textarea", "email", "phone", "url", "date", "datetime", "select", "radio", "multiselect", "file", "hidden"].includes(type) && typeof value === "string";
}

export { FIELD_TYPES, BLOCK_TYPES };
