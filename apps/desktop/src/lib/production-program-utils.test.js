import assert from "node:assert/strict";
import test from "node:test";
import { getProductionProgramMissingInfo, productionProgramSourceLabels, productionProgramStatusLabels } from "./production-program-utils.js";

test("production program missing information is explicit", () => {
  assert.deepEqual(getProductionProgramMissingInfo({ durationSeconds: 0, performers: [], technicalNotes: "" }), ["时长", "演出者", "技术备注"]);
  assert.deepEqual(getProductionProgramMissingInfo({ durationSeconds: 120, performers: ["张三"], technicalNotes: "两只无线麦" }), []);
});

test("production program labels cover every supported source and status", () => {
  assert.deepEqual(Object.keys(productionProgramSourceLabels).sort(), ["manual", "submission", "workspace_copy"]);
  assert.deepEqual(Object.keys(productionProgramStatusLabels).sort(), ["archived", "confirmed", "draft", "needs_info"]);
});
