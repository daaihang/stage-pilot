import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDetailOpenMode, resolveDetailPresentation } from "./detail-open-mode.js";

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
