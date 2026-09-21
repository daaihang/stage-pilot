import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveContentEndInSafeZone,
  resolveFloatingActionAnchor,
  resolveFloatingActionPresentation,
} from "./floating-action-layout.js";

test("floating action uses only interpolable pixel widths for compact and expanded states", () => {
  assert.deepEqual(resolveFloatingActionPresentation({ open: true, contentEndInSafeZone: false, compactWidth: 112, anchorWidth: 640 }), {
    expanded: false,
    compactInlineSize: 112,
    inlineSize: 112,
  });
  assert.deepEqual(resolveFloatingActionPresentation({ open: true, contentEndInSafeZone: true, compactWidth: 112, anchorWidth: 640 }), {
    expanded: true,
    compactInlineSize: 112,
    inlineSize: 640,
  });
});

test("floating action keeps a compact presentation until it has a measurable button width", () => {
  assert.deepEqual(resolveFloatingActionPresentation({ open: true, contentEndInSafeZone: true, compactWidth: 0, anchorWidth: 640 }), {
    expanded: false,
    compactInlineSize: null,
    inlineSize: null,
  });
  assert.equal(resolveFloatingActionPresentation({ open: false, contentEndInSafeZone: true, compactWidth: 112, anchorWidth: 640 }).expanded, false);
});

test("anchor geometry preserves custom content widths without escaping the layout", () => {
  assert.deepEqual(resolveFloatingActionAnchor({
    layoutRect: { left: 100, width: 1000 },
    anchorRect: { left: 300, width: 640 },
  }), { inlineStart: 200, inlineSize: 640 });
  assert.deepEqual(resolveFloatingActionAnchor({
    layoutRect: { left: 100, width: 600 },
    anchorRect: { left: 500, width: 640 },
  }), { inlineStart: 400, inlineSize: 200 });
});

test("content tail expands only after it enters the dynamically reserved safe zone", () => {
  const rootRect = { top: 100, bottom: 700 };
  assert.equal(resolveContentEndInSafeZone({ rootRect, sentinelRect: { top: 649, bottom: 650 }, bottomClearance: 52 }), false);
  assert.equal(resolveContentEndInSafeZone({ rootRect, sentinelRect: { top: 648, bottom: 649 }, bottomClearance: 52 }), true);
  assert.equal(resolveContentEndInSafeZone({ rootRect, sentinelRect: { top: 90, bottom: 100 }, bottomClearance: 52 }), false);
});
