import { describe, expect, it } from "vitest";
import { historyTotal } from "../features/timer/historyTotal";
import type { EntryPage } from "../lib/types";

const page: EntryPage = { entries: [], totalCount: 1205, totalSeconds: 72300, serverNowUtc: 10000, runningStartAtUtc: null, rangeEndUtc: null };

describe("full history totals", () => {
  it("preserves totals independent of the loaded page", () => {
    expect(historyTotal(page, 20000)).toBe(72300);
  });
  it("advances matching running time and clips it at the range end", () => {
    const running = { ...page, runningStartAtUtc: 1000, rangeEndUtc: 15000 };
    expect(historyTotal(running, 12000)).toBe(72302);
    expect(historyTotal(running, 20000)).toBe(72305);
    expect(historyTotal(running, 9000)).toBe(72300);
  });
});
