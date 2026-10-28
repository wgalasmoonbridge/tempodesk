import { useEffect, useState } from "react";

/** Re-render on an interval (display-only clock). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Monotonic elapsed time for the running timer. Anchored to the last persisted server instant
 * so wall-clock adjustments do not change the displayed counter.
 */
export function useElapsed(
  startAtUtc: number | null,
  serverNowUtc: number | null,
): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startAtUtc === null) {
      setElapsed(0);
      return;
    }
    const anchorNow = serverNowUtc ?? Date.now();
    const base = performance.now() - Math.max(0, anchorNow - startAtUtc);
    const tick = () => {
      setElapsed(Math.max(0, Math.floor((performance.now() - base) / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [startAtUtc, serverNowUtc]);

  return elapsed;
}
