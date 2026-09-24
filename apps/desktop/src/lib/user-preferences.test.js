import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_USER_PREFERENCES, normalizeUserPreferences, toUserPreferencePatch } from "./user-preferences.js";

test("cloud preference normalization provides a complete default profile", () => {
  assert.deepEqual(normalizeUserPreferences(), DEFAULT_USER_PREFERENCES);
});

test("cloud preference normalization preserves false boolean values", () => {
  assert.deepEqual(normalizeUserPreferences({
    notifications_enabled: false,
    show_titlebar_title: false,
    sidebar_rail_enabled: false,
    category_tabs_pinned: true,
    floating_action_expand_at_end: false,
  }), {
    ...DEFAULT_USER_PREFERENCES,
    notificationsEnabled: false,
    showTitlebarTitle: false,
    sidebarRailEnabled: false,
    categoryTabsPinned: true,
    floatingActionExpandAtEnd: false,
  });
});

test("cloud preference patches use the API field names and reject invalid values", () => {
  assert.deepEqual(toUserPreferencePatch({
    contentWidth: "wide",
    floatingActionExpandAtEnd: false,
    showTitlebarTitle: true,
  }), {
    content_width: "wide",
    floating_action_expand_at_end: false,
    show_titlebar_title: true,
  });
  assert.equal(toUserPreferencePatch({ contentWidth: "ultra-wide" }), null);
  assert.equal(toUserPreferencePatch({ madeUpPreference: true }), null);
});
