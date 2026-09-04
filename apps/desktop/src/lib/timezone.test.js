import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIMEZONE,
  dateOnlyEndOfDayToInstant,
  formatInstantInTimeZone,
  getSupportedTimeZones,
  isValidTimeZone,
} from "./timezone.js";

test("supported timezone list includes UTC and canonical runtime zones", () => {
  const zones = getSupportedTimeZones();
  assert.equal(zones[0], "UTC");
  assert.ok(zones.includes("Asia/Shanghai"));
  assert.equal(new Set(zones).size, zones.length);
});

test("timezone validation and fallback are deterministic", () => {
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(DEFAULT_TIMEZONE, "Asia/Shanghai");
});

test("the same instant is formatted in the requested timezone", () => {
  const instant = "2026-01-01T00:00:00.000Z";
  assert.equal(formatInstantInTimeZone(instant, "Asia/Shanghai", { dateStyle: "short", timeStyle: undefined }), "2026/1/1");
  assert.equal(formatInstantInTimeZone(instant, "America/New_York", { dateStyle: "short", timeStyle: undefined }), "2025/12/31");
});

test("date-only expiry uses the selected business timezone", () => {
  assert.equal(dateOnlyEndOfDayToInstant("2026-01-01", "Asia/Shanghai"), "2026-01-01T23:59:59.000+08:00");
  assert.equal(dateOnlyEndOfDayToInstant("2026-01-01", "America/New_York"), "2026-01-01T23:59:59.000-05:00");
  assert.equal(dateOnlyEndOfDayToInstant("bad", "Asia/Shanghai"), "");
});
