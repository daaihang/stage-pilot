/**
 * 日期时间换算与选择器辅助。
 *
 * StagePilot 的活动时间模型：数据库存 UTC instant（RFC3339），展示与编辑
 * 一律使用活动自带时区（production.timezone，IANA）的墙钟时间。
 * 历史实现曾用 `new Date(wallClock).toISOString()`，会把活动时区的墙钟串
 * 按运行机器时区解释；这里统一改用 @date-fns/tz 的 TZDate 显式声明时区。
 */

import { TZDate } from "@date-fns/tz";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

export { DEFAULT_TIMEZONE } from "@/lib/timezone";

export const TIME_SLOT_STEP_MINUTES = 15;
export const SLOTS_PER_DAY = (24 * 60) / TIME_SLOT_STEP_MINUTES;

/** 非法/缺失时区的统一回退，与 formatProductionInstant 的约定一致。 */
/**
 * 墙钟串（"2026-09-18T19:30" 或含秒）→ UTC instant（ISO 串）。
 * 按 timezone 解释墙钟；输入为空返回 ""；解析失败返回 ""，不抛错。
 */
export function wallClockToInstant(value, timezone) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match;
  try {
    const zoned = new TZDate(
      Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? "0"), 0, timezone || DEFAULT_TIMEZONE,
    );
    return zoned.toISOString();
  } catch {
    return "";
  }
}

/**
 * UTC instant（或 Date）→ { date: Date|null, minutes: number|null }。
 * date 是活动时区该日 00:00 对应的本地 Date（仅用于 react-day-picker 的
 * 日期选择，不含时刻语义）；minutes 是当日 0-1430 的分钟数。
 */
export function instantToParts(instant, timezone) {
  const zone = timezone || DEFAULT_TIMEZONE;
  if (!instant) return { date: null, minutes: null };
  const base = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(base.getTime())) return { date: null, minutes: null };
  try {
    const zoned = new TZDate(base, zone);
    const date = new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate());
    const minutes = zoned.getHours() * 60 + zoned.getMinutes();
    return { date, minutes };
  } catch {
    return { date: null, minutes: null };
  }
}

/** 分钟数 → "HH:mm" 展示。 */
export function formatSlotLabel(minutes) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

/** Date（本地日历日期）→ "YYYY-MM-DD"。 */
export function toDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 活动时区下今天的本地日期（供日历定位与默认面板月份）。 */
export function todayInTimezone(timezone) {
  try {
    const zoned = new TZDate(Date.now(), timezone || DEFAULT_TIMEZONE);
    return new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate());
  } catch {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

/** 中文长日期："2026年9月18日"。 */
export function formatChineseDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
