import assert from "node:assert/strict";
import test from "node:test";

import { resolveFloatingActionPresentation } from "./floating-action-layout.js";

test("floating action expands only when its open dock reaches the content-end sentinel", () => {
  assert.deepEqual(resolveFloatingActionPresentation({ open: true, contentEndVisible: false, compactWidth: 112 }), {
    expanded: false,
    compactWidth: 112,
  });
  assert.deepEqual(resolveFloatingActionPresentation({ open: true, contentEndVisible: true, compactWidth: 112 }), {
    expanded: true,
    compactWidth: 112,
  });
});

test("floating action keeps a compact presentation until it has a measurable button width", () => {
  assert.deepEqual(resolveFloatingActionPresentation({ open: true, contentEndVisible: true, compactWidth: 0 }), {
    expanded: false,
    compactWidth: null,
  });
  assert.equal(resolveFloatingActionPresentation({ open: false, contentEndVisible: true, compactWidth: 112 }).expanded, false);
});
