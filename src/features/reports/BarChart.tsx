import { formatDuration, formatMonthDay } from "../../lib/time";
import type { DailyTotal } from "../../lib/types";

export function BarChart({ daily }: { daily: DailyTotal[] }) {
  if (daily.length === 0) return null;
  const max = Math.max(1, ...daily.map((day) => day.seconds));
  const labelEvery = Math.max(1, Math.ceil(daily.length / 14));
  const total = daily.reduce((sum, day) => sum + day.seconds, 0);
  const format = (seconds: number) =>
    seconds > 0 && seconds < 60
      ? `${seconds}s`
      : formatDuration(seconds, "hm");

  return (
    <div
      className="bar-chart"
      role="img"
      aria-label={`Daily tracked time bar chart, ${daily.length} days, total ${formatDuration(
        total,
        "compact",
      )}.`}
    >
      {daily.map((day, index) => {
        const height = day.seconds === 0 ? 0 : Math.max(2, (day.seconds / max) * 100);
        const showLabel = index % labelEvery === 0 || index === daily.length - 1;
        return (
          <div
            key={day.date}
            className="bar-col"
            title={`${formatMonthDay(day.date)} · ${format(
              day.seconds,
            )} (${format(day.billableSeconds)} billable)`}
          >
            <span className="bar-value">
              {day.seconds > 0 && (index === 0 || day.seconds === max)
                ? format(day.seconds)
                : ""}
            </span>
            <div className="bar-stack">
              {day.seconds > 0 ? (
                <div
                  className="bar"
                  style={{ height: `${height}%` }}
                  aria-hidden="true"
                >
                  {day.billableSeconds > 0 ? (
                    <div
                      className="bar billable"
                      style={{
                        height: `${(day.billableSeconds / day.seconds) * 100}%`,
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
            <span className="bar-label">{showLabel ? formatMonthDay(day.date) : ""}</span>
          </div>
        );
      })}
    </div>
  );
}
