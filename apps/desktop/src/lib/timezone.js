import { TZDate, tzOffset } from "@date-fns/tz";

export const DEFAULT_TIMEZONE = "Asia/Shanghai";

export function isValidTimeZone(timezone) {
  if (!timezone || typeof timezone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(timezone) {
  return isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;
}

export function resolveTimeZoneDetails({ activityTimezone, userTimezone, deviceTimezone } = {}) {
  const activity = normalizeTimeZone(activityTimezone);
  const preference = normalizeTimeZone(userTimezone || activity);
  const device = normalizeTimeZone(deviceTimezone || preference);
  const showPopover = new Set([activity, preference, device]).size > 1;
  const rows = [];
  if (preference !== activity) rows.push({ label: preference === device ? "我的时区" : "我的偏好时区", timezone: preference });
  if (device !== activity && device !== preference) rows.push({ label: "当前设备时区", timezone: device });
  return { activityTimezone: activity, showPopover, rows };
}

export function getSupportedTimeZones() {
  const values = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [];
  return ["UTC", ...values.filter((value) => value !== "UTC")];
}

export function getTimeZoneOptions({ locale = "zh-CN", at = new Date() } = {}) {
  return getSupportedTimeZones().map((value) => {
    const city = timeZoneCityLabel(value);
    const group = value === "UTC" ? "UTC" : value.split("/")[0];
    const offset = timeZoneOffsetLabel(at, value);
    return { value, group, city, offset, label: `${city} · ${value} (${offset})`, locale };
  });
}

export function timeZoneOffsetLabel(instant = new Date(), timezone = DEFAULT_TIMEZONE) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimeZone(timezone),
    timeZoneName: "longOffset",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  if (!value || value === "GMT") return "UTC+00:00";
  return value.replace(/^GMT/, "UTC");
}

export function timeZoneCityLabel(timezone) {
  if (timezone === "UTC") return "UTC";
  const segment = String(timezone || DEFAULT_TIMEZONE).split("/").pop() || DEFAULT_TIMEZONE;
  return segment.replace(/_/g, " ");
}

export function formatInstantInTimeZone(instant, timezone, options = {}) {
  if (!instant) return "";
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const { locale = "zh-CN", ...formatOptions } = options;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...formatOptions,
    timeZone: normalizeTimeZone(timezone),
  }).format(date);
}

export function dateOnlyEndOfDayToInstant(dateKey, timezone = DEFAULT_TIMEZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
  if (!match) return "";
  const [, year, month, day] = match;
  try {
    return new TZDate(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 0, normalizeTimeZone(timezone)).toISOString();
  } catch {
    return "";
  }
}

function parseWallClock(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || "").trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "0"] = match;
  const parts = [Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second)];
  if (parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31 || parts[3] > 23 || parts[4] > 59 || parts[5] > 59) return null;
  const naive = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const check = new Date(naive);
  if (check.getUTCFullYear() !== parts[0] || check.getUTCMonth() + 1 !== parts[1] || check.getUTCDate() !== parts[2]) return null;
  return { parts, naive };
}

function wallClockParts(instant, timezone) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimeZone(timezone),
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = Number(part.value);
    return result;
  }, {});
  return [values.year, values.month, values.day, values.hour === 24 ? 0 : values.hour, values.minute, values.second];
}

export function resolveWallClockTime(value, timezone = DEFAULT_TIMEZONE, { disambiguation = "reject" } = {}) {
  const parsed = parseWallClock(value);
  const zone = normalizeTimeZone(timezone);
  if (!parsed) return { status: "invalid", instant: "", candidates: [] };

  const offsets = new Set();
  for (const delta of [-3, -2, -1, 0, 1, 2, 3]) {
    offsets.add(tzOffset(zone, new Date(parsed.naive + delta * 86400000)));
  }
  const candidates = [...offsets].map((offsetMinutes) => {
    const instantDate = new Date(parsed.naive - offsetMinutes * 60000);
    return { instantDate, offsetMinutes };
  }).filter(({ instantDate }) => wallClockParts(instantDate, zone).every((part, index) => part === parsed.parts[index]))
    .sort((a, b) => a.instantDate - b.instantDate)
    .map(({ instantDate, offsetMinutes }) => ({
      instant: instantDate.toISOString(),
      offsetMinutes,
      offsetLabel: timeZoneOffsetLabel(instantDate, zone),
    }));

  if (candidates.length === 0) return { status: "nonexistent", instant: "", candidates: [] };
  if (candidates.length === 1) return { status: "valid", instant: candidates[0].instant, candidates };
  if (disambiguation === "earlier") return { status: "ambiguous", instant: candidates[0].instant, candidates };
  if (disambiguation === "later") return { status: "ambiguous", instant: candidates[candidates.length - 1].instant, candidates };
  if (disambiguation === "compatible") return { status: "ambiguous", instant: candidates[0].instant, candidates };
  return { status: "ambiguous", instant: "", candidates };
}
