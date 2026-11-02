import type { TimeEntry } from "../../lib/types";
import { zonedDayEndMs, zonedDayStartMs, zonedParts } from "../../lib/time";

export const CALENDAR_DAY_MINUTES = 24 * 60;
export const CALENDAR_SNAP_MINUTES = 15;

export interface CalendarSelection {
  startMinute: number;
  endMinute: number;
}

export interface CalendarSegment {
  key: string;
  date: string;
  entry: TimeEntry;
  startMinute: number;
  endMinute: number;
  startsBeforeDay: boolean;
  endsAfterDay: boolean;
}

export function clampCalendarMinute(value: number): number {
  return Math.min(CALENDAR_DAY_MINUTES, Math.max(0, value));
}

export function minuteFromPointer(offsetY: number, height: number): number {
  if (height <= 0) return 0;
  return clampCalendarMinute((offsetY / height) * CALENDAR_DAY_MINUTES);
}

export function snapCalendarMinute(value: number): number {
  return clampCalendarMinute(
    Math.round(value / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES,
  );
}

export function calendarSelection(
  anchorMinute: number,
  currentMinute: number,
): CalendarSelection {
  const anchor = snapCalendarMinute(anchorMinute);
  const current = snapCalendarMinute(currentMinute);
  if (anchor === current) {
    const startMinute = Math.min(anchor, CALENDAR_DAY_MINUTES - 60);
    return { startMinute, endMinute: Math.min(startMinute + 60, CALENDAR_DAY_MINUTES) };
  }
  const startMinute = Math.min(anchor, current);
  const endMinute = Math.max(anchor, current);
  return {
    startMinute,
    endMinute: Math.max(
      startMinute + CALENDAR_SNAP_MINUTES,
      Math.min(endMinute, CALENDAR_DAY_MINUTES),
    ),
  };
}

export function minuteToTimeValue(minute: number): string {
  const safe = clampCalendarMinute(minute);
  if (safe === CALENDAR_DAY_MINUTES) return "00:00";
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function wallMinute(ms: number, timezone: string): number {
  const parts = zonedParts(ms, timezone);
  return parts.hour * 60 + parts.minute + parts.second / 60;
}

export function calendarSegments(
  entries: TimeEntry[],
  dates: string[],
  timezone: string,
  now = Date.now(),
): CalendarSegment[] {
  const segments: CalendarSegment[] = [];
  for (const date of dates) {
    const dayStart = zonedDayStartMs(date, timezone);
    const dayEnd = zonedDayEndMs(date, timezone);
    for (const entry of entries) {
      const entryEnd = entry.endAtUtc ?? now;
      const segmentStart = Math.max(entry.startAtUtc, dayStart);
      const segmentEnd = Math.min(entryEnd, dayEnd);
      if (segmentEnd <= segmentStart) continue;

      const startsBeforeDay = entry.startAtUtc < dayStart;
      const endsAfterDay = entryEnd > dayEnd;
      const startMinute = startsBeforeDay ? 0 : wallMinute(segmentStart, timezone);
      let endMinute = segmentEnd >= dayEnd ? CALENDAR_DAY_MINUTES : wallMinute(segmentEnd, timezone);
      if (endMinute <= startMinute) {
        const elapsedMinutes = Math.max(1, (segmentEnd - segmentStart) / 60_000);
        endMinute = Math.min(CALENDAR_DAY_MINUTES, startMinute + elapsedMinutes);
      }

      segments.push({
        key: `${entry.id}:${date}`,
        date,
        entry,
        startMinute,
        endMinute,
        startsBeforeDay,
        endsAfterDay,
      });
    }
  }
  return segments;
}
