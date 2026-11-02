import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { useAppData } from "../../app/AppProvider";
import { Button, IconButton } from "../../components/Button";
import { SegmentedControl } from "../../components/SegmentedControl";
import { api, normalizeError } from "../../lib/ipc";
import type { TimeEntry } from "../../lib/types";
import {
  addDaysKey,
  formatDateLong,
  formatMonthDay,
  formatTime,
  formatWeekday,
  prefers12Hour,
  startOfWeekKey,
  todayKey,
  weekKeys,
} from "../../lib/time";
import { entryTitle } from "../../lib/format";
import { EntryDialog } from "../entries/EntryDialog";
import {
  CALENDAR_DAY_MINUTES,
  calendarSegments,
  calendarSelection,
  minuteFromPointer,
  minuteToTimeValue,
} from "./calendarLayout";

type CalendarMode = "day" | "week";

interface NewEntryDefaults {
  date: string;
  startTime: string;
  endTime: string;
  nextDay: boolean;
}

interface DragState {
  pointerId: number;
  date: string;
  anchorMinute: number;
  currentMinute: number;
}

function hourLabel(hour: number, preference: "auto" | "12h" | "24h"): string {
  const use12 = preference === "12h" || (preference === "auto" && prefers12Hour());
  if (!use12) return `${String(hour).padStart(2, "0")}:00`;
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return `${hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

function blockTime(entry: TimeEntry, timezone: string, preference: "auto" | "12h" | "24h", now: number): string {
  const end = entry.endAtUtc ?? now;
  return `${formatTime(entry.startAtUtc, timezone, preference)}–${
    entry.running ? "now" : formatTime(end, timezone, preference)
  }`;
}

function layoutOverlaps<T extends { startMinute: number; endMinute: number }>(items: T[]) {
  const sorted = [...items].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );
  const placed: { item: T; lane: number; group: number }[] = [];
  const groupLaneCounts = new Map<number, number>();
  let group = 0;
  let groupEnd = -1;
  let laneEnds: number[] = [];

  for (const item of sorted) {
    if (item.startMinute >= groupEnd) {
      group += 1;
      groupEnd = item.endMinute;
      laneEnds = [];
    } else {
      groupEnd = Math.max(groupEnd, item.endMinute);
    }
    let lane = laneEnds.findIndex((endMinute) => endMinute <= item.startMinute);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = item.endMinute;
    groupLaneCounts.set(group, Math.max(groupLaneCounts.get(group) ?? 1, laneEnds.length));
    placed.push({ item, lane, group });
  }

  return placed.map(({ item, lane, group: itemGroup }) => ({
    item,
    lane,
    laneCount: groupLaneCounts.get(itemGroup) ?? 1,
  }));
}

export function CalendarPage() {
  const { settings, timezone, dataVersion, refreshAll } = useAppData();
  const today = todayKey(timezone);
  const [mode, setMode] = useState<CalendarMode>("week");
  const [anchorDate, setAnchorDate] = useState(today);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [newEntry, setNewEntry] = useState<NewEntryDefaults | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);

  const weekStart = startOfWeekKey(anchorDate, settings.startOfWeek);
  const dates = useMemo(
    () => (mode === "day" ? [anchorDate] : weekKeys(weekStart)),
    [mode, anchorDate, weekStart],
  );
  const dateFrom = dates[0] ?? anchorDate;
  const dateTo = dates[dates.length - 1] ?? anchorDate;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listEntries({
        dateFrom,
        dateTo,
        timezone,
        includeRunning: true,
        sort: "start_asc",
        limit: 10_000,
      })
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((loadError) => {
        if (!cancelled) setError(normalizeError(loadError).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, timezone, dataVersion]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.scrollTop = 7 * 60;
  }, [mode]);

  const segments = useMemo(
    () => calendarSegments(entries, dates, timezone, now),
    [entries, dates, timezone, now],
  );

  const openSelection = (date: string, anchorMinute: number, currentMinute: number) => {
    const selection = calendarSelection(anchorMinute, currentMinute);
    setNewEntry({
      date,
      startTime: minuteToTimeValue(selection.startMinute),
      endTime: minuteToTimeValue(selection.endMinute),
      nextDay: selection.endMinute === CALENDAR_DAY_MINUTES,
    });
  };

  const shift = (direction: number) => {
    setAnchorDate((current) => addDaysKey(current, direction * (mode === "day" ? 1 : 7)));
  };

  const rangeLabel =
    mode === "day"
      ? formatDateLong(anchorDate)
      : `${formatMonthDay(weekStart)} – ${formatMonthDay(addDaysKey(weekStart, 6))}`;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>, date: string) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest(".calendar-entry"))
    ) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = minuteFromPointer(event.clientY - rect.top, rect.height);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointerId: event.pointerId, date, anchorMinute: minute, currentMinute: minute });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>, date: string) => {
    if (!drag || drag.pointerId !== event.pointerId || drag.date !== date) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = minuteFromPointer(event.clientY - rect.top, rect.height);
    setDrag((current) => (current ? { ...current, currentMinute: minute } : current));
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>, date: string) => {
    if (!drag || drag.pointerId !== event.pointerId || drag.date !== date) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = minuteFromPointer(event.clientY - rect.top, rect.height);
    event.currentTarget.releasePointerCapture(event.pointerId);
    openSelection(date, drag.anchorMinute, minute);
    setDrag(null);
  };

  const dragSelection = drag
    ? calendarSelection(drag.anchorMinute, drag.currentMinute)
    : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Calendar</h1>
          <div className="page-sub">
            Drag across empty time to create an entry. Select a saved block to edit it.
          </div>
        </div>
        <div className="page-header-actions">
          <SegmentedControl
            value={mode}
            label="Calendar view"
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
            ]}
            onChange={(value) => setMode(value)}
          />
          <div className="week-nav">
            <IconButton
              label={mode === "day" ? "Previous day" : "Previous week"}
              icon={<ChevronLeft size={16} aria-hidden="true" />}
              onClick={() => shift(-1)}
            />
            <span className="week-label">{rangeLabel}</span>
            <IconButton
              label={mode === "day" ? "Next day" : "Next week"}
              icon={<ChevronRight size={16} aria-hidden="true" />}
              onClick={() => shift(1)}
            />
          </div>
          <Button size="sm" onClick={() => setAnchorDate(today)}>
            Today
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => openSelection(anchorDate, 9 * 60, 10 * 60)}
          >
            Add entry
          </Button>
        </div>
      </div>

      {error ? (
        <div className="banner warning" role="alert">
          <div className="banner-icon">
            <AlertTriangle size={16} aria-hidden="true" />
          </div>
          <div style={{ flex: 1 }}>
            <h3>Could not load the calendar</h3>
            <p>{error}</p>
            <div className="banner-actions">
              <Button size="sm" onClick={() => void refreshAll()}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="calendar-toolbar" role="status">
        <span className="badge">
          <CalendarDays size={11} aria-hidden="true" />
          {loading ? "Loading entries…" : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
        </span>
        <span>15-minute snap · overlaps remain visible and are allowed</span>
      </div>

      <div
        ref={scrollRef}
        className={`calendar-scroll calendar-${mode}`}
        aria-label={`${mode} calendar for ${rangeLabel}`}
      >
        <div
          className="calendar-grid"
          style={{ gridTemplateColumns: `58px repeat(${dates.length}, minmax(${mode === "day" ? "560px" : "118px"}, 1fr))` }}
        >
          <div className="calendar-corner" />
          {dates.map((date) => (
            <div key={`head:${date}`} className={`calendar-day-head${date === today ? " today" : ""}`}>
              <button type="button" onClick={() => { setAnchorDate(date); setMode("day"); }}>
                <span>{formatWeekday(date)}</span>
                <strong>{formatMonthDay(date)}</strong>
              </button>
            </div>
          ))}

          <div className="calendar-time-axis" aria-hidden="true">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} style={{ top: hour * 60 }}>
                {hourLabel(hour, settings.timeFormat)}
              </span>
            ))}
          </div>

          {dates.map((date) => {
            const daySegments = layoutOverlaps(
              segments.filter((segment) => segment.date === date),
            );
            const currentParts = date === today ? (() => {
              const instant = new Date(now);
              const label = formatTime(now, timezone, "24h", true);
              const [hours, minutes, seconds] = label.split(":").map(Number);
              return (hours ?? instant.getHours()) * 60 + (minutes ?? 0) + (seconds ?? 0) / 60;
            })() : null;
            return (
              <div
                key={date}
                className={`calendar-day-column${date === today ? " today" : ""}`}
                onPointerDown={(event) => onPointerDown(event, date)}
                onPointerMove={(event) => onPointerMove(event, date)}
                onPointerUp={(event) => finishDrag(event, date)}
                onPointerCancel={() => setDrag(null)}
              >
                {daySegments.map(({ item: segment, lane, laneCount }) => {
                  const durationMinutes = Math.max(1, segment.endMinute - segment.startMinute);
                  const color = segment.entry.projectColor ?? "var(--accent)";
                  return (
                    <button
                      key={segment.key}
                      type="button"
                      className={`calendar-entry${segment.entry.running ? " running" : ""}`}
                      style={{
                        top: segment.startMinute,
                        left: `calc(${(lane / laneCount) * 100}% + 4px)`,
                        right: "auto",
                        width: `calc(${100 / laneCount}% - 8px)`,
                        height: Math.max(20, durationMinutes),
                        borderLeftColor: color,
                        background: `color-mix(in srgb, ${color} 18%, var(--surface))`,
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => setEditEntry(segment.entry)}
                      title={`${entryTitle(segment.entry)} · ${blockTime(segment.entry, timezone, settings.timeFormat, now)}`}
                    >
                      <strong>{entryTitle(segment.entry)}</strong>
                      <span>{blockTime(segment.entry, timezone, settings.timeFormat, now)}</span>
                      {durationMinutes >= 42 && segment.entry.projectName ? (
                        <span>{segment.entry.projectName}</span>
                      ) : null}
                      {segment.startsBeforeDay ? <i>Continued from previous day</i> : null}
                      {segment.endsAfterDay ? <i>Continues next day</i> : null}
                    </button>
                  );
                })}

                {drag?.date === date && dragSelection ? (
                  <div
                    className="calendar-selection"
                    style={{
                      top: dragSelection.startMinute,
                      height: Math.max(15, dragSelection.endMinute - dragSelection.startMinute),
                    }}
                    aria-hidden="true"
                  >
                    {minuteToTimeValue(dragSelection.startMinute)}–{minuteToTimeValue(dragSelection.endMinute)}
                  </div>
                ) : null}

                {currentParts !== null ? (
                  <div className="calendar-now" style={{ top: currentParts }} aria-hidden="true">
                    <span />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <EntryDialog
        open={Boolean(newEntry)}
        onClose={() => setNewEntry(null)}
        defaultDate={newEntry?.date}
        defaultStartTime={newEntry?.startTime}
        defaultEndTime={newEntry?.endTime}
        defaultNextDay={newEntry?.nextDay}
      />
      <EntryDialog
        open={Boolean(editEntry)}
        entry={editEntry}
        onClose={() => setEditEntry(null)}
      />
    </>
  );
}
