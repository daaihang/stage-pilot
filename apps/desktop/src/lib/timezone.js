import { TZDate } from "@date-fns/tz";

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

export function getSupportedTimeZones() {
  const values = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [];
  return ["UTC", ...values.filter((value) => value !== "UTC")];
}

export function timeZoneOffsetLabel(instant = new Date(), timezone = DEFAULT_TIMEZONE) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimeZone(timezone),
    timeZoneName: "longOffset",
  }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
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
