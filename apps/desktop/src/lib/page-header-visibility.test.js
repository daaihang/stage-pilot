import assert from "node:assert/strict";
import test from "node:test";
import { resolvePageHeaderVisibility, resolvePageHeaderVisibilityFromRects, shouldTrackPageHeader } from "./page-header-visibility.js";

test("root page headers participate in visibility reporting by default", () => {
  assert.equal(shouldTrackPageHeader(), true);
  assert.equal(shouldTrackPageHeader("h1"), true);
  assert.equal(shouldTrackPageHeader("h2"), false);
});

test("page header visibility stays visible for an initial or intersecting entry", () => {
  assert.equal(resolvePageHeaderVisibility(), true);
  assert.equal(resolvePageHeaderVisibility({ isIntersecting: true, intersectionRatio: 0.25 }), true);
});

test("page header visibility becomes hidden only after the header fully leaves the root", () => {
  assert.equal(resolvePageHeaderVisibility({ isIntersecting: false, intersectionRatio: 0 }), false);
  assert.equal(resolvePageHeaderVisibility({ isIntersecting: true, intersectionRatio: 0 }), false);
});

test("geometry corrects visibility after a fast scroll crosses the root boundary", () => {
  const root = { top: 100, bottom: 700 };
  assert.equal(resolvePageHeaderVisibilityFromRects({ top: 90, bottom: 101 }, root), true);
  assert.equal(resolvePageHeaderVisibilityFromRects({ top: 20, bottom: 100 }, root), false);
  assert.equal(resolvePageHeaderVisibilityFromRects({ top: 700, bottom: 760 }, root), false);
  assert.equal(resolvePageHeaderVisibilityFromRects(null, root), true);
});
