import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/Button";
import { ProjectChip } from "../../components/Badge";
import { useAppData } from "../../app/AppProvider";
import { useNavigation } from "../../app/navigation";
import { api, normalizeError } from "../../lib/ipc";
import type { TimeEntry, Timesheet, TimesheetRow } from "../../lib/types";
import {
  addDaysKey,
  formatDateLong,
  formatDuration,
  formatMonthDay,
  formatWeekday,
  startOfWeekKey,
  todayKey,
  weekKeys,
} from "../../lib/time";
import { entryTimeRange, entryTitle, pluralize } from "../../lib/format";
import { EntryDialog } from "../entries/EntryDialog";

interface CellTarget {
  date: string;
  row: TimesheetRow;
}

export function TimesheetPage() {
  const { settings, timezone, dataVersion, refreshAll } = useAppData();
  const { requestNewEntry } = useNavigation();
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeekKey(todayKey(timezone), settings.startOfWeek),
  );
  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cell, setCell] = useState<CellTarget | null>(null);
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);

  const today = todayKey(timezone);
  const days = useMemo(
    () => sheet?.days.map((day) => day.date) ?? weekKeys(weekStart),
    [sheet, weekStart],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getTimesheet(weekStart, timezone)
      .then((result) => {
        if (!cancelled) setSheet(result);
      })
      .catch((err) => {
        if (!cancelled) setError(normalizeError(err).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, timezone, dataVersion]);

  const shiftWeek = (daysToShift: number) => {
    setWeekStart((current) => addDaysKey(current, daysToShift * 7));
  };

  const cellEntries = cell ? cell.row.cells[days.indexOf(cell.date)] ?? [] : [];
  const cellSeconds = cell ? cell.row.cellSeconds[days.indexOf(cell.date)] ?? 0 : 0;
  const sheetDuration = (seconds: number) =>
    seconds === 0 ? "—" : seconds < 60 ? `${seconds}s` : formatDuration(seconds, "hm");

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Timesheet</h1>
          <div className="page-sub">
            Weekly view of the same saved entries. Click any cell to review or edit its sessions.
          </div>
        </div>
        <div className="page-header-actions">
          <div className="week-nav">
            <IconButton
              label="Previous week"
              icon={<ChevronLeft size={16} aria-hidden="true" />}
              onClick={() => shiftWeek(-1)}
            />
            <span className="week-label">
              {formatMonthDay(weekStart)} – {formatMonthDay(addDaysKey(weekStart, 6))}
            </span>
            <IconButton
              label="Next week"
              icon={<ChevronRight size={16} aria-hidden="true" />}
              onClick={() => shiftWeek(1)}
            />
            <Button
              size="sm"
              onClick={() => setWeekStart(startOfWeekKey(todayKey(timezone), settings.startOfWeek))}
            >
              This week
            </Button>
          </div>
        </div>
      </div>

      <div className="list-toolbar">
        <span className="badge">
          <CalendarDays size={11} aria-hidden="true" />
          Week starts {settings.startOfWeek === "sunday" ? "Sunday" : "Monday"}
        </span>
        <span className="spacer" />
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Week total{" "}
          <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
            {sheetDuration(sheet?.totalSeconds ?? 0)}
          </strong>
        </span>
      </div>

      {error ? (
        <div className="banner warning" role="alert">
          <div className="banner-icon">
            <AlertTriangle size={16} aria-hidden="true" />
          </div>
          <div style={{ flex: 1 }}>
            <h3>Could not load the timesheet</h3>
            <p>{error}</p>
            <div className="banner-actions">
              <Button size="sm" onClick={() => void refreshAll()}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && sheet && sheet.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CalendarDays size={28} aria-hidden="true" />}
            title="Nothing tracked this week"
            description="Start a timer, or add a manual entry to fill this week's timesheet."
            action={
              <Button
                variant="primary"
                icon={<Plus size={14} aria-hidden="true" />}
                onClick={() => requestNewEntry({ date: weekStart })}
              >
                Add manual entry
              </Button>
            }
          />
        </div>
      ) : null}

      {sheet && sheet.rows.length > 0 ? (
        <div className="sheet-wrap">
          <table className="sheet">
            <thead>
              <tr>
                <th scope="col">Project / task</th>
                {days.map((date) => {
                  const day = sheet.days.find((item) => item.date === date);
                  return (
                    <th
                      key={date}
                      scope="col"
                      className={date === today ? "today" : undefined}
                    >
                      <div>{formatWeekday(date)}</div>
                      <div style={{ fontWeight: 400, color: "var(--muted)" }}>
                        {formatMonthDay(date)}
                      </div>
                      <div
                        style={{
                          fontWeight: 500,
                          color: "var(--text-soft)",
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          marginTop: 2,
                        }}
                      >
                        {sheetDuration(day?.totalSeconds ?? 0)}
                      </div>
                    </th>
                  );
                })}
                <th scope="col" className="total">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    <div className="row-title" title={row.description || undefined}>
                      <ProjectChip name={row.projectName} color={row.projectColor} />
                      {row.projectName ? <span>·</span> : null}
                      <span>{row.description.trim() || "Untitled session"}</span>
                    </div>
                    <div className="row-sub">
                      {row.projectName ? "" : "No project · "}
                      {row.cells.reduce((sum, entries) => sum + entries.length, 0)}{" "}
                      {pluralize(
                        row.cells.reduce((sum, entries) => sum + entries.length, 0),
                        "session",
                      )}
                    </div>
                  </th>
                  {days.map((date, index) => {
                    const seconds = row.cellSeconds[index] ?? 0;
                    const entryCount = row.cells[index]?.length ?? 0;
                    return (
                      <td key={date} className="cell">
                        <button
                          type="button"
                          className={`cell-btn${seconds === 0 ? " zero" : ""}`}
                          aria-label={`${formatDateLong(date)} ${row.description || "untitled"} ${formatDuration(
                            seconds,
                            "hm",
                          )}, ${entryCount} sessions`}
                          onClick={() => setCell({ date, row })}
                        >
                          {sheetDuration(seconds)}
                          {entryCount > 1 ? (
                            <span className="badge" style={{ height: 16, fontSize: 9 }}>
                              {entryCount}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                  <td className="total" title={`${row.totalSeconds} seconds`}>
                    {sheetDuration(row.totalSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Daily totals</th>
                {days.map((date) => {
                  const day = sheet.days.find((item) => item.date === date);
                  return (
                    <td key={date} title={`${day?.totalSeconds ?? 0} seconds`}>
                      {sheetDuration(day?.totalSeconds ?? 0)}
                    </td>
                  );
                })}
                <td className="total" title={`${sheet.totalSeconds} seconds`}>
                  {sheetDuration(sheet.totalSeconds)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <Dialog
        open={Boolean(cell)}
        onClose={() => setCell(null)}
        title={cell ? `${formatDateLong(cell.date)} · ${cell.row.description.trim() || "Untitled"}` : ""}
        description={
          cell
            ? `${cell.row.projectName ?? "No project"} · ${formatDuration(
                cellSeconds,
                "hms",
              )} allocated to this day`
            : undefined
        }
        footer={
          cell ? (
            <>
              <Button
                icon={<Plus size={14} aria-hidden="true" />}
                onClick={() => {
                  requestNewEntry({
                    date: cell.date,
                    projectId: cell.row.projectId ?? undefined,
                    description: cell.row.description,
                  });
                  setCell(null);
                }}
              >
                Add entry
              </Button>
              <span className="spacer" />
              <Button onClick={() => setCell(null)}>Close</Button>
            </>
          ) : null
        }
      >
        {cellEntries.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={24} aria-hidden="true" />}
            title="No sessions on this day"
            description="Add an entry with this task and project."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cellEntries.map((entry) => (
              <div key={entry.id} className="card card-pad" style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 550, fontSize: 13 }}>
                      {entryTitle(entry)}
                    </div>
                    <div className="entry-sub">
                      <span className="entry-time">
                        {entryTimeRange(entry, timezone, settings.timeFormat)}
                      </span>
                      {entry.tags.map((tag) => (
                        <span key={tag.id} className="tag-chip">
                          {tag.name}
                        </span>
                      ))}
                      {entry.isBillable ? (
                        <span className="badge badge-billable">Billable</span>
                      ) : null}
                      {entry.source === "idle_adjustment" ? (
                        <span className="badge">Idle adjusted</span>
                      ) : null}
                    </div>
                  </div>
                  <span className="entry-duration">
                    {(entry.durationSeconds ?? 0) > 0 &&
                    (entry.durationSeconds ?? 0) < 60
                      ? `${entry.durationSeconds}s`
                      : formatDuration(entry.durationSeconds ?? 0, "hm")}
                  </span>
                  <Button size="sm" onClick={() => setEditEntry(entry)}>
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      <EntryDialog
        open={Boolean(editEntry)}
        entry={editEntry}
        onClose={() => setEditEntry(null)}
      />
    </>
  );
}
