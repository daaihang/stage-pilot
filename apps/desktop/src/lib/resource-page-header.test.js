import assert from "node:assert/strict";
import test from "node:test";
import { resolveResourcePageHeader } from "./resource-page-header.js";

test("standalone resource pages retain their resource title", () => {
  assert.deepEqual(resolveResourcePageHeader({ title: "全部表单" }), {
    showHeader: true,
    title: "全部表单",
  });
});

test("embedded resource pages can hide a repeated visual title", () => {
  assert.deepEqual(resolveResourcePageHeader({ title: "全部表单", headerMode: "none" }), {
    showHeader: false,
    title: "全部表单",
  });
});

test("embedded resource pages can use a distinct section title", () => {
  assert.deepEqual(resolveResourcePageHeader({ title: "节目单环节类型", headerTitle: "环节类型列表" }), {
    showHeader: true,
    title: "环节类型列表",
  });
});
