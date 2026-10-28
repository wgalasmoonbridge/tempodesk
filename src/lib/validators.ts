import type { ManualEntryInput, SettingsPatch } from "./types";
import {
  addDaysKey,
  isValidDateKey,
  isValidTimeValue,
  isValidTimeZone,
  zonedDateTimeToUtcMs,
} from "./time";

export const MAX_MANUAL_SECONDS = 24 * 60 * 60;

export interface ManualFormValues {
  date: string;
  startTime: string;
  endTime: string;
  nextDay: boolean;
  description: string;
}

export interface ManualValidation {
  ok: boolean;
  errors: string[];
  needsNextDay: boolean;
  input: ManualEntryInput | null;
  durationSeconds: number;
  startAtUtc: number | null;
  endAtUtc: number | null;
}

export function validateManualForm(
  values: ManualFormValues,
  timezone: string,
  now = Date.now(),
): ManualValidation {
  const errors: string[] = [];
  if (!isValidDateKey(values.date)) {
    errors.push("Choose a valid date.");
  }
  if (!isValidTimeValue(values.startTime)) {
    errors.push("Start time must be a valid time such as 09:30.");
  }
  if (!isValidTimeValue(values.endTime)) {
    errors.push("End time must be a valid time such as 17:15.");
  }
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      needsNextDay: false,
      input: null,
      durationSeconds: 0,
      startAtUtc: null,
      endAtUtc: null,
    };
  }

  const startAtUtc = zonedDateTimeToUtcMs(values.date, values.startTime, timezone);
  const endDate = values.nextDay ? addDaysKey(values.date, 1) : values.date;
  const endAtUtc = zonedDateTimeToUtcMs(endDate, values.endTime, timezone);

  if (endAtUtc <= startAtUtc) {
    return {
      ok: false,
      errors: [
        "The end time is before the start time. Tick “Ends next day” for overnight work.",
      ],
      needsNextDay: true,
      input: null,
      durationSeconds: 0,
      startAtUtc,
      endAtUtc,
    };
  }

  const durationSeconds = Math.floor((endAtUtc - startAtUtc) / 1000);
  if (durationSeconds > MAX_MANUAL_SECONDS) {
    errors.push("A manual entry cannot be longer than 24 hours.");
  }
  if (startAtUtc > now + 60_000) {
    errors.push("The start time cannot be in the future.");
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      needsNextDay: false,
      input: null,
      durationSeconds,
      startAtUtc,
      endAtUtc,
    };
  }

  return {
    ok: true,
    errors: [],
    needsNextDay: false,
    durationSeconds,
    startAtUtc,
    endAtUtc,
    input: {
      description: values.description.trim(),
      startAtUtc,
      endAtUtc,
    },
  };
}

export function validateName(
  value: string,
  label: string,
  maxLength = 120,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return `${label} name is required.`;
  if (trimmed.length > maxLength) {
    return `${label} name must be ${maxLength} characters or fewer.`;
  }
  if (/[\n\r\t]/.test(trimmed)) {
    return `${label} name cannot contain line breaks or tabs.`;
  }
  return null;
}

export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function validateSettingsPatch(patch: SettingsPatch): string | null {
  if (
    patch.timezone &&
    patch.timezone !== "system" &&
    !isValidTimeZone(patch.timezone)
  ) {
    return "Choose a valid time zone.";
  }
  if (
    patch.idleThresholdMinutes !== undefined &&
    (patch.idleThresholdMinutes < 1 || patch.idleThresholdMinutes > 60)
  ) {
    return "Idle threshold must be between 1 and 60 minutes.";
  }
  if (patch.openShortcut !== undefined && patch.openShortcut.trim().length === 0) {
    return "The open/hide shortcut cannot be empty.";
  }
  if (patch.toggleShortcut !== undefined && patch.toggleShortcut.trim().length === 0) {
    return "The timer shortcut cannot be empty.";
  }
  return null;
}
