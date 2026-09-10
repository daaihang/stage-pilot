import { normalizeTimeZone, resolveWallClockTime } from "./timezone.js";

const EMPTY = Object.freeze({});

export const LOGIC_OPERATORS = Object.freeze([
  "equals",
  "not_equals",
  "contains",
  "empty",
  "not_empty",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
]);

const CHOICE_TYPES = new Set(["select", "radio", "checkbox", "multiselect"]);
const STRING_TYPES = new Set(["text", "textarea", "email", "phone", "url", "date", "datetime", "hidden"]);
const REFERENCE_KEYS = new Set(["field_id", "field_key", "target_field_id", "target_field_key", "source_field_id", "depends_on"]);

function optionsFor(field) {
  return Array.isArray(field?.options) ? field.options.map((option) => typeof option === "string" ? option : option?.value).filter((value) => typeof value === "string") : [];
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function fieldById(form) {
  return new Map((Array.isArray(form?.fields) ? form.fields : []).map((field) => [field.id, field]));
}

function blockOrder(form) {
  const order = new Map();
  (Array.isArray(form?.blocks) ? form.blocks : []).forEach((block, index) => {
    if (block?.type === "field" && block.field_key && !order.has(block.field_key)) order.set(block.field_key, index);
  });
  return order;
}

function compare(value, operator, expected) {
  if (operator === "empty") return isEmptyValue(value);
  if (operator === "not_empty") return !isEmptyValue(value);
  if (operator === "contains") {
    return Array.isArray(value) ? value.some((item) => item === expected) : typeof value === "string" && typeof expected === "string" && value.includes(expected);
  }
  if (operator === "equals") return Array.isArray(value) ? value.some((item) => item === expected) : value === expected;
  if (operator === "not_equals") return !compare(value, "equals", expected);
  if (!["greater_than", "greater_or_equal", "less_than", "less_or_equal"].includes(operator)) return false;
  if (!isFiniteNumber(value) || !isFiniteNumber(expected)) return false;
  if (operator === "greater_than") return value > expected;
  if (operator === "greater_or_equal") return value >= expected;
  if (operator === "less_than") return value < expected;
  return value <= expected;
}

function conditionMatches(rule, answers) {
  const items = Array.isArray(rule?.conditions?.items) ? rule.conditions.items : [];
  if (!items.length) return false;
  const results = items.map((item) => compare(answers[item?.field_id], item?.operator, item?.value));
  return rule.conditions.match === "any" ? results.some(Boolean) : results.every(Boolean);
}

function endSourceIndex(form, rule, order) {
  const items = Array.isArray(rule?.conditions?.items) ? rule.conditions.items : [];
  const positions = items.map((item) => order.get(item?.field_id)).filter((value) => Number.isInteger(value));
  return positions.length ? Math.max(...positions) : -1;
}

function runtimePastEnd(order, endIndex) {
  return endIndex >= 0 && order > endIndex;
}

export function evaluateFormState(form, answers = EMPTY) {
  const fields = Array.isArray(form?.fields) ? form.fields : [];
  const state = Object.fromEntries(fields.map((field) => [field.id, { visible: true, required: Boolean(field.required) }]));
  const hidden = new Set();
  const shown = new Set();
  const required = new Set();
  const optional = new Set();
  const order = blockOrder(form);
  let endTriggered = false;
  let endBlockIndex = -1;
  for (const rule of Array.isArray(form?.logicRules) ? form.logicRules : []) {
    if (!conditionMatches(rule, answers)) continue;
    const effect = rule.effect;
    const target = rule.target_field_id || rule.target_field_key;
    if (effect === "end") {
      endTriggered = true;
      endBlockIndex = Math.max(endBlockIndex, endSourceIndex(form, rule, order));
    } else if (target && state[target]) {
      if (effect === "hide") hidden.add(target);
      if (effect === "show") shown.add(target);
      if (effect === "required") required.add(target);
      if (effect === "optional") optional.add(target);
    }
  }
  for (const field of fields) {
    const item = state[field.id];
    const fieldIndex = order.get(field.id);
    const afterEnd = Number.isInteger(fieldIndex) && runtimePastEnd(fieldIndex, endBlockIndex);
    item.visible = afterEnd || hidden.has(field.id) ? false : shown.has(field.id) ? true : true;
    item.required = required.has(field.id) ? true : optional.has(field.id) ? false : Boolean(field.required);
    if (!item.visible) item.required = false;
  }
  return { fields: state, endTriggered, endBlockIndex };
}

export function normalizeAnswers(form, answers = EMPTY, { timezone = "Asia/Shanghai" } = {}) {
  const fields = fieldById(form);
  const blocks = Array.isArray(form?.blocks) ? form.blocks : [];
  const known = new Map(fields);
  for (const block of blocks) if (block?.type === "consent" && block.id) known.set(block.id, { id: block.id, type: "consent", required: Boolean(block.required) });
  const normalized = {};
  const issues = [];
  const state = evaluateFormState(form, answers);
  const order = blockOrder(form);

  for (const [id, raw] of Object.entries(answers || {})) {
    const field = known.get(id);
    if (!field) {
      issues.push({ code: "unknown_field", path: `/answers/${id}`, message: `未知字段 ${id}` });
      continue;
    }
    if (state.fields[id]?.visible === false || field.type === "hidden" || (Number.isInteger(order.get(id)) && runtimePastEnd(order.get(id), state.endBlockIndex))) continue;
    if (raw === null || raw === undefined) continue;
    if (field.type === "consent") {
      if (typeof raw !== "boolean") issues.push({ code: "invalid_consent", path: `/answers/${id}`, message: "同意确认必须是布尔值" });
      else normalized[id] = raw;
      continue;
    }
    if (field.type === "number") {
      if (raw === "") continue;
      if (!isFiniteNumber(raw)) issues.push({ code: "invalid_number_answer", path: `/answers/${id}`, message: `${field.label || id} 必须是数字` });
      else normalized[id] = raw;
    } else if (STRING_TYPES.has(field.type)) {
      if (raw === "") continue;
      if (typeof raw !== "string") issues.push({ code: "invalid_string_answer", path: `/answers/${id}`, message: `${field.label || id} 格式无效` });
      else if (field.type === "date" && !isValidDateOnly(raw)) issues.push({ code: "invalid_date_answer", path: `/answers/${id}`, message: `${field.label || id} 日期格式无效` });
      else if (field.type === "datetime") {
        const localValue = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw) ? localDateTimeToUtc(raw, timezone) : raw;
        const parsed = localValue ? new Date(localValue) : null;
        if (!parsed || Number.isNaN(parsed.getTime())) issues.push({ code: "invalid_datetime_answer", path: `/answers/${id}`, message: `${field.label || id} 日期时间格式无效` });
        else normalized[id] = parsed.toISOString().replace(".000Z", "Z");
      } else normalized[id] = field.type === "email" ? raw.trim().toLowerCase() : raw;
    } else if (field.type === "select" || field.type === "radio") {
      if (raw === "") continue;
      if (typeof raw !== "string" || !optionsFor(field).includes(raw)) issues.push({ code: "invalid_option_answer", path: `/answers/${id}`, message: `${field.label || id} 选项无效` });
      else normalized[id] = raw;
    } else if (field.type === "checkbox") {
      if (typeof raw !== "boolean") issues.push({ code: "invalid_boolean_answer", path: `/answers/${id}`, message: `${field.label || id} 必须是布尔值` });
      else normalized[id] = raw;
    } else if (field.type === "multiselect") {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string" || !optionsFor(field).includes(item))) issues.push({ code: "invalid_option_answer", path: `/answers/${id}`, message: `${field.label || id} 选项无效` });
      else if (raw.length) normalized[id] = [...raw];
    } else if (field.type === "file") {
      issues.push({ code: "file_upload_unavailable", path: `/answers/${id}`, message: "当前公开表单暂不支持文件字段" });
    } else {
      issues.push({ code: "invalid_field_type", path: `/answers/${id}`, message: `${field.label || id} 类型无效` });
    }
  }

  for (const field of fields) {
    if (field.type === "file") continue;
    const fieldState = state.fields[field.id];
    if (!fieldState?.visible || (Number.isInteger(order.get(field.id)) && runtimePastEnd(order.get(field.id), state.endBlockIndex))) continue;
    if (fieldState.required && (!(field.id in normalized) || isEmptyValue(normalized[field.id]) || (field.type === "checkbox" && normalized[field.id] !== true))) {
      issues.push({ code: "missing_required_field", path: `/answers/${field.id}`, message: `${field.label || field.id} 为必填项` });
    }
  }
  for (const block of blocks.filter((item) => item?.type === "consent")) {
    const blockIndex = blocks.indexOf(block);
    if (runtimePastEnd(blockIndex, state.endBlockIndex)) continue;
    if (block.required && normalized[block.id] !== true) issues.push({ code: "consent_required", path: `/answers/${block.id}`, message: `${block.title || "同意确认"} 必须勾选` });
  }
  return { answers: normalized, issues, state, valid: issues.length === 0 };
}

export function sanitizeAnswers(form, answers = EMPTY, options = {}) {
  return normalizeAnswers(form, answers, options).answers;
}

export function validateAnswers(form, answers = EMPTY, options = {}) {
  return normalizeAnswers(form, answers, options);
}

export function localDateTimeToUtc(value, timezone = "Asia/Shanghai") {
  if (!value) return "";
  const resolved = resolveWallClockTime(value, timezone, { disambiguation: "compatible" });
  return resolved.instant ? resolved.instant.replace(".000Z", "Z") : "";
}

export function utcToLocalDateTime(value, timezone = "Asia/Shanghai") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: normalizeTimeZone(timezone), hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

export function referencedFieldIdsInRule(rule) {
  const refs = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, child]) => { if (REFERENCE_KEYS.has(key) && typeof child === "string") refs.add(child); visit(child); });
  };
  visit(rule);
  return refs;
}
