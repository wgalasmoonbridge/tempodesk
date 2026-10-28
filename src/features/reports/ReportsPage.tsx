import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  BarChart3,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ProjectChip } from "../../components/Badge";
import { useToast } from "../../components/Toast";
import { useNavigation } from "../../app/navigation";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import type { ReportFilter, ReportResult } from "../../lib/types";
import type { ReportPreset as Preset } from "../../lib/time";
import {
  formatDateWithYear,
  formatDecimalHours,
  formatDuration,
  formatMonthDay,
  formatTime,
  reportRange,
  todayKey,
  zonedDateKey,
} from "../../lib/time";
import { BarChart } from "./BarChart";
import { SummaryPanel } from "../summary/SummaryPanel";

type SortKey = "start" | "duration" | "description" | "project" | "billable";
type SortDirection = "asc" | "desc";

export function ReportsPage() {
  const { projects, clients, tags, settings, timezone, dataVersion } = useAppData();
  const { search } = useNavigation();
  const { pushToast } = useToast();
  const today = todayKey(timezone);

  const [preset, setPreset] = useState<Preset>("this_week");
  const initialRange = useMemo(
    () => reportRange("this_week", today, settings.startOfWeek),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [projectId, setProjectId] = useState("");
  const [clientId, setClientId] = useState("");
  const [tagId, setTagId] = useState("");
  const [billable, setBillable] = useState<"" | "yes" | "no">("");

  const [report, setReport] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decimal, setDecimal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("start");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const applyPreset = (next: Preset) => {
    setPreset(next);
    if (next !== "custom") {
      const range = reportRange(next, todayKey(timezone), settings.startOfWeek);
      setFrom(range.from);
      setTo(range.to);
    }
  };

  const filter: ReportFilter = useMemo(
    () => ({
      dateFrom: from || today,
      dateTo: to || today,
      timezone,
      projectId: projectId || null,
      clientId: clientId || null,
      tagId: tagId || null,
      billable: billable === "" ? null : billable === "yes",
      search: search.trim() || null,
    }),
    [from, to, timezone, projectId, clientId, tagId, billable, search, today],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getReport(filter)
      .then((result) => {
        if (!cancelled) setReport(result);
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
  }, [filter, dataVersion]);

  const sortedEntries = useMemo(() => {
    const list = [...(report?.entries ?? [])];
    const direction = sortDirection === "asc" ? 1 : -1;
    list.sort((a, b) => {
      switch (sortKey) {
        case "description":
          return a.description.localeCompare(b.description) * direction;
        case "project":
          return (a.projectName ?? "").localeCompare(b.projectName ?? "") * direction;
        case "duration":
          return (a.inRangeSeconds - b.inRangeSeconds) * direction;
        case "billable":
          return (Number(a.isBillable) - Number(b.isBillable)) * direction;
        default:
          return (a.startAtUtc - b.startAtUtc) * direction;
      }
    });
    return list;
  }, [report?.entries, sortKey, sortDirection]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "start" ? "desc" : "asc");
    }
  };

  const ariaSort = (key: SortKey) =>
    sortKey === key ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

  const exportCsv = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const destination = await save({
        title: "Export report as CSV",
        defaultPath: `tempodesk-${report.dateFrom}-to-${report.dateTo}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!destination) return;
      const result = await api.exportReportCsv(filter, destination);
      pushToast({
        title: "CSV exported",
        message: `${report.dateFrom} → ${report.dateTo} · ${result.rowCount} rows · ${formatDuration(
          result.totalSeconds,
          "hm",
        )} total → ${result.path}`,
        tone: "success",
        duration: 9000,
      });
    } catch (err) {
      pushToast({
        title: "Export failed",
        message: normalizeError(err).message,
        tone: "error",
      });
    } finally {
      setExporting(false);
    }
  };

  const durationText = (seconds: number) =>
    decimal
      ? `${formatDecimalHours(seconds)} h`
      : seconds > 0 && seconds < 60
        ? `${seconds}s`
        : formatDuration(seconds, "hm");

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <div className="page-sub">
            Filtered totals, daily distribution, and the exact entries behind them.
          </div>
        </div>
        <div className="page-header-actions">
          <Button
            icon={<Download size={14} aria-hidden="true" />}
            onClick={() => void exportCsv()}
            disabled={!report || report.entryCount === 0 || exporting}
            title={
              report?.entryCount === 0
                ? "There are no entries to export for these filters"
                : "Export the filtered report as RFC 4180 CSV"
            }
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      <div className="report-filters" role="search" aria-label="Report filters">
        <label className="sr-only" htmlFor="report-preset">
          Date range preset
        </label>
        <select
          id="report-preset"
          className="select"
          value={preset}
          onChange={(event) => applyPreset(event.target.value as Preset)}
        >
          <option value="today">Today</option>
          <option value="this_week">This week</option>
          <option value="last_week">Last week</option>
          <option value="this_month">This month</option>
          <option value="custom">Custom…</option>
        </select>

        {preset === "custom" ? (
          <>
            <input
              className="input"
              type="date"
              aria-label="From date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <input
              className="input"
              type="date"
              aria-label="To date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </>
        ) : null}

        <select
          className="select"
          aria-label="Project filter"
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
        <select
          className="select"
          aria-label="Client filter"
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
        <select
          className="select"
          aria-label="Tag filter"
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
        <select
          className="select"
          aria-label="Billable filter"
          value={billable}
          onChange={(event) =>
            setBillable(event.target.value as "" | "yes" | "no")
          }
        >
          <option value="">Billable & non-billable</option>
          <option value="yes">Billable only</option>
          <option value="no">Non-billable only</option>
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={decimal}
            onChange={(event) => setDecimal(event.target.checked)}
          />
          Decimal hours
        </label>
        {search.trim() ? (
          <span className="badge badge-accent">Search: {search.trim()}</span>
        ) : null}
      </div>

      {error ? (
        <div className="banner warning" role="alert">
          <div className="banner-icon">
            <AlertTriangle size={16} aria-hidden="true" />
          </div>
          <div style={{ flex: 1 }}>
            <h3>Could not calculate the report</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {!report && loading ? (
        <div className="card">
          <EmptyState
            icon={<BarChart3 size={28} aria-hidden="true" />}
            title="Calculating report"
            description="Aggregating saved entries with local-midnight and DST-safe splits."
          />
        </div>
      ) : null}

      {report ? (
        <>
          <div className="summary-grid">
            <div className="stat-card">
              <div className="stat-label">Total</div>
              <div className="stat-value" title={`${report.totalSeconds} seconds`}>
                {durationText(report.totalSeconds)}
                <small>{report.entryCount} entries</small>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Billable</div>
              <div className="stat-value">
                {durationText(report.billableSeconds)}
                <small>
                  {report.totalSeconds > 0
                    ? `${Math.round((report.billableSeconds / report.totalSeconds) * 100)}%`
                    : "0%"}
                </small>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Non-billable</div>
              <div className="stat-value">{durationText(report.nonBillableSeconds)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Range</div>
              <div className="stat-value" style={{ fontSize: 15, lineHeight: 1.4 }}>
                {formatMonthDay(report.dateFrom)} – {formatMonthDay(report.dateTo)}
                <small style={{ display: "block", marginLeft: 0, marginTop: 2 }}>
                  {report.timezone}
                </small>
              </div>
            </div>
          </div>

          <SummaryPanel filter={filter} />

          <section className="card chart-card" aria-labelledby="daily-chart-heading">
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <h2 id="daily-chart-heading" style={{ fontSize: 14 }}>
                Daily distribution
              </h2>
              <span className="badge badge-teal">Billable</span>
              <span className="badge badge-accent">Non-billable</span>
              <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11.5 }}>
                Total {formatDuration(report.totalSeconds, "hm")}
              </span>
            </div>
            <BarChart daily={report.daily} />
          </section>

          <div className="breakdown-grid">
            <BreakdownCard title="By project" groups={report.byProject} decimal={decimal} />
            <BreakdownCard title="By client" groups={report.byClient} decimal={decimal} />
          </div>

          <section aria-labelledby="detailed-heading">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                margin: "8px 0",
              }}
            >
              <h2 id="detailed-heading" style={{ fontSize: 15 }}>
                Detailed entries
              </h2>
              <span className="badge">{report.entryCount}</span>
              <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11.5 }}>
                Duration shows time inside the selected range.
              </span>
            </div>

            {report.entries.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon={<FileSpreadsheet size={26} aria-hidden="true" />}
                  title="No entries in this report"
                  description="Try another date range or clear the filters."
                />
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortableTh
                        label="Description"
                        active={sortKey === "description"}
                        direction={ariaSort("description")}
                        onClick={() => toggleSort("description")}
                      />
                      <SortableTh
                        label="Project"
                        active={sortKey === "project"}
                        direction={ariaSort("project")}
                        onClick={() => toggleSort("project")}
                      />
                      <th className="nosort">Client</th>
                      <th className="nosort">Tags</th>
                      <SortableTh
                        label="Start"
                        active={sortKey === "start"}
                        direction={ariaSort("start")}
                        onClick={() => toggleSort("start")}
                      />
                      <th className="nosort">End</th>
                      <SortableTh
                        label="Duration"
                        active={sortKey === "duration"}
                        direction={ariaSort("duration")}
                        onClick={() => toggleSort("duration")}
                        alignRight
                      />
                      <SortableTh
                        label="Billable"
                        active={sortKey === "billable"}
                        direction={ariaSort("billable")}
                        onClick={() => toggleSort("billable")}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="desc" title={entry.description}>
                          {entry.description.trim() || "Untitled session"}
                          {entry.running ? (
                            <span className="badge badge-accent" style={{ marginLeft: 6 }}>
                              Running
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <ProjectChip
                            name={entry.projectName}
                            color={entry.projectColor}
                          />
                        </td>
                        <td>{entry.clientName ?? "—"}</td>
                        <td>
                          {entry.tags.length > 0
                            ? entry.tags.map((tag) => tag.name).join(", ")
                            : "—"}
                        </td>
                        <td>
                          {formatDateWithYear(
                            zonedDateKey(entry.startAtUtc, timezone),
                          )}{" "}
                          <span className="entry-time">
                            {formatTime(
                              entry.startAtUtc,
                              timezone,
                              settings.timeFormat,
                              entry.inRangeSeconds < 60,
                            )}
                          </span>
                        </td>
                        <td>
                          {entry.endAtUtc
                            ? formatTime(
                                entry.endAtUtc,
                                timezone,
                                settings.timeFormat,
                                entry.inRangeSeconds < 60,
                              )
                            : "—"}
                        </td>
                        <td className="num" title={`${entry.inRangeSeconds} seconds`}>
                          {durationText(entry.inRangeSeconds)}
                        </td>
                        <td>{entry.isBillable ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p style={{ color: "var(--muted)", fontSize: 11.5, margin: 0 }}>
            Report math allocates every entry at local midnight and uses real elapsed seconds, so
            daylight-saving days and overnight sessions stay accurate. CSV totals use the same
            filtered subset as this view.
          </p>
        </>
      ) : null}
    </>
  );
}

function SortableTh({
  label,
  active,
  direction,
  onClick,
  alignRight,
}: {
  label: string;
  active: boolean;
  direction: "ascending" | "descending" | "none";
  onClick: () => void;
  alignRight?: boolean;
}) {
  return (
    <th
      aria-sort={direction}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      style={{ textAlign: alignRight ? "right" : undefined }}
      title={`Sort by ${label}`}
    >
      {label}
      {active ? (direction === "ascending" ? " ↑" : " ↓") : ""}
    </th>
  );
}

function BreakdownCard({
  title,
  groups,
  decimal,
}: {
  title: string;
  groups: ReportResult["byProject"];
  decimal: boolean;
}) {
  return (
    <div className="card card-pad">
      <h2 style={{ fontSize: 13.5, marginBottom: 6 }}>{title}</h2>
      {groups.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 12, margin: "8px 0" }}>
          No time in this range.
        </p>
      ) : (
        groups.map((group) => (
          <div className="breakdown-row" key={group.id ?? "__none"}>
            {group.color ? (
              <span className="dot" style={{ background: group.color }} aria-hidden="true" />
            ) : (
              <span className="dot" style={{ background: "var(--border-strong)" }} aria-hidden="true" />
            )}
            <span className="name">{group.name}</span>
            <span className="value">
              {decimal
                ? `${formatDecimalHours(group.seconds)} h`
                : group.seconds > 0 && group.seconds < 60
                  ? `${group.seconds}s`
                  : formatDuration(group.seconds, "hm")}
            </span>
            {group.billableSeconds > 0 ? (
              <span className="badge badge-teal" title="Billable time">
                {group.billableSeconds < 60
                  ? `${group.billableSeconds}s`
                  : formatDuration(group.billableSeconds, "hm")}
              </span>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
