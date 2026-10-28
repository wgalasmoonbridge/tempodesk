import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Inbox,
  ListChecks,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { Field } from "../../components/Field";
import { TagPicker } from "../../components/TagPicker";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { useNavigation } from "../../app/navigation";
import { api, normalizeError } from "../../lib/ipc";
import type {
  EntryFilter,
  StartTimerInput,
  TimeEntry,
} from "../../lib/types";
import {
  addDaysKey,
  formatDateLong,
  formatDateWithYear,
  formatDuration,
  splitSecondsByDay,
  startOfWeekKey,
  todayKey,
  zonedDateKey,
} from "../../lib/time";
import { useNow } from "../../lib/hooks";
import { RunningCard } from "./RunningCard";
import { EntryRow } from "./EntryRow";
import { IdleReviewBanner } from "./IdleReviewBanner";
import { EntryDialog } from "../entries/EntryDialog";
import { SummaryPanel } from "../summary/SummaryPanel";
import { dayLabel } from "../../lib/format";

type Preset = "last7" | "today" | "week" | "all" | "custom";

interface DaySegment {
  entry: TimeEntry;
  seconds: number;
  continuedFromPrevious: boolean;
  continuesNext: boolean;
}

interface DayGroup {
  date: string;
  total: number;
  entries: DaySegment[];
}

