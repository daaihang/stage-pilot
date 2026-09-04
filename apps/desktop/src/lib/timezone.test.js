import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIMEZONE,
  dateOnlyEndOfDayToInstant,
  formatInstantInTimeZone,
  getSupportedTimeZones,
  getTimeZoneOptions,
  isValidTimeZone,
  resolveWallClockTime,
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

test("timezone options expose stable grouping and offset metadata", () => {
  const options = getTimeZoneOptions({ at: new Date("2026-01-01T00:00:00Z") });
  const shanghai = options.find((option) => option.value === "Asia/Shanghai");
  assert.equal(shanghai.group, "Asia");
  assert.equal(shanghai.offset, "UTC+08:00");
  assert.ok(shanghai.label.includes("Asia/Shanghai"));
});

test("DST gap is rejected and overlap exposes both offsets", () => {
  const gap = resolveWallClockTime("2026-03-08T02:30", "America/New_York");
  assert.equal(gap.status, "nonexistent");
  assert.equal(gap.instant, "");

  const overlap = resolveWallClockTime("2026-11-01T01:30", "America/New_York");
  assert.equal(overlap.status, "ambiguous");
  assert.equal(overlap.candidates.length, 2);
  assert.equal(resolveWallClockTime("2026-11-01T01:30", "America/New_York", { disambiguation: "earlier" }).instant, "2026-11-01T05:30:00.000Z");
  assert.equal(resolveWallClockTime("2026-11-01T01:30", "America/New_York", { disambiguation: "later" }).instant, "2026-11-01T06:30:00.000Z");
});
