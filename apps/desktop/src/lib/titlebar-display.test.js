import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompactBreadcrumbItems, resolveTitlebarDefault } from "./titlebar-display.js";

const items = [
  { label: "工作空间", to: "/workspaces" },
  { label: "活动", to: "/productions" },
  { label: "节目单", current: true },
];

test("a visible page header uses the compact trailing breadcrumb", () => {
  assert.deepEqual(resolveTitlebarDefault({ pageHeaderVisible: true, pageTitle: "节目单", items }), {
    mode: "compact-breadcrumb",
    label: "",
    items: [items[1], items[2]],
  });
});

test("a hidden page header uses the configured title when titlebar text is enabled", () => {
  assert.deepEqual(resolveTitlebarDefault({ pageHeaderVisible: false, pageTitle: "节目单", items }), {
    mode: "title",
    label: "节目单",
    items: [],
  });
});

test("the titlebar can be configured to stay empty in either page state", () => {
  assert.deepEqual(resolveTitlebarDefault({ pageHeaderVisible: true, showTitle: false, pageTitle: "节目单", items }), {
    mode: "empty",
    label: "",
    items: [],
  });
  assert.deepEqual(resolveTitlebarDefault({ pageHeaderVisible: false, showTitle: false, pageTitle: "节目单", items }), {
    mode: "empty",
    label: "",
    items: [],
  });
});

test("short breadcrumb paths remain unchanged", () => {
  const short = items.slice(-2);
  assert.deepEqual(resolveCompactBreadcrumbItems(short), short);
  assert.deepEqual(resolveCompactBreadcrumbItems([]), []);
});
