import type { StartOfWeek, TimeFormat } from "./types";

const HOUR = 3_600_000;
const DAY = 86_400_000;

const partsCache = new Map<string, Intl.DateTimeFormat>();

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function effectiveTimeZone(setting: string | null | undefined): string {
  if (!setting || setting === "system") return systemTimeZone();
  return isValidTimeZone(setting) ? setting : systemTimeZone();
}

function formatter(tz: string): Intl.DateTimeFormat {
  const cached = partsCache.get(tz);
  if (cached) return cached;
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  partsCache.set(tz, value);
  return value;
}

export function zonedParts(ms: number, tz: string): ZonedParts {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    const value = part ? Number(part.value) : 0;
    return Number.isFinite(value) ? value : 0;
  };
  const hour = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: hour === 24 ? 0 : hour,
    minute: get("minute"),
    second: get("second"),
  };
}

export function pad2(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, "0");
}

export function zonedDateKey(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function todayKey(tz: string): string {
  return zonedDateKey(Date.now(), tz);
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

export function addDaysKey(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function startOfWeekKey(key: string, start: StartOfWeek): string {
  const { year, month, day } = parseDateKey(key);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  const offset = start === "sunday" ? weekday : (weekday + 6) % 7;
  return addDaysKey(key, -offset);
}

export function weekKeys(startKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysKey(startKey, index));
}

/** Difference between the zone's wall clock interpreted as UTC and the real instant. */
export function tzOffsetMs(tz: string, utcMs: number): number {
  const aligned = Math.floor(utcMs / 1000) * 1000;
  const p = zonedParts(aligned, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - aligned;
}

const dayStartCache = new Map<string, number>();

/**
 * First instant of a local calendar day. Uses a search so skipped/ambiguous midnights during
 * DST transitions resolve to the earliest existing instant (same rule as the Rust backend).
 */
export function zonedDayStartMs(dateKey: string, tz: string): number {
  const cacheKey = `${tz}|${dateKey}`;
  const cached = dayStartCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const { year, month, day } = parseDateKey(dateKey);
  const nominal = Date.UTC(year, month - 1, day);
  const scanStart = nominal - 18 * HOUR;
  const scanEnd = nominal + 18 * HOUR;
  const step = 10 * 60_000;
  let found: number | null = null;
  for (let probe = scanStart; probe <= scanEnd; probe += step) {
    if (zonedDateKey(probe, tz) === dateKey) {
      found = probe;
      break;
    }
  }
  let result: number;
  if (found === null) {
    result = nominal;
  } else {
    let lo = found - step;
    let hi = found;
    while (hi - lo > 1000) {
      const mid = Math.floor((lo + hi) / 2000) * 1000;
      if (zonedDateKey(mid, tz) === dateKey) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    result = hi;
  }
  dayStartCache.set(cacheKey, result);
  return result;
}

export function zonedDayEndMs(dateKey: string, tz: string): number {
  return zonedDayStartMs(addDaysKey(dateKey, 1), tz);
}

/** Convert a local date + "HH:MM" into the corresponding UTC instant. */
export function zonedDateTimeToUtcMs(
  dateKey: string,
  time: string,
  tz: string,
): number {
  const { year, month, day } = parseDateKey(dateKey);
  const [hourRaw, minuteRaw, secondRaw] = time.split(":");
  const hour = Number(hourRaw ?? 0);
  const minute = Number(minuteRaw ?? 0);
  const second = Number(secondRaw ?? 0);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 4; i += 1) {
    const next = target - tzOffsetMs(tz, guess);
    if (next === guess) break;
    guess = next;
  }
  return Math.floor(guess / 1000) * 1000;
}

export function formatTime(
  ms: number,
  tz: string,
  preference: TimeFormat,
  withSeconds = false,
): string {
  const p = zonedParts(ms, tz);
  const use12 =
    preference === "12h"
      ? true
      : preference === "24h"
        ? false
        : prefers12Hour();
  const suffix = withSeconds ? `:${pad2(p.second)}` : "";
  if (use12) {
    const hour = p.hour % 12 === 0 ? 12 : p.hour % 12;
    return `${hour}:${pad2(p.minute)}${suffix} ${p.hour < 12 ? "AM" : "PM"}`;
  }
  return `${pad2(p.hour)}:${pad2(p.minute)}${suffix}`;
}

export function prefers12Hour(): boolean {
  try {
    const resolved = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
    }).resolvedOptions();
    return resolved.hourCycle === "h11" || resolved.hourCycle === "h12";
  } catch {
    return false;
  }
}

export function formatDateLong(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateWithYear(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatMonthDay(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatWeekday(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(date);
}

export function formatDuration(seconds: number, style: "hm" | "hms" | "compact" = "hm"): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (style === "hms") {
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
  }
  if (style === "compact") {
    if (hours > 0) return `${hours}h ${pad2(minutes)}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${secs}s`;
  }
  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function formatDecimalHours(seconds: number, digits = 2): string {
  return (Math.max(0, seconds) / 3600).toFixed(digits);
}

export function formatClock(seconds: number): string {
  return formatDuration(seconds, "hms");
}

/** Allocate an interval to local days, clipping exactly at local midnights. */
export function splitSecondsByDay(
  startMs: number,
  endMs: number,
  tz: string,
): Map<string, number> {
  const result = new Map<string, number>();
  if (endMs <= startMs) return result;
  let cursor = startMs;
  let guard = 0;
  while (cursor < endMs && guard < 400) {
    guard += 1;
    const dayKey = zonedDateKey(cursor, tz);
    let boundary = zonedDayEndMs(dayKey, tz);
    if (boundary <= cursor) boundary = cursor + DAY;
    const segmentEnd = Math.min(endMs, boundary);
    const seconds = Math.floor((segmentEnd - cursor) / 1000);
    if (seconds > 0) {
      result.set(dayKey, (result.get(dayKey) ?? 0) + seconds);
    }
    cursor = segmentEnd;
  }
  return result;
}

export function secondsOnDay(
  startMs: number,
  endMs: number,
  dayKey: string,
  tz: string,
): number {
  return splitSecondsByDay(startMs, endMs, tz).get(dayKey) ?? 0;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayName(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  return WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
}

export type ReportPreset = "today" | "this_week" | "last_week" | "this_month" | "custom";

export function reportRange(
  preset: ReportPreset,
  today: string,
  startOfWeek: StartOfWeek,
): { from: string; to: string } {
  const weekStart = startOfWeekKey(today, startOfWeek);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this_week":
      return { from: weekStart, to: addDaysKey(weekStart, 6) };
    case "last_week":
      return {
        from: addDaysKey(weekStart, -7),
        to: addDaysKey(weekStart, -1),
      };
    case "this_month": {
      const monthStart = `${today.slice(0, 8)}01`;
      return { from: monthStart, to: today };
    }
    default:
      return { from: today, to: today };
  }
}

export function formatShortcut(accelerator: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  return accelerator
    .replace(/CommandOrControl|CmdOrCtrl/gi, isMac ? "⌘" : "Ctrl")
    .replace(/Shift/gi, isMac ? "⇧" : "Shift")
    .replace(/Alt|Option/gi, isMac ? "⌥" : "Alt")
    .replace(/\+/g, isMac ? "" : "+");
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseDateKey(value);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidTimeValue(value: string): boolean {
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) return false;
  const [h, m, s] = value.split(":").map(Number);
  return (
    (h ?? 99) >= 0 &&
    (h ?? 99) <= 23 &&
    (m ?? 99) >= 0 &&
    (m ?? 99) <= 59 &&
    (s ?? 0) >= 0 &&
    (s ?? 0) <= 59
  );
}

export function zonedTimeValue(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function zonedTimeSecondsValue(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

export function nowLocalParts(tz: string): { date: string; time: string } {
  const now = Date.now();
  return { date: zonedDateKey(now, tz), time: zonedTimeValue(now, tz) };
}
