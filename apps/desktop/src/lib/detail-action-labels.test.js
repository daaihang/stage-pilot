import test from "node:test";
import assert from "node:assert/strict";
import { getDetailActionLabels } from "./detail-action-labels.js";

test("overlay exposes only a contextual close action", () => {
  assert.deepEqual(getDetailActionLabels({ presentation: "overlay", detailLabel: "节目单详情" }), {
    canToggle: false,
    toggle: "展开为大模态详情",
    close: "关闭节目单详情",
  });
});

test("inline uses expand and collapse labels", () => {
  assert.deepEqual(getDetailActionLabels({ presentation: "inline", detailLabel: "活动地点" }), {
    canToggle: true,
    toggle: "展开为大模态详情",
    close: "收起活动地点",
  });
});

test("exclusive uses restore and close labels", () => {
  assert.deepEqual(getDetailActionLabels({ presentation: "exclusive", detailLabel: "详情" }), {
    canToggle: true,
    toggle: "恢复为右侧详情栏",
    close: "关闭详情",
  });
});
