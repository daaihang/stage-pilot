import test from "node:test";
import assert from "node:assert/strict";
import { addField, clientValidateForm, emptyFormVersion, evaluateLogic, normalizeFormVersion, removeField } from "./campaign-form-model.js";

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
