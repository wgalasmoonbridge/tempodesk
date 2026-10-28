import { describe, expect, it } from "vitest";
import {
  addDaysKey,
  effectiveTimeZone,
  formatDuration,
  formatTime,
  reportRange,
  splitSecondsByDay,
  startOfWeekKey,
  zonedDateKey,
  zonedDateTimeToUtcMs,
  zonedDayEndMs,
  zonedDayStartMs,
  zonedTimeValue,
} from "../lib/time";

const NY = "America/New_York";
const BERLIN = "Europe/Berlin";
const UTC = "UTC";

describe("local day boundaries", () => {
  it("finds midnight in a fixed-offset zone", () => {
    expect(zonedDayStartMs("2026-10-28", UTC)).toBe(
      Date.UTC(2026, 9, 28, 0, 0, 0),
    );
    expect(zonedDayEndMs("2026-10-28", UTC)).toBe(
      Date.UTC(2026, 9, 29, 0, 0, 0),
    );
  });

  it("uses a 23-hour spring-forward day in New York", () => {
    const start = zonedDayStartMs("2026-03-08", NY);
    const end = zonedDayEndMs("2026-03-08", NY);
    expect(start).toBe(Date.UTC(2026, 2, 8, 5, 0, 0));
    expect(end).toBe(Date.UTC(2026, 2, 9, 4, 0, 0));
    expect((end - start) / 3_600_000).toBe(23);
  });

  it("uses a 25-hour fall-back day in New York", () => {
    const start = zonedDayStartMs("2026-11-01", NY);
    const end = zonedDayEndMs("2026-11-01", NY);
    expect(start).toBe(Date.UTC(2026, 10, 1, 4, 0, 0));
    expect(end).toBe(Date.UTC(2026, 10, 2, 5, 0, 0));
    expect((end - start) / 3_600_000).toBe(25);
  });

  it("formats dates and times in the requested zone", () => {
    const instant = Date.UTC(2026, 2, 8, 7, 30, 0);
    expect(zonedDateKey(instant, NY)).toBe("2026-03-08");
    expect(formatTime(instant, NY, "12h", true)).toBe("3:30:00 AM");
    expect(formatTime(instant, NY, "24h", true)).toBe("03:30:00");
    expect(zonedTimeValue(instant, NY)).toBe("03:30");
  });
});

describe("manual entry instants", () => {
  it("preserves seconds in time values", () => {
    expect(zonedDateTimeToUtcMs("2026-10-28", "09:05:37", BERLIN)).toBe(
      Date.UTC(2026, 9, 28, 8, 5, 37),
    );
    expect(zonedTimeValue(Date.UTC(2026, 9, 28, 8, 5, 37), BERLIN)).toBe("09:05");
  });

  it("converts local date/time with DST offsets", () => {
    expect(zonedDateTimeToUtcMs("2026-03-08", "01:30", NY)).toBe(
      Date.UTC(2026, 2, 8, 6, 30, 0),
    );
    expect(zonedDateTimeToUtcMs("2026-03-08", "03:30", NY)).toBe(
      Date.UTC(2026, 2, 8, 7, 30, 0),
    );
    // DST ended on Oct 25, 2026 in Berlin: 09:05 CET = 08:05 UTC.
    expect(zonedDateTimeToUtcMs("2026-10-28", "09:05", BERLIN)).toBe(
      Date.UTC(2026, 9, 28, 8, 5, 0),
    );
  });
});

describe("splitSecondsByDay", () => {
  it("splits at local midnight", () => {
    const start = zonedDateTimeToUtcMs("2026-03-10", "23:30", BERLIN);
    const end = zonedDateTimeToUtcMs("2026-03-11", "00:30", BERLIN);
    const split = splitSecondsByDay(start, end, BERLIN);
    expect(split.get("2026-03-10")).toBe(1800);
    expect(split.get("2026-03-11")).toBe(1800);
    expect([...split.values()].reduce((a, b) => a + b, 0)).toBe(3600);
  });

  it("keeps real elapsed seconds through DST", () => {
    const start = zonedDateTimeToUtcMs("2026-03-08", "00:30", NY);
    const end = zonedDateTimeToUtcMs("2026-03-08", "04:30", NY);
    expect((end - start) / 1000).toBe(3 * 3600);
    const split = splitSecondsByDay(start, end, NY);
    expect(split.get("2026-03-08")).toBe(3 * 3600);
  });

  it("allocates an overnight entry across two days", () => {
    const start = zonedDateTimeToUtcMs("2026-10-28", "22:00", UTC);
    const end = zonedDateTimeToUtcMs("2026-10-29", "02:00", UTC);
    const split = splitSecondsByDay(start, end, UTC);
    expect(split.get("2026-10-28")).toBe(7200);
    expect(split.get("2026-10-29")).toBe(7200);
  });
});

describe("calendar helpers", () => {
  it("computes week starts for Monday and Sunday", () => {
    expect(startOfWeekKey("2026-10-28", "monday")).toBe("2026-10-26");
    expect(startOfWeekKey("2026-10-28", "sunday")).toBe("2026-10-25");
    expect(startOfWeekKey("2026-11-01", "sunday")).toBe("2026-11-01");
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("builds report presets", () => {
    expect(reportRange("today", "2026-10-28", "monday")).toEqual({
      from: "2026-10-28",
      to: "2026-10-28",
    });
    expect(reportRange("this_week", "2026-10-28", "monday")).toEqual({
      from: "2026-10-26",
      to: "2026-11-01",
    });
    expect(reportRange("last_week", "2026-10-28", "monday")).toEqual({
      from: "2026-10-19",
      to: "2026-10-25",
    });
    expect(reportRange("this_month", "2026-10-28", "monday")).toEqual({
      from: "2026-10-01",
      to: "2026-10-28",
    });
  });

  it("falls back to a valid zone for unknown values", () => {
    expect(effectiveTimeZone("Not/AZone")).toBeTruthy();
    expect(effectiveTimeZone(UTC)).toBe(UTC);
  });
});

describe("duration formatting", () => {
  it("formats seconds without floating point rounding", () => {
    expect(formatDuration(0, "hms")).toBe("00:00:00");
    expect(formatDuration(3661, "hms")).toBe("01:01:01");
    expect(formatDuration(3661, "hm")).toBe("01:01");
    expect(formatDuration(3661, "compact")).toBe("1h 01m");
    expect(formatDuration(59, "compact")).toBe("59s");
    expect(formatDuration(-5, "hm")).toBe("00:00");
  });
});
