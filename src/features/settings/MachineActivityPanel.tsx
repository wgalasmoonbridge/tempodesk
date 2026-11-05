import { useEffect, useMemo, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useAppData } from "../../app/AppProvider";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Switch } from "../../components/Switch";
import { useToast } from "../../components/Toast";
import { api, normalizeError } from "../../lib/ipc";
import { zonedDayEndMs, zonedDayStartMs } from "../../lib/time";
import type { MachineActivityEvent, MachineActivityFilter, MachineActivityPage, MachineActivityStatus, SettingsPatch } from "../../lib/types";

const PAGE_SIZE = 50;
const EVENT_LABELS: Record<MachineActivityEvent["kind"], string> = {
  login: "Login", session_observed: "Session observed", lock: "Locked", unlock: "Unlocked",
  session_active: "Session active", session_inactive: "Session inactive", logoff: "Logoff",
};
const TIMING_LABELS: Record<MachineActivityEvent["timing"], string> = {
  os_reported: "OS-reported time", notification: "Notification received", sampled: "Sampled change", observed: "Observation only",
};
const CAPABILITY_LABELS = { identity: "Account identity", login_time: "Login time", lock: "Lock / unlock", session: "Session changes" };

export function MachineActivityPanel() {
  const { settings, updateSettings, timezone, dataVersion } = useAppData();
  const { pushToast } = useToast();
  const [status, setStatus] = useState<MachineActivityStatus | null>(null);
  const [page, setPage] = useState<MachineActivityPage | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const invalidRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const filter = useMemo<MachineActivityFilter>(() => ({
    fromUtc: dateFrom ? zonedDayStartMs(dateFrom, timezone) : undefined,
    toUtc: dateTo ? zonedDayEndMs(dateTo, timezone) : undefined,
    limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE,
  }), [dateFrom, dateTo, timezone, pageIndex]);

  useEffect(() => {
    if (invalidRange) { setLoading(false); return; }
    let disposed = false;
    let pending = false;
    setLoading(true);
    setPage(null);
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const [nextStatus, nextPage] = await Promise.all([api.getMachineActivityStatus(), api.listMachineActivity(filter)]);
        if (!disposed) {
          setStatus(nextStatus); setPage(nextPage); setLoadError(null);
          if (pageIndex > 0 && nextPage.events.length === 0) setPageIndex(0);
        }
      } catch (error) {
        if (!disposed) setLoadError(normalizeError(error).message);
      } finally {
        pending = false;
        if (!disposed) setLoading(false);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => { disposed = true; clearInterval(interval); };
  }, [filter, invalidRange, pageIndex, revision, dataVersion, settings.machineActivityEnabled, settings.machineActivityRetentionDays]);

  const timestamp = (value: number | null | undefined) => value == null ? "Unknown / unavailable" : new Intl.DateTimeFormat(undefined, {
    timeZone: timezone, dateStyle: "medium", timeStyle: "medium",
    ...(settings.timeFormat === "auto" ? {} : { hour12: settings.timeFormat === "12h" }),
  }).format(value);

  const change = async (patch: SettingsPatch) => {
    if (busy) return;
    setBusy(true); setActionError(null);
    try {
      await updateSettings(patch);
      if (patch.machineActivityEnabled === false) setStatus(null);
      setConfirmEnable(false); setRevision((value) => value + 1);
    } catch (error) { setActionError(normalizeError(error).message); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true); setActionError(null);
    try {
      await api.clearMachineActivity();
      setPage({ events: [], totalCount: 0 }); setPageIndex(0);
      setConfirmClear(false); setRevision((value) => value + 1);
      pushToast({ title: "Machine activity history cleared", tone: "success" });
    } catch (error) { setActionError(normalizeError(error).message); }
    finally { setBusy(false); }
  };

  const exportCsv = async () => {
    if (busy || invalidRange) return;
    setBusy(true); setActionError(null);
    try {
      const destination = await saveDialog({ title: "Export machine activity (contains account and device names)",
        defaultPath: "tempodesk-machine-activity.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!destination) return;
      // Pagination never limits exports. Both UI and backend use the same UTC date bounds.
      const result = await api.exportMachineActivityCsv({ fromUtc: filter.fromUtc, toUtc: filter.toUtc }, destination);
      pushToast({ title: `Exported ${result.rowCount} activity events`, tone: "success" });
    } catch (error) { setActionError(normalizeError(error).message); }
    finally { setBusy(false); }
  };

  const current = settings.machineActivityEnabled ? status?.currentSession : null;
  return <div className="settings-section machine-activity-panel">
    <h2>Machine activity</h2>
    <p>An optional log of this OS account's login/session activity. Local-only, off by default, and separate from work timers.</p>
    <div className="card">
      <div className="setting-row">
        <div className="setting-main"><div className="setting-title">Log my machine activity</div>
          <div className="setting-desc">Reads account and machine identity, OS login time when available, and supported session events. No passwords, keystrokes, screenshots, or other users' history.</div></div>
        <div className="setting-control"><Switch label="Log my machine activity" checked={settings.machineActivityEnabled} disabled={busy}
          onChange={(enabled) => enabled ? setConfirmEnable(true) : void change({ machineActivityEnabled: false })} /></div>
      </div>
      <div className="setting-row">
        <div className="setting-main"><div className="setting-title">Keep activity history</div>
          <div className="setting-desc">Events expire automatically, even when monitoring is off. Disabling does not delete existing history.</div></div>
        <div className="setting-control"><select className="select" aria-label="Machine activity retention" value={settings.machineActivityRetentionDays}
          disabled={busy} onChange={(event) => void change({ machineActivityRetentionDays: Number(event.target.value) })}>
          {[...new Set([1, 7, 14, 30, 90, 180, 365, settings.machineActivityRetentionDays])].sort((a, b) => a - b).map((days) => <option key={days} value={days}>{days} {days === 1 ? "day" : "days"}</option>)}
        </select></div>
      </div>
    </div>

    {settings.machineActivityEnabled ? <>
      <div className="card card-pad">
        <h3>Current session</h3>
        {current ? <dl className="machine-session-details">
          <dt>Account</dt><dd>{current.domain ? `${current.domain}\\` : ""}{current.userName}</dd>
          <dt>Account identifier</dt><dd className="mono">{current.accountId}</dd>
          <dt>Machine</dt><dd>{current.machineName}</dd>
          <dt>Session</dt><dd>{current.sessionId ?? "Unknown / unavailable"}</dd>
          <dt>OS login time</dt><dd>{timestamp(current.loginAtUtc)}</dd>
          <dt>Lock state</dt><dd>{current.locked == null ? "Unknown / unavailable" : current.locked ? "Locked" : "Unlocked (OS-reported)"}</dd>
          <dt>Last sampled</dt><dd>{timestamp(status?.lastObservedAtUtc)}</dd>
        </dl> : <p className="field-hint">Waiting for native session details…</p>}
        {status?.error && <p className="field-error" role="alert">{status.error}</p>}
      </div>
      <div className="card card-pad">
        <h3>OS capabilities</h3>
        {(status?.capabilities ?? []).map((item) => <div className="machine-capability" key={item.feature}>
          <div><strong>{CAPABILITY_LABELS[item.feature]}</strong> <span className="badge">{item.status.replaceAll("_", " ")}</span></div>
          <p className="field-hint">{item.detail}</p>
        </div>)}
      </div>
    </> : <p className="field-hint">Monitoring is off. Account details are not read. Previously saved activity remains below until cleared or expired.</p>}

    <div className="card card-pad">
      <h3>Activity history</h3>
      <p className="field-hint">Times shown in {timezone}. “Login” uses an OS-reported time. “Session observed” is not a login. Notifications and sampled changes use their observation time; events while the app is closed may be missed.</p>
      <div className="machine-activity-filters">
        <label>From<input className="input" type="date" aria-label="Activity from date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPageIndex(0); }} /></label>
        <label>Through<input className="input" type="date" aria-label="Activity through date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPageIndex(0); }} /></label>
        <Button disabled={busy || loading || invalidRange || Boolean(loadError) || !page?.totalCount} onClick={() => void exportCsv()}>Export CSV</Button>
        <Button variant="danger" disabled={busy} onClick={() => setConfirmClear(true)}>Clear all history</Button>
      </div>
      {invalidRange && <p className="field-error" role="alert">The through date must be on or after the from date.</p>}
      {loadError && <p className="field-error" role="alert">{loadError}</p>}
      {loading ? <p role="status">Loading activity…</p> : !invalidRange && page?.events.length ? <>
        <div className="table-wrap"><table className="data-table machine-activity-table">
          <thead><tr><th className="nosort">Event / timing</th><th className="nosort">Event time</th><th className="nosort">Observed at</th><th className="nosort">Account / machine</th></tr></thead>
          <tbody>{page.events.map((event) => <tr key={event.id}>
            <td><strong>{EVENT_LABELS[event.kind]}</strong><small>{TIMING_LABELS[event.timing]}</small></td>
            <td>{timestamp(event.eventAtUtc)}</td><td>{timestamp(event.observedAtUtc)}</td>
            <td>{event.domain ? `${event.domain}\\` : ""}{event.userName}<small>{event.machineName} · {event.source}{event.sessionId ? ` · ${event.sessionId}` : ""}</small></td>
          </tr>)}</tbody>
        </table></div>
        <div className="machine-activity-pagination">
          <span className="field-hint">{pageIndex * PAGE_SIZE + 1}–{pageIndex * PAGE_SIZE + page.events.length} of {page.totalCount} events</span>
          <Button disabled={busy || pageIndex === 0} onClick={() => setPageIndex((value) => value - 1)}>Previous</Button>
          <Button disabled={busy || (pageIndex + 1) * PAGE_SIZE >= page.totalCount} onClick={() => setPageIndex((value) => value + 1)}>Next</Button>
        </div>
      </> : !invalidRange && !loadError ? <p className="field-hint">No activity recorded in this range.</p> : null}
    </div>
    <p className="field-hint">Enable “Launch at login” under Tray &amp; startup for better coverage. History is excluded from work reports, shared links, AI summaries, and all portable backups. Exported CSV files contain account and machine names.</p>
    {actionError && <p className="field-error" role="alert">{actionError}</p>}
    <ConfirmDialog open={confirmEnable} title="Enable machine activity logging?" confirmLabel="Enable logging" busy={busy}
      description="Allow TempoDesk to save this OS account's username, account identifier, domain (if any), machine name, login time when available, and supported session events locally. This does not start or modify work timers."
      onCancel={() => { setConfirmEnable(false); setActionError(null); }} onConfirm={() => void change({ machineActivityEnabled: true })}>
      <p>Windows, macOS, and Linux expose different capabilities. Unsupported events remain unknown; app startup, sleep, and session switching are never invented as logins or screen locks. You can disable logging and clear history at any time.</p>
      {actionError && <p className="field-error" role="alert">{actionError}</p>}
    </ConfirmDialog>
    <ConfirmDialog open={confirmClear} title="Clear all machine activity?" confirmLabel="Clear history" tone="danger" busy={busy}
      description="Permanently delete all machine activity, not just this date range. Work entries are untouched. Monitoring remains at its current setting; new observations can still be recorded. Old login times and queued events will not be re-imported."
      onCancel={() => { setConfirmClear(false); setActionError(null); }} onConfirm={() => void clear()}>
      {actionError && <p className="field-error" role="alert">{actionError}</p>}
    </ConfirmDialog>
  </div>;
}
