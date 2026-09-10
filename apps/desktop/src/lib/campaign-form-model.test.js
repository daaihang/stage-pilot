import test from "node:test";
import assert from "node:assert/strict";
import { addField, clientValidateForm, emptyFormVersion, evaluateLogic, normalizeFormVersion, removeField } from "./campaign-form-model.js";
import { evaluateFormState, localDateTimeToUtc, validateAnswers } from "./campaign-form-runtime.js";

test("normalizes legacy orphan fields into stable field blocks", () => {
  const normalized = normalizeFormVersion({
    blocks: [{ id: "section", type: "section", title: "资料" }],
    fields: [{ id: "title", type: "text", label: "标题" }, { id: "email", type: "email", label: "邮箱" }],
  });
  assert.deepEqual(normalized.blocks.map((block) => block.field_key).filter(Boolean), ["title", "email"]);
  assert.equal(normalized.blocks.filter((block) => block.id === "field_title").length, 1);
  assert.equal(normalized.blocks.filter((block) => block.id === "field_email").length, 1);
  assert.equal(clientValidateForm(normalized).filter((issue) => issue.severity === "error").length, 0);
});

test("normalizes a form and keeps field block references stable", () => {
  const form = addField(emptyFormVersion(), { id: "name", label: "姓名" });
  assert.equal(form.fields[0].id, "name");
  assert.equal(form.blocks[0].field_key, "name");
  assert.equal(normalizeFormVersion(form).schemaVersion, 1);
  assert.equal(clientValidateForm(form).filter((issue) => issue.severity === "error").length, 0);
});

test("removing a field removes its block and logic references", () => {
  const form = addField(emptyFormVersion(), { id: "name", label: "姓名" });
  const next = removeField({ ...form, logicRules: [{ id: "r1", target_field_id: "name" }] }, "name");
  assert.equal(next.fields.length, 0);
  assert.equal(next.blocks.length, 0);
  assert.equal(next.logicRules.length, 0);
});

test("logic evaluation updates visibility and required state", () => {
  const form = normalizeFormVersion({ fields: [{ id: "kind", type: "text", label: "类型" }, { id: "detail", type: "text", label: "详情", required: false }], blocks: [{ id: "b1", type: "field", field_key: "kind" }, { id: "b2", type: "field", field_key: "detail" }], logicRules: [{ id: "r1", conditions: { match: "all", items: [{ field_id: "kind", operator: "equals", value: "other" }] }, effect: "required", target_field_id: "detail" }] });
  assert.equal(evaluateLogic(form, { kind: "other" }).detail.required, true);
  assert.equal(evaluateLogic(form, { kind: "known" }).detail.required, false);
});

test("runtime keeps strict number types and omits optional empty values", () => {
  const form = normalizeFormVersion({
    blocks: [{ id: "age_block", type: "field", field_key: "age" }, { id: "name_block", type: "field", field_key: "name" }],
    fields: [{ id: "age", type: "number", label: "年龄", required: true }, { id: "name", type: "text", label: "姓名" }],
  });
  const invalid = validateAnswers(form, { age: "18", name: "" });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.issues[0].code, "invalid_number_answer");
  const valid = validateAnswers(form, { age: 18, name: "" });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.answers, { age: 18 });
});

test("runtime applies hidden priority, dynamic required, consent and end state", () => {
  const form = normalizeFormVersion({
    blocks: [
      { id: "kind_block", type: "field", field_key: "kind" },
      { id: "detail_block", type: "field", field_key: "detail" },
      { id: "consent_block", type: "consent", title: "规则", required: true },
      { id: "last_block", type: "field", field_key: "last" },
    ],
    fields: [
      { id: "kind", type: "select", label: "类型", options: [{ value: "skip", label: "跳过" }] },
      { id: "detail", type: "text", label: "详情", required: false },
      { id: "last", type: "text", label: "后续" },
    ],
    logicRules: [
      { id: "show", conditions: { match: "all", items: [{ field_id: "kind", operator: "equals", value: "skip" }] }, effect: "show", target_field_id: "detail" },
      { id: "hide", conditions: { match: "all", items: [{ field_id: "kind", operator: "equals", value: "skip" }] }, effect: "hide", target_field_id: "detail" },
      { id: "end", conditions: { match: "all", items: [{ field_id: "kind", operator: "equals", value: "skip" }] }, effect: "end" },
    ],
  });
  const state = evaluateFormState(form, { kind: "skip" });
  assert.equal(state.fields.detail.visible, false);
  assert.equal(state.endTriggered, true);
  assert.equal(state.fields.last.visible, true);
  const invalid = validateAnswers(form, { kind: "skip", consent_block: false });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.issues.some((issue) => issue.code === "consent_required"), true);
  const valid = validateAnswers(form, { kind: "skip", consent_block: true, last: "discarded" });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.answers, { kind: "skip", consent_block: true });
});

test("runtime converts activity-local datetime to UTC", () => {
  assert.equal(localDateTimeToUtc("2026-01-01T12:00", "Asia/Shanghai"), "2026-01-01T04:00:00Z");
  const form = normalizeFormVersion({ blocks: [{ id: "when_block", type: "field", field_key: "when" }], fields: [{ id: "when", type: "datetime", label: "时间", required: true }] });
  const result = validateAnswers(form, { when: "2026-01-01T12:00" }, { timezone: "Asia/Shanghai" });
  assert.equal(result.valid, true);
  assert.equal(result.answers.when, "2026-01-01T04:00:00Z");
});
