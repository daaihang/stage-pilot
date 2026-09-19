import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppShellLayout } from "./app-shell-layout.js";

test("all work tabs use a full-width shell with a persistent utility bar", () => {
  for (const tab of ["workspaces", "participating", "collaboration"]) {
    assert.deepEqual(resolveAppShellLayout({ mode: "work", tab }), {
      showSidebar: false,
      showSidebarTrigger: false,
      showGlobalUtilityBar: true,
      toastSidebarVisible: false,
      toastBottomOffset: "3rem",
    });
  }
});

test("non-work routes keep the existing sidebar shell and toast position", () => {
  for (const route of [{ mode: "workspace" }, { mode: "production" }, { mode: "account" }, { mode: "public-campaign" }]) {
    assert.deepEqual(resolveAppShellLayout(route), {
      showSidebar: true,
      showSidebarTrigger: true,
      showGlobalUtilityBar: false,
      toastSidebarVisible: true,
      toastBottomOffset: "0px",
    });
  }
});
