import assert from "node:assert/strict";
import test from "node:test";
import { SETTINGS_TABS_VERTICAL_MIN_WIDTH, resolveSettingsTabsOrientation } from "./settings-tabs-layout.js";

test("settings tabs use the content container threshold rather than a viewport breakpoint", () => {
  assert.equal(SETTINGS_TABS_VERTICAL_MIN_WIDTH, 896);
  assert.equal(resolveSettingsTabsOrientation(895), "horizontal");
  assert.equal(resolveSettingsTabsOrientation(896), "vertical");
  assert.equal(resolveSettingsTabsOrientation(1200), "vertical");
});
