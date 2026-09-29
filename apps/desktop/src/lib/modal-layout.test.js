import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateModalViewport,
  DIALOG_FORM_GRID_MIN_WIDTH_REM,
  DIALOG_SIZE_WIDTHS,
  pushModalDialog,
  removeModalDialog,
  resolveDialogFormGridColumns,
  resolveDialogSize,
} from "./modal-layout.js";
import { scanDialogCallsites, validateDialogUsage } from "./dialog-usage-guard.js";

test("dialog sizes use the four shared width tiers", () => {
  assert.deepEqual(DIALOG_SIZE_WIDTHS, { sm: "24rem", md: "32rem", lg: "42rem", xl: "52rem" });
  assert.equal(resolveDialogSize("xl"), "xl");
  assert.equal(resolveDialogSize("unknown"), "md");
});

test("modal viewport starts below titlebar and respects safe areas and responsive gutters", () => {
  assert.deepEqual(calculateModalViewport({ viewportHeight: 800, titlebarHeight: 36, safeAreaBottom: 20 }), {
    topInset: 36,
    bottomInset: 20,
    hostHeight: 744,
    gutter: 16,
    maxContentHeight: 712,
  });
  assert.deepEqual(calculateModalViewport({ viewportHeight: 600, titlebarVisible: false, safeAreaTop: 10, safeAreaBottom: 12 }), {
    topInset: 10,
    bottomInset: 12,
    hostHeight: 578,
    gutter: 16,
    maxContentHeight: 546,
  });
});

test("very short windows reduce gutters and never return a negative modal height", () => {
  const layout = calculateModalViewport({ viewportHeight: 80, titlebarHeight: 36, safeAreaBottom: 8 });
  assert.equal(layout.hostHeight, 36);
  assert.equal(layout.gutter, 3.2);
  assert.equal(layout.maxContentHeight, 29.6);
  assert.equal(calculateModalViewport({ viewportHeight: 20, titlebarHeight: 36 }).maxContentHeight, 0);
});

test("two-column form layout waits until both 14rem fields and their gap fit", () => {
  assert.equal(DIALOG_FORM_GRID_MIN_WIDTH_REM, 28.75);
  assert.equal(resolveDialogFormGridColumns(459), 1);
  assert.equal(resolveDialogFormGridColumns(460), 2);
  assert.equal(resolveDialogFormGridColumns(300), 1);
});

test("nested modal registration restores the parent dialog after the top dialog closes", () => {
  const outer = Symbol("outer");
  const inner = Symbol("inner");
  const stack = pushModalDialog(pushModalDialog([], outer), inner);
  assert.equal(stack.at(-1), inner);
  assert.equal(removeModalDialog(stack, inner).at(-1), outer);
});

test("dialog backdrops and popups share one exit animation duration", () => {
  const stylesheet = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const sharedMotionRule = stylesheet.match(/\.app-modal-host \[data-slot="dialog-overlay"\],[\s\S]*?\{\s*--tw-animation-duration:\s*100ms;\s*\}/);
  assert.ok(sharedMotionRule, "all modal surfaces should share the 100ms animation token");
  for (const slot of ["dialog-overlay", "alert-dialog-overlay", "dialog-content", "alert-dialog-content"]) {
    assert.ok(sharedMotionRule[0].includes(`[data-slot="${slot}"]`), `${slot} should use the shared duration`);
  }
});

test("dialog usage guard requires a shared size and rejects caller width overrides", () => {
  assert.deepEqual(scanDialogCallsites('<DialogContent size="lg" />', "ok.jsx"), []);
  assert.match(scanDialogCallsites("<DialogContent className=\"max-w-xl\" />", "fixture.jsx").join("\n"), /must declare size/);
  assert.match(scanDialogCallsites('<AlertDialogContent size="sm" className="max-h-96" />', "fixture.jsx").join("\n"), /max-w\/max-h/);
  assert.match(scanDialogCallsites('<DialogContent size="md"><form><div className="sm:grid-cols-2" /></form></DialogContent>', "fixture.jsx").join("\n"), /use DialogFormGrid/);
  assert.match(scanDialogCallsites('<DialogContent size="md"><DetailFormLayout contentClassName="sm:grid-cols-2" /></DialogContent>', "fixture.jsx").join("\n"), /use DialogFormGrid/);
  assert.match(scanDialogCallsites('<DialogContent size="md"><form><button type="submit">Save</button></form></DialogContent>', "fixture.jsx").join("\n"), /sticky DialogFooter/);
});

test("all desktop dialog callsites follow the shared sizing and form-grid rules", () => {
  assert.doesNotThrow(() => validateDialogUsage());
});
