import { describe, expect, it } from "vitest";
import {
  isValidHexColor,
  validateManualForm,
  validateName,
  validateSettingsPatch,
} from "../lib/validators";

const UTC = "UTC";
const now = Date.UTC(2026, 9, 28, 12, 0, 0);

describe("validateManualForm", () => {
  it("builds a valid same-day range", () => {
    const result = validateManualForm(
      {
        date: "2026-10-28",
        startTime: "09:00",
        endTime: "10:30",
        nextDay: false,
        description: "  Work ",
      },
      UTC,
      now,
    );
    expect(result.ok).toBe(true);
    expect(result.durationSeconds).toBe(5400);
    expect(result.input?.startAtUtc).toBe(Date.UTC(2026, 9, 28, 9, 0, 0));
    expect(result.input?.endAtUtc).toBe(Date.UTC(2026, 9, 28, 10, 30, 0));
    expect(result.input?.description).toBe("Work");
  });

  it("requires the next-day flag when the end is earlier than the start", () => {
    const result = validateManualForm(
      {
        date: "2026-10-28",
        startTime: "23:30",
        endTime: "00:30",
        nextDay: false,
        description: "",
      },
      UTC,
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.needsNextDay).toBe(true);
  });

  it("supports overnight entries", () => {
    const result = validateManualForm(
      {
        date: "2026-10-28",
        startTime: "23:30",
        endTime: "00:30",
        nextDay: true,
        description: "",
      },
      UTC,
      Date.UTC(2026, 9, 29, 12, 0, 0),
    );
    expect(result.ok).toBe(true);
    expect(result.durationSeconds).toBe(3600);
    expect(result.input?.endAtUtc).toBe(Date.UTC(2026, 9, 29, 0, 30, 0));
  });

  it("accepts second-precise times for timer edits", () => {
    const result = validateManualForm(
      {
        date: "2026-10-28",
        startTime: "09:00:05",
        endTime: "09:00:08",
        nextDay: false,
        description: "short",
      },
      UTC,
      Date.UTC(2026, 9, 28, 12, 0, 0),
    );
    expect(result.ok).toBe(true);
    expect(result.durationSeconds).toBe(3);
    expect(result.startAtUtc).toBe(Date.UTC(2026, 9, 28, 9, 0, 5));
  });

  it("rejects entries longer than 24 hours", () => {
    const result = validateManualForm(
      {
        date: "2026-10-27",
        startTime: "09:00",
        endTime: "10:00",
        nextDay: true,
        description: "",
      },
      UTC,
      now,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("24 hours");
  });

  it("rejects invalid times and future starts", () => {
    const invalid = validateManualForm(
      {
        date: "2026-10-28",
        startTime: "25:00",
        endTime: "10:00",
        nextDay: false,
        description: "",
      },
      UTC,
      now,
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);

    const future = validateManualForm(
      {
        date: "2026-10-29",
        startTime: "09:00",
        endTime: "10:00",
        nextDay: false,
        description: "",
      },
      UTC,
      now,
    );
    expect(future.ok).toBe(false);
    expect(future.errors.join(" ")).toContain("future");
  });
});

describe("names and colors", () => {
  it("validates names", () => {
    expect(validateName("  Acme ", "Client")).toBeNull();
    expect(validateName("", "Client")).toContain("required");
    expect(validateName("x".repeat(121), "Client")).toContain("120");
    expect(validateName("a\nb", "Client")).toContain("line breaks");
  });

  it("validates hex colors", () => {
    expect(isValidHexColor("#4f46e5")).toBe(true);
    expect(isValidHexColor("#4F46E5")).toBe(true);
    expect(isValidHexColor("indigo")).toBe(false);
    expect(isValidHexColor("#fff")).toBe(false);
  });
});

describe("settings validation", () => {
  it("checks idle threshold and shortcuts", () => {
    expect(validateSettingsPatch({ idleThresholdMinutes: 0 })).not.toBeNull();
    expect(validateSettingsPatch({ idleThresholdMinutes: 5 })).toBeNull();
    expect(validateSettingsPatch({ timezone: "Not/AZone" })).not.toBeNull();
    expect(validateSettingsPatch({ timezone: "America/New_York" })).toBeNull();
    expect(validateSettingsPatch({ openShortcut: "  " })).not.toBeNull();
  });
});
