import test from "node:test";
import assert from "node:assert/strict";
import { calculateSheetTiming, formatDuration, getItemEffectiveTitle, getTotalDurationSeconds, sortSheetItems } from "./program-sheet-utils.js";

test("program sheet duration only includes programs and intervals", () => {
  const sheet = { items: [
    { kind: "section", durationSeconds: 900 },
    { kind: "program", durationSeconds: 1800 },
    { kind: "interval", durationSeconds: 600 },
    { kind: "note", durationSeconds: 300 },
  ] };
  assert.equal(getTotalDurationSeconds(sheet), 2400);
  assert.equal(formatDuration(2400), "40分");
});

test("program sheet timing uses occurrence instants and reports overflow", () => {
  const sheet = { items: [
    { id: "one", kind: "program", durationSeconds: 1800 },
    { id: "break", kind: "interval", durationSeconds: 600 },
  ] };
  const result = calculateSheetTiming(sheet, {
    scheduledStartAt: "2026-10-01T11:00:00.000Z",
    scheduledEndAt: "2026-10-01T11:30:00.000Z",
  });
  assert.equal(result.rows[0].start.toISOString(), "2026-10-01T11:00:00.000Z");
  assert.equal(result.expectedEnd.toISOString(), "2026-10-01T11:40:00.000Z");
  assert.equal(result.deltaSeconds, 600);
});

test("sorting rewrites stable item order", () => {
  const result = sortSheetItems([{ id: "b", order: 8 }, { id: "a", order: 1 }]);
  assert.deepEqual(result.map((item) => [item.id, item.order]), [["b", 0], ["a", 1]]);
});

test("explicit overrides and behavior flags control the published timeline", () => {
  const sheet = { status: "published", items: [{ id: "live", kind: "program", title: "旧标题", durationSeconds: 600 }], publishedSnapshot: { items: [{ id: "frozen", kind: "segment", title: "主持", titleOverride: "主持人", durationSeconds: 300, durationSecondsOverride: 420, countsTowardDuration: true, audienceVisible: true, requiresExecution: true }] } };
  assert.equal(getItemEffectiveTitle(sheet.publishedSnapshot.items[0]), "主持人");
  assert.equal(getTotalDurationSeconds(sheet), 420);
});
