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

test("dialogs use the shared modal open and close transition for both surfaces", () => {
  const stylesheet = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const tokens = stylesheet.match(/--modal-open-dur:\s*250ms;[\s\S]*?--modal-ease:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\);/);
  assert.ok(tokens, "the shared modal motion tokens should match the specified timing and scale");
  assert.match(tokens[0], /--modal-close-dur:\s*150ms;/);
  assert.match(tokens[0], /--modal-scale:\s*0\.96;/);
  assert.match(tokens[0], /--modal-scale-close:\s*0\.96;/);
  assert.match(stylesheet, /\.app-modal-backdrop\[data-ending-style\][\s\S]*?transition-duration:\s*var\(--modal-close-dur\)/);
  assert.match(stylesheet, /\.app-dialog-content\[data-ending-style\][\s\S]*?transform:\s*scale\(var\(--modal-scale-close\)\)[\s\S]*?transition-duration:\s*var\(--modal-close-dur\)/);
  assert.match(stylesheet, /\.app-dialog-content\s*\{[\s\S]*?transform:\s*scale\(var\(--modal-scale\)\)[\s\S]*?transition:[\s\S]*?transform var\(--modal-open-dur\)[\s\S]*?opacity var\(--modal-open-dur\)/);
  assert.match(stylesheet, /\.app-modal-backdrop,\s*\.app-dialog-content,[\s\S]*?transition:\s*none !important/);

  for (const file of ["../components/ui/dialog.jsx", "../components/ui/alert-dialog.jsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /app-modal-backdrop/);
    assert.match(source, /app-dialog-content/);
    assert.doesNotMatch(source, /data-open:animate-in|data-closed:animate-out/);
    assert.match(source, /onOpenChangeComplete=\{handleOpenChangeComplete\}/);
  }
});

test("dialog stack registration remains active until close animation completion", () => {
  const context = readFileSync(new URL("../components/modal-layer-context.jsx", import.meta.url), "utf8");
  assert.match(context, /handleOpenChangeComplete[\s\S]*?if\s*\(!nextOpen\)\s*releaseRegistration\(\)/);
  assert.match(context, /useLayoutEffect\(\(\)\s*=>\s*releaseRegistration/);
  assert.doesNotMatch(context, /useLayoutEffect\(\(\)\s*=>\s*\{\s*if\s*\(!open\)\s*return undefined;\s*return registerDialog/);
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