export function TrackerPage() {
  const {
    status,
    projects,
    clients,
    tags,
    settings,
    timezone,
    dataVersion,
    refreshAll,
  } = useAppData();
  const { requestNewEntry, search, setSearch } = useNavigation();
  const { pushToast } = useToast();
  const now = useNow(1000);
  const today = todayKey(timezone);

  const [preset, setPreset] = useState<Preset>("last7");
  const [from, setFrom] = useState(() => addDaysKey(today, -6));
  const [to, setTo] = useState(() => today);
  const [projectId, setProjectId] = useState("");
  const [clientId, setClientId] = useState("");
  const [tagId, setTagId] = useState("");
  const [billable, setBillable] = useState<"" | "yes" | "no">("");

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TimeEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [resumeTarget, setResumeTarget] = useState<TimeEntry | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<StartTimerInput | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchBusy, setSwitchBusy] = useState(false);

  const applyPreset = useCallback(
    (next: Preset) => {
      setPreset(next);
      if (next === "last7") {
        const end = todayKey(timezone);
        setFrom(addDaysKey(end, -6));
        setTo(end);
      } else if (next === "today") {
        const end = todayKey(timezone);
        setFrom(end);
        setTo(end);
      } else if (next === "week") {
        const start = startOfWeekKey(todayKey(timezone), settings.startOfWeek);
        setFrom(start);
        setTo(addDaysKey(start, 6));
      }
    },
    [settings.startOfWeek, timezone],
  );

  // Keep relative date ranges correct if the app stays open across local midnight.
  useEffect(() => {
    if (preset === "last7" || preset === "today" || preset === "week") {
      applyPreset(preset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, preset, timezone, settings.startOfWeek]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filter: EntryFilter = {
      dateFrom: preset === "all" ? null : from || null,
      dateTo: preset === "all" ? null : to || null,
      timezone,
      projectId: projectId || null,
      clientId: clientId || null,
      tagIds: tagId ? [tagId] : null,
      billable: billable === "" ? null : billable === "yes",
      search: search.trim() || null,
      limit: 1000,
      sort: "start_desc",
      includeRunning: true,
    };
    api
      .listEntries(filter)
      .then((result) => {
        if (!cancelled) setEntries(result);
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
  }, [
    preset,
    from,
    to,
    projectId,
    clientId,
    tagId,
    billable,
    search,
    timezone,
    dataVersion,
  ]);

  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>();
    for (const entry of entries) {
      const end = Math.max(
        entry.running ? now : (entry.endAtUtc ?? entry.startAtUtc),
        entry.startAtUtc,
      );
      const startKey = zonedDateKey(entry.startAtUtc, timezone);
      const endKey = zonedDateKey(end, timezone);
      const split = splitSecondsByDay(entry.startAtUtc, end, timezone);
      for (const [date, seconds] of split) {
        if (preset !== "all") {
          if (from && date < from) continue;
          if (to && date > to) continue;
        }
        const group = map.get(date) ?? { date, total: 0, entries: [] };
        group.total += seconds;
        group.entries.push({
          entry,
          seconds,
          continuedFromPrevious: date !== startKey,
          continuesNext: date !== endKey,
        });
        map.set(date, group);
      }
    }
    const list = [...map.values()];
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const group of list) {
      group.entries.sort((a, b) => a.entry.startAtUtc - b.entry.startAtUtc);
    }
    return list;
  }, [entries, now, timezone, preset, from, to]);

  const rangeTotal = groups.reduce((sum, group) => sum + group.total, 0);
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIds.has(entry.id)),
    [entries, selectedIds],
  );
  const selectableIds = useMemo(
    () => entries.filter((entry) => !entry.running).map((entry) => entry.id),
    [entries],
  );
  const allVisibleSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const selectedSeconds = selectedEntries.reduce(
    (sum, entry) => sum + (entry.durationSeconds ?? 0),
    0,
  );

  // Drop selections that no longer exist after a delete/restore/filter refresh.
  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) return previous;
      const available = new Set(entries.map((entry) => entry.id));
      const next = new Set([...previous].filter((id) => available.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [entries]);

  const liveTodaySeconds = useMemo(() => {
    const base = status?.todaySeconds ?? 0;
    if (!status?.activeEntry) return base;
    return base + Math.max(0, Math.floor((now - status.serverNowUtc) / 1000));
  }, [status, now]);

  const hasFilters =
    preset !== "last7" ||
    Boolean(projectId || clientId || tagId || billable || search.trim());

  const clearFilters = () => {
    setProjectId("");
    setClientId("");
    setTagId("");
    setBillable("");
    setSearch("");
    applyPreset("last7");
  };

  const start = async (input: StartTimerInput) => {
    setStarting(true);
    try {
      await api.startTimer(input);
    } catch (err) {
      const normalized = normalizeError(err);
      if (normalized.code === "active_timer_exists") {
        setPendingSwitch(input);
      } else {
        pushToast({
          title: "Could not start the timer",
          message: normalized.message,
          tone: "error",
        });
      }
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      const entry = await api.stopTimer();
      pushToast({
        title: "Timer stopped",
        message: `${formatDuration(entry.durationSeconds ?? 0, "compact")} recorded${
          entry.projectName ? ` for ${entry.projectName}` : ""
        }.`,
        tone: "success",
      });
    } catch (err) {
      pushToast({
        title: "Could not stop the timer",
        message: normalizeError(err).message,
        tone: "error",
      });
    } finally {
      setStopping(false);
    }
  };

  const doResume = async (entry: TimeEntry, switchActive: boolean) => {
    setResumeBusy(true);
    try {
      await api.resumeEntry(entry.id, switchActive);
      pushToast({
        title: "New timer started from entry",
        message: switchActive
          ? "The previous timer was stopped and the original entry is unchanged."
          : "The original entry is unchanged.",
        tone: "success",
      });
      setResumeTarget(null);
    } catch (err) {
      pushToast({
        title: "Could not resume this entry",
        message: normalizeError(err).message,
        tone: "error",
      });
    } finally {
      setResumeBusy(false);
    }
  };

  const confirmSwitch = async () => {
    if (!pendingSwitch || starting) return;
    setStarting(true);
    try {
      await api.switchTimer(pendingSwitch);
      pushToast({
        title: "Switched tasks",
        message: "The previous timer was stopped and the new one started.",
        tone: "success",
      });
    } catch (err) {
      pushToast({
        title: "Could not switch the timer",
        message: normalizeError(err).message,
        tone: "error",
      });
    } finally {
      setStarting(false);
      setPendingSwitch(null);
    }
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (entry: TimeEntry) => {
    if (entry.running) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(selectableIds));
  };

  const confirmBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const result = await api.deleteEntries(ids);
      setBulkDeleteOpen(false);
      exitSelection();
      if (result.deletedCount === 0) {
        pushToast({
          title: "No entries were deleted",
          message:
            result.skipped.length > 0
              ? "The selected entries were already deleted, running, or no longer available."
              : "Nothing changed.",
          tone: "warning",
        });
      } else {
        const skippedMessage =
          result.skipped.length > 0
            ? ` ${result.skipped.length} ${
                result.skipped.length === 1 ? "entry was" : "entries were"
              } skipped (running or already deleted).`
            : "";
        pushToast({
          title: `${result.deletedCount} ${
            result.deletedCount === 1 ? "entry" : "entries"
          } deleted`,
          message: `Removed from totals and reports.${skippedMessage} You can undo this batch.`,
          tone: result.skipped.length > 0 ? "warning" : "success",
          duration: 10000,
          action: {
            label: "Undo",
            onClick: () => {
              void api
                .restoreEntries(result.deletedIds)
                .then((restored) => {
                  pushToast({
                    title: `${restored.restoredCount} ${
                      restored.restoredCount === 1 ? "entry" : "entries"
                    } restored`,
                    message:
                      restored.skipped.length > 0
                        ? `${restored.skipped.length} could not be restored.`
                        : "Totals and reports include them again.",
                    tone: restored.skipped.length > 0 ? "warning" : "success",
                  });
                  return refreshAll();
                })
                .catch((err) =>
                  pushToast({
                    title: "Could not restore the deleted entries",
                    message: normalizeError(err).message,
                    tone: "error",
                  }),
                );
            },
          },
        });
      }
      await refreshAll();
    } catch (err) {
      pushToast({
        title: "Bulk delete failed",
        message: normalizeError(err).message,
        tone: "error",
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    const target = deleteTarget;
    try {
      await api.deleteEntry(target.id);
      setDeleteTarget(null);
      pushToast({
        title: "Entry deleted",
        message: "You can undo this from the notification.",
        tone: "success",
        action: {
          label: "Undo",
          onClick: () => {
            void api
              .restoreEntry(target.id)
              .then(() => refreshAll())
              .catch((err) =>
                pushToast({
                  title: "Could not restore the entry",
                  message: normalizeError(err).message,
                  tone: "error",
                }),
              );
          },
        },
      });
    } catch (err) {
      pushToast({
        title: "Could not delete the entry",
        message: normalizeError(err).message,
        tone: "error",
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Time Tracker</h1>
          <div className="page-sub">
            One timer per device. Starting a new session can stop the current one atomically.
          </div>
        </div>
        <div className="page-header-actions">
          <Button
            icon={<Sparkles size={14} aria-hidden="true" />}
            onClick={() => setSummaryOpen(true)}
          >
            Summarize today
          </Button>
        </div>
      </div>

      <RunningCard
        active={status?.activeEntry ?? null}
        serverNowUtc={status?.serverNowUtc ?? null}
        todaySeconds={liveTodaySeconds}
        timezone={timezone}
        timeFormat={settings.timeFormat}
        projects={projects}
        tags={tags}
        starting={starting}
        stopping={stopping}
        onStart={(input) => void start(input)}
        onStop={() => void stop()}
        onEdit={(entry) => setEditEntry(entry)}
        onSwitch={() => setSwitchOpen(true)}
      />

      <IdleReviewBanner />

      <section aria-labelledby="history-heading">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <h2 id="history-heading" style={{ fontSize: 15 }}>
            History
          </h2>
          <span className="badge">{entries.length} sessions</span>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Button
              size="sm"
              variant="ghost"
              icon={<ListChecks size={14} aria-hidden="true" />}
              onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
              disabled={entries.length === 0}
            >
              {selectionMode ? "Exit selection" : "Select"}
            </Button>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              Range total{" "}
              <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                {formatDuration(rangeTotal, "hm")}
              </strong>
            </span>
          </div>
        </div>

        <div className="list-toolbar" style={{ marginBottom: 10 }} role="search" aria-label="Filter time entries">
          <label className="sr-only" htmlFor="history-range">
            Date range
          </label>
          <select
            id="history-range"
            className="select"
            value={preset}
            onChange={(event) => applyPreset(event.target.value as Preset)}
          >
            <option value="last7">Last 7 days</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="all">All time</option>
            <option value="custom">Custom…</option>
          </select>

          {preset === "custom" ? (
            <>
              <label className="sr-only" htmlFor="history-from">
                From date
              </label>
              <input
                id="history-from"
                className="input"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <label className="sr-only" htmlFor="history-to">
                To date
              </label>
              <input
                id="history-to"
                className="input"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </>
          ) : null}

          <label className="sr-only" htmlFor="history-project">
            Filter by project
          </label>
          <select
            id="history-project"
            className="select"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="history-client">
            Filter by client
          </label>
          <select
            id="history-client"
            className="select"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="history-tag">
            Filter by tag
          </label>
          <select
            id="history-tag"
            className="select"
            value={tagId}
            onChange={(event) => setTagId(event.target.value)}
          >
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="history-billable">
            Filter by billable status
          </label>
          <select
            id="history-billable"
            className="select"
            value={billable}
            onChange={(event) => setBillable(event.target.value as "" | "yes" | "no")}
          >
            <option value="">Billable & non-billable</option>
            <option value="yes">Billable only</option>
            <option value="no">Non-billable only</option>
          </select>

          {search.trim() ? (
            <span className="badge badge-accent">
              <Search size={11} aria-hidden="true" />
              {search.trim()}
              <button
                type="button"
                aria-label="Clear search filter"
                className="btn btn-ghost btn-icon"
                style={{ width: 18, height: 18, marginRight: -5 }}
                onClick={() => setSearch("")}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ) : null}

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}

          <span className="spacer" />
          {loading ? <span className="entry-time">Loading…</span> : null}
        </div>

        {selectionMode ? (
          <div className="bulk-bar" role="region" aria-label="Bulk entry actions">
            <span>
              <strong>{selectedIds.size}</strong>{" "}
              {selectedIds.size === 1 ? "entry" : "entries"} selected
            </span>
            <Button size="sm" variant="ghost" onClick={toggleSelectAll}>
              {allVisibleSelected ? "Clear selection" : "Select all shown"}
            </Button>
            <span className="spacer" />
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={13} aria-hidden="true" />}
              onClick={() => setBulkDeleteOpen(true)}
              disabled={selectedIds.size === 0}
            >
              Delete selected
            </Button>
            <Button size="sm" variant="ghost" onClick={exitSelection}>
              Cancel
            </Button>
          </div>
        ) : null}

        {error ? (
          <div className="banner warning" role="alert">
            <div className="banner-icon">
              <AlertTriangle size={16} aria-hidden="true" />
            </div>
            <div style={{ flex: 1 }}>
              <h3>Could not load your history</h3>
              <p>{error}</p>
              <div className="banner-actions">
                <Button size="sm" onClick={() => void refreshAll()}>
                  Retry
                </Button>
              </div>
            </div>
          </div>
        ) : groups.length === 0 && !loading ? (
          <div className="card">
            <EmptyState
              icon={hasFilters ? <Inbox size={28} aria-hidden="true" /> : <CalendarClock size={28} aria-hidden="true" />}
              title={hasFilters ? "No entries match these filters" : "No time tracked in this range"}
              description={
                hasFilters
                  ? "Try widening the date range or clearing filters."
                  : "Start the timer above, or add a manual entry for work you already finished."
              }
              action={
                hasFilters ? (
                  <Button onClick={clearFilters}>Clear filters</Button>
                ) : (
                  <Button variant="primary" onClick={() => requestNewEntry()}>
                    Add manual entry
                  </Button>
                )
              }
            />
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.date} className="day-group" style={{ marginBottom: 10 }}>
              <div className="day-head">
                <h3>{dayLabel(group.date, today) || formatDateWithYear(group.date)}</h3>
                <span className="date">
                  {dayLabel(group.date, today) ? formatDateLong(group.date) : ""}
                </span>
                <span className="total">{formatDuration(group.total, "hm")}</span>
              </div>
              {group.entries.map((segment) => (
                <EntryRow
                  key={`${segment.entry.id}-${group.date}`}
                  entry={segment.entry}
                  segmentSeconds={segment.seconds}
                  timezone={timezone}
                  timeFormat={settings.timeFormat}
                  now={now}
                  continuedFromPrevious={segment.continuedFromPrevious}
                  continuesNext={segment.continuesNext}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(segment.entry.id)}
                  onToggleSelected={toggleSelected}
                  onResume={(entry) => {
                    if (status?.activeEntry) setResumeTarget(entry);
                    else void doResume(entry, false);
                  }}
                  onEdit={(entry) => setEditEntry(entry)}
                  onDelete={(entry) => setDeleteTarget(entry)}
                />
              ))}
            </div>
          ))
        )}
      </section>

      <EntryDialog
        open={Boolean(editEntry)}
        entry={editEntry}
        onClose={() => setEditEntry(null)}
      />

      <Dialog
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title="Today's summary"
        description={`${formatDateLong(today)} · generated from today's tracked time`}
        wide
        footer={
          <>
            <span className="spacer" />
            <Button onClick={() => setSummaryOpen(false)}>Close</Button>
          </>
        }
      >
        <SummaryPanel
          embedded
          filter={{ dateFrom: today, dateTo: today, timezone }}
        />
      </Dialog>

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Delete ${selectedIds.size} selected ${
          selectedIds.size === 1 ? "entry" : "entries"
        }?`}
        description="The entries are removed from totals, timesheets, and reports together. Running entries are never included. You can undo the whole batch immediately after."
        confirmLabel={
          bulkBusy
            ? "Deleting…"
            : `Delete ${selectedIds.size} ${
                selectedIds.size === 1 ? "entry" : "entries"
              }`
        }
        tone="danger"
        busy={bulkBusy}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={() => void confirmBulkDelete()}
      >
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
          {selectedEntries
            .map((entry) => entry.description.trim() || "Untitled session")
            .join(" · ")}
          {" — "}
          {formatDuration(selectedSeconds, "compact")} total recorded time.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this time entry?"
        description="The entry is removed from totals and reports. You can undo this immediately after."
        confirmLabel="Delete entry"
        tone="danger"
        busy={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
          {deleteTarget?.description.trim() || "Untitled session"}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(resumeTarget)}
        title="Stop the current timer and resume this entry?"
        description="Resume creates a brand-new session with the same description, project, tags, and billable flag. The original entry is never modified."
        confirmLabel="Stop current & resume"
        busy={resumeBusy}
        onCancel={() => setResumeTarget(null)}
        onConfirm={() => {
          if (resumeTarget) void doResume(resumeTarget, true);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingSwitch)}
        title="A timer is already running"
        description="TempoDesk keeps exactly one running timer. Continue to stop the current session and start this one atomically."
        confirmLabel="Stop current & start"
        busy={starting}
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => void confirmSwitch()}
      />

      <Dialog
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        title="Start a new session"
        description="The current timer stops and the new one starts in a single transaction."
        footer={
          <>
            <span className="spacer" />
            <Button onClick={() => setSwitchOpen(false)} disabled={switchBusy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="switch-form"
              disabled={switchBusy}
            >
              {switchBusy ? "Switching…" : "Switch timer"}
            </Button>
          </>
        }
      >
        <SwitchForm
          busy={switchBusy}
          active={status?.activeEntry ?? null}
          projects={projects}
          tags={tags}
          onSubmit={async (input) => {
            setSwitchBusy(true);
            try {
              await api.switchTimer(input);
              pushToast({
                title: "Switched tasks",
                message: "The previous timer was stopped and saved.",
                tone: "success",
              });
              setSwitchOpen(false);
            } catch (err) {
              pushToast({
                title: "Could not switch the timer",
                message: normalizeError(err).message,
                tone: "error",
              });
            } finally {
              setSwitchBusy(false);
            }
          }}
        />
      </Dialog>
    </>
  );
}

function SwitchForm({
  active,
  projects,
  tags,
  busy,
  onSubmit,
}: {
  active: TimeEntry | null;
  projects: ReturnType<typeof useAppData>["projects"];
  tags: ReturnType<typeof useAppData>["tags"];
  busy: boolean;
  onSubmit: (input: StartTimerInput) => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [billable, setBillable] = useState(false);

  useEffect(() => {
    if (active) {
      setDescription(active.description);
      setProjectId(active.projectId ?? "");
      setSelectedTags(active.tags.map((tag) => tag.id));
      setBillable(active.isBillable);
    }
  }, [active]);

  return (
    <form
      id="switch-form"
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          description: description.trim(),
          projectId: projectId || null,
          tagIds: selectedTags,
          isBillable: billable,
        });
      }}
    >
      <div className="span-2">
        <Field label="Description">
          {(props) => (
            <input
              {...props}
              className="input"
              data-autofocus
              value={description}
              maxLength={1000}
              placeholder="What are you switching to?"
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="Project">
        {(props) => (
          <select
            {...props}
            className="select"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="field">
        <span className="field-label">Billable</span>
        <label className="check" style={{ height: 34 }}>
          <input
            type="checkbox"
            checked={billable}
            onChange={(event) => setBillable(event.target.checked)}
          />
          Bill this time
        </label>
      </div>
      <div className="span-2 field">
        <span className="field-label">Tags</span>
        <TagPicker tags={tags} selected={selectedTags} onChange={setSelectedTags} disabled={busy} />
      </div>
    </form>
  );
}
