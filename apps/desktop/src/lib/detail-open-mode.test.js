import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDetailOpenMode, resolveDetailLayoutMode, resolveDetailPresentation, resolveRestoredDetailMode } from "./detail-open-mode.js";

const resolve = (overrides = {}) => resolveDetailPresentation({ open: true, measured: true, containerWidth: 1200, ...overrides });

test("defaults missing or invalid preferences to inline", () => {
  assert.equal(normalizeDetailOpenMode(undefined), "inline");
  assert.equal(normalizeDetailOpenMode("unexpected"), "inline");
  assert.equal(resolve({ preferredMode: undefined }), "inline");
});

test("wide containers honor the configured mode", () => {
  assert.equal(resolve({ preferredMode: "inline" }), "inline");
  assert.equal(resolve({ preferredMode: "exclusive" }), "exclusive");
  assert.equal(normalizeDetailOpenMode("overlay"), "exclusive");
});

test("narrow containers always use overlay", () => {
  assert.equal(resolve({ containerWidth: 959, preferredMode: "inline" }), "overlay");
  assert.equal(resolve({ containerWidth: 959, preferredMode: "exclusive" }), "overlay");
});

test("exclusive presentation takes precedence on wide containers", () => {
  assert.equal(resolve({ preferredMode: "inline", exclusive: true }), "exclusive");
  assert.equal(resolve({ preferredMode: "inline", exclusive: true, containerWidth: 959 }), "overlay");
});

test("measurement is required before choosing a presentation", () => {
  assert.equal(resolve({ measured: false }), null);
  assert.equal(resolve({ open: false }), null);
});

test("initial layout classification uses the midpoint of the hysteresis band", () => {
  assert.equal(resolveDetailLayoutMode(959), "narrow");
  assert.equal(resolveDetailLayoutMode(960), "wide");
  assert.equal(resolveDetailLayoutMode(991), "wide");
  assert.equal(resolveDetailLayoutMode(992), "wide");
});

test("wide and narrow layout modes stay stable inside the hysteresis band", () => {
  assert.equal(resolveDetailLayoutMode(929, "wide"), "wide");
  assert.equal(resolveDetailLayoutMode(928, "wide"), "narrow");
  assert.equal(resolveDetailLayoutMode(991, "narrow"), "narrow");
  assert.equal(resolveDetailLayoutMode(992, "narrow"), "wide");
});

test("restoring a wide presentation prefers the saved session mode", () => {
  assert.equal(resolveRestoredDetailMode({ savedMode: "inline", activeMode: "exclusive", preferredMode: "exclusive" }), "inline");
  assert.equal(resolveRestoredDetailMode({ savedMode: "exclusive", activeMode: "inline", preferredMode: "inline" }), "exclusive");
  assert.equal(resolveRestoredDetailMode({ activeMode: "exclusive", preferredMode: "inline" }), "exclusive");
  assert.equal(resolveRestoredDetailMode({ preferredMode: "exclusive" }), "exclusive");
});

test("explicit layout mode controls the responsive projection", () => {
  assert.equal(resolve({ containerWidth: 1200, layoutMode: "narrow", preferredMode: "exclusive" }), "overlay");
  assert.equal(resolve({ containerWidth: 959, layoutMode: "wide", preferredMode: "inline" }), "inline");
});
