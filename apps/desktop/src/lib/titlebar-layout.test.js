import assert from "node:assert/strict";
import test from "node:test";

import {
  TITLEBAR_CENTER_MIN_INLINE_SIZE,
  resolveTitlebarCenterBounds,
  resolveTitlebarMenuMode,
} from "./titlebar-layout.js";

test("titlebar centre is physically centred while reserving the larger control side", () => {
  assert.deepEqual(resolveTitlebarCenterBounds({ width: 1000, leftEnd: 180, rightStart: 760 }), {
    inlineStart: 240,
    inlineSize: 520,
    visible: true,
  });
  assert.deepEqual(resolveTitlebarCenterBounds({ width: 1000, leftEnd: 340, rightStart: 820 }), {
    inlineStart: 340,
    inlineSize: 320,
    visible: true,
  });
});

test("titlebar centre hides visually before it can collide with controls", () => {
  const bounds = resolveTitlebarCenterBounds({ width: 500, leftEnd: 210, rightStart: 290 });
  assert.equal(bounds.inlineSize, 80);
  assert.equal(bounds.visible, false);
  assert.equal(bounds.inlineSize < TITLEBAR_CENTER_MIN_INLINE_SIZE, true);
});

test("titlebar menu mode uses the 14rem/16rem hysteresis band", () => {
  assert.equal(resolveTitlebarMenuMode({ mode: "full", fullMenuCenterWidth: 223 }), "compact");
  assert.equal(resolveTitlebarMenuMode({ mode: "full", fullMenuCenterWidth: 224 }), "full");
  assert.equal(resolveTitlebarMenuMode({ mode: "compact", fullMenuCenterWidth: 255 }), "compact");
  assert.equal(resolveTitlebarMenuMode({ mode: "compact", fullMenuCenterWidth: 256 }), "full");
});
