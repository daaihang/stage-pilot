import assert from "node:assert/strict";
import test from "node:test";

import { resolveOverlayLayout } from "./overlay-layout.js";

test("overlay layout keeps a floating action near the bottom when no toast is visible", () => {
  assert.deepEqual(resolveOverlayLayout({ floatingActionHeight: 36, floatingActionOpen: true }), {
    floatingActionBottom: 16,
    overlayClearance: 52,
  });
});

test("overlay layout moves a floating action above the measured toast", () => {
  assert.deepEqual(resolveOverlayLayout({ toastHeight: 48, floatingActionHeight: 36, floatingActionOpen: true }), {
    floatingActionBottom: 64,
    overlayClearance: 100,
  });
});

test("overlay layout reserves toast space without an active floating action", () => {
  assert.deepEqual(resolveOverlayLayout({ toastHeight: 48, floatingActionHeight: 36, floatingActionOpen: false }), {
    floatingActionBottom: 64,
    overlayClearance: 56,
  });
});

test("overlay layout includes the work utility bar only in dock positioning", () => {
  assert.deepEqual(resolveOverlayLayout({ toastHeight: 36, floatingActionHeight: 36, floatingActionOpen: true, bottomBarHeight: 48 }), {
    floatingActionBottom: 100,
    overlayClearance: 88,
  });
});
