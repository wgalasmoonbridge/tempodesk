import type { TimeEntry, TimeFormat } from "./types";
import { addDaysKey, formatDuration, formatTime, zonedDateKey } from "./time";

export function entryTitle(entry: Pick<TimeEntry, "description">): string {
  return entry.description.trim() || "Untitled session";
}

export function entryTimeRange(
  entry: TimeEntry,
  timezone: string,
  preference: TimeFormat,
  now = Date.now(),
): string {
  const withSeconds =
    entry.running ||
    (entry.durationSeconds !== null && entry.durationSeconds < 60);
  const start = formatTime(entry.startAtUtc, timezone, preference, withSeconds);
  if (entry.running) {
    const elapsed = Math.max(0, now - entry.startAtUtc) / 1000;
    return `${start} – now · ${formatDuration(elapsed, "hms")}`;
  }
  const end = entry.endAtUtc ?? entry.startAtUtc;
  const crossesMidnight =
    zonedDateKey(entry.startAtUtc, timezone) !== zonedDateKey(end, timezone);
  const endLabel = formatTime(end, timezone, preference, withSeconds);
  return `${start} – ${endLabel}${crossesMidnight ? " (+1)" : ""}`;
}

export function entryClientLabel(entry: TimeEntry): string | null {
  return entry.clientName ?? null;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function clampText(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function dayLabel(dateKey: string, today: string): string {
  if (dateKey === today) return "Today";
  if (dateKey === addDaysKey(today, -1)) return "Yesterday";
  return "";
}
