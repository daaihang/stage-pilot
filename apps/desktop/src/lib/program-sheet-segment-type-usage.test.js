import test from "node:test";
import assert from "node:assert/strict";
import { collectSegmentTypeUsage, segmentTypeUsageCounts } from "./program-sheet-segment-type-usage-store.js";

test("segment type usage counts distinct sheets across draft and published snapshots", () => {
  const usage = collectSegmentTypeUsage({
    sheets: [
      {
        id: "sheet-a",
        items: [
          { kind: "segment", segmentTypeId: "talk" },
          { kind: "segment", segmentTypeId: "talk" },
        ],
        publishedSnapshot: { items: [{ kind: "segment", segmentTypeId: "talk" }] },
      },
      { id: "sheet-b", items: [{ kind: "segment", segmentTypeId: "talk" }, { kind: "segment", segmentTypeId: "video" }] },
      { id: "sheet-c", items: [{ kind: "program", segmentTypeId: "talk" }] },
    ],
  });

  assert.deepEqual(usage, { talk: ["sheet-a", "sheet-b"], video: ["sheet-b"] });
  assert.deepEqual(segmentTypeUsageCounts({ productions: { productionOne: usage, productionTwo: { talk: ["sheet-d"] } } }), { talk: 3, video: 1 });
});

test("missing or malformed usage data is safely empty", () => {
  assert.deepEqual(collectSegmentTypeUsage(null), {});
  assert.deepEqual(segmentTypeUsageCounts(null), {});
});
