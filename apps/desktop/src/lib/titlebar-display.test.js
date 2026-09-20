import assert from "node:assert/strict";
import test from "node:test";
import { areTitlebarItemsEqual, normalizeTitlebarItems, resolveTitlebarDisplay } from "./titlebar-display.js";

const items = [
  { label: "工作空间", to: "/workspaces" },
  { label: "活动", to: "/productions" },
  { label: "节目单", current: true },
];

test("a visible page header uses the single complete breadcrumb presentation", () => {
  assert.deepEqual(resolveTitlebarDisplay({ pageHeaderVisible: true, showTitle: true, titlebarTitleMode: "page", pageTitle: "节目单", items }), {
    kind: "breadcrumb",
    label: "",
  });
});

test("a visible page header stays empty when the titlebar preference is disabled", () => {
  assert.deepEqual(resolveTitlebarDisplay({ pageHeaderVisible: true, showTitle: false, pageTitle: "节目单", items }), {
    kind: "empty",
    label: "",
  });
});

test("a hidden page header uses the configured page or app title", () => {
  assert.equal(resolveTitlebarDisplay({ pageHeaderVisible: false, showTitle: true, titlebarTitleMode: "page", pageTitle: "节目单", items }).label, "节目单");
  assert.equal(resolveTitlebarDisplay({ pageHeaderVisible: false, showTitle: true, titlebarTitleMode: "app", pageTitle: "节目单", items }).label, "StagePilot");
});

test("focus or hover expansion always uses the complete breadcrumb", () => {
  assert.deepEqual(resolveTitlebarDisplay({ pageHeaderVisible: false, showTitle: false, pageTitle: "节目单", items, expanded: true }), {
    kind: "breadcrumb",
    label: "",
  });
});

test("breadcrumb items remain in canonical order", () => {
  assert.deepEqual(normalizeTitlebarItems([items[0], null, items[2]]), [items[0], items[2]]);
  assert.deepEqual(resolveTitlebarDisplay({ pageHeaderVisible: false, showTitle: true, pageTitle: "节目单", items: [] }), {
    kind: "title",
    label: "节目单",
  });
});

test("page-header visibility never changes the canonical breadcrumb items", () => {
  const canonicalItems = normalizeTitlebarItems(items);
  const expectedItems = canonicalItems.map((item) => ({ ...item }));
  resolveTitlebarDisplay({ pageHeaderVisible: true, showTitle: true, pageTitle: "节目单", items: canonicalItems });
  resolveTitlebarDisplay({ pageHeaderVisible: false, showTitle: true, pageTitle: "节目单", items: canonicalItems });
  assert.deepEqual(canonicalItems, expectedItems);
  assert.equal(areTitlebarItemsEqual(canonicalItems, normalizeTitlebarItems(items)), true);
  assert.equal(areTitlebarItemsEqual(canonicalItems, [{ label: "工作空间", to: "/workspaces" }]), false);
});
