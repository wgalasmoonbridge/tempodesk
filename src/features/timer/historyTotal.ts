import type { EntryPage } from "../../lib/types";

export function historyTotal(page: EntryPage | null, now: number): number {
  if (!page) return 0;
  if (page.runningStartAtUtc === null) return page.totalSeconds;
  const end = Math.min(now, page.rangeEndUtc ?? Infinity);
  const baseline = Math.max(page.serverNowUtc, page.runningStartAtUtc);
  return page.totalSeconds + Math.max(0, Math.floor((end - baseline) / 1000));
}
