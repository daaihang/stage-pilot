import test from "node:test";
import assert from "node:assert/strict";
import { defaultSegmentTypes, getDefaultItemBehavior, sortSegmentTypes } from "./program-sheet-segment-types.js";

test("segment type defaults cover controlled run-of-show kinds", () => {
  const types = defaultSegmentTypes();
  assert.equal(types.length, 16);
  assert.equal(types.at(-1).systemKey, "other");
  assert.deepEqual(getDefaultItemBehavior("program"), { countsTowardDuration: true, audienceVisible: true, requiresExecution: true });
  assert.deepEqual(getDefaultItemBehavior("section"), { countsTowardDuration: false, audienceVisible: false, requiresExecution: false });
  assert.equal(getDefaultItemBehavior("segment", types[0]).requiresExecution, true);
});

test("other stays last and active when custom types are sorted", () => {
  const [other, custom] = [defaultSegmentTypes().at(-1), { id: "custom", name: "自定义", category: "其他", color: "#123456", sortOrder: 0, isActive: false }];
  const result = sortSegmentTypes([other, custom, ...defaultSegmentTypes().slice(0, 2)]);
  assert.equal(result.at(-1).systemKey, "other");
  assert.equal(result.at(-1).isActive, true);
  assert.equal(result.find((item) => item.id === "custom").isActive, false);
});
