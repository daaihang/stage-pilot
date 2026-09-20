import test from "node:test";
import assert from "node:assert/strict";

import { resolveFloatingPrimaryState, shouldShowFloatingPrimary } from "./page-header-floating.js";

test("floating primary stays hidden while the page header is visible", () => {
  assert.equal(shouldShowFloatingPrimary({ enabled: true, pageHeaderVisible: true, hasHost: true }), false);
});

test("floating primary appears only after an explicitly enabled header leaves the viewport", () => {
  assert.equal(shouldShowFloatingPrimary({ enabled: true, pageHeaderVisible: false, hasHost: true }), true);
});

test("floating primary is not inferred from a page action or rendered without a host", () => {
  assert.equal(shouldShowFloatingPrimary({ pageHeaderVisible: false, hasHost: true }), false);
  assert.equal(shouldShowFloatingPrimary({ enabled: true, pageHeaderVisible: false }), false);
});

test("floating primary remains mounted but inert while its page header is visible", () => {
  assert.deepEqual(resolveFloatingPrimaryState({ enabled: true, pageHeaderVisible: true, hasHost: true }), {
    mounted: true,
    open: false,
    inert: true,
  });
  assert.deepEqual(resolveFloatingPrimaryState({ enabled: true, pageHeaderVisible: false, hasHost: true }), {
    mounted: true,
    open: true,
    inert: false,
  });
});
