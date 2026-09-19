import assert from "node:assert/strict";
import test from "node:test";
import { PAGE_HEADER_ACTION_MIN_INLINE_SIZE, resolvePageHeaderActionsLayout } from "./page-header-actions-layout.js";

test("page-header action layouts keep a lone primary distinct from a lone secondary action", () => {
  assert.equal(resolvePageHeaderActionsLayout({ hasPrimary: true }), "primary-only");
  assert.equal(resolvePageHeaderActionsLayout({ secondaryCount: 1 }), "secondary-only");
  assert.equal(PAGE_HEADER_ACTION_MIN_INLINE_SIZE, "10.5rem");
});

test("page-header action layouts make two direct actions a pair", () => {
  assert.equal(resolvePageHeaderActionsLayout({ hasPrimary: true, secondaryCount: 1 }), "action-pair");
  assert.equal(resolvePageHeaderActionsLayout({ secondaryCount: 2 }), "secondary-grid");
});

test("page-header action layouts give a primary its own compact row before two supporting actions", () => {
  assert.equal(resolvePageHeaderActionsLayout({ hasPrimary: true, secondaryCount: 2 }), "primary-with-secondary-grid");
});

test("page-header action layouts count an overflow trigger as one supporting action", () => {
  assert.equal(resolvePageHeaderActionsLayout({ hasOverflow: true }), "secondary-only");
  assert.equal(resolvePageHeaderActionsLayout({ hasPrimary: true, secondaryCount: 1, hasOverflow: true }), "primary-with-secondary-grid");
});
