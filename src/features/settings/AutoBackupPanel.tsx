import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppData } from "../../app/AppProvider";
import { Button } from "../../components/Button";
import { Switch } from "../../components/Switch";
import { useToast } from "../../components/Toast";
import { api, normalizeError } from "../../lib/ipc";
import type { AutoBackupStatus, SettingsPatch } from "../../lib/types";

export function AutoBackupPanel() {
  const { settings, updateSettings } = useAppData();
  const { pushToast } = useToast();
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => api.getAutoBackupStatus().then((status) => {
      if (!cancelled) setStatus(status);
    }).catch((error) => { if (!cancelled) setError(normalizeError(error).message); });
    void refresh();
    const interval = setInterval(() => void refresh(), 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [settings.autoBackupDirectory, settings.autoBackupEnabled, settings.autoBackupRetention]);

  const change = async (patch: SettingsPatch) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await updateSettings(patch);
      if (result.settings.autoBackupEnabled) setStatus(await api.runAutoBackup());
      else setStatus(await api.getAutoBackupStatus());
    } catch (error) { setError(normalizeError(error).message); }
    finally { setBusy(false); }
  };
  const choose = async () => {
    try {
      const path = await open({ directory: true, multiple: false, title: "Choose automatic backup folder" });
      if (typeof path === "string") await change({ autoBackupDirectory: path });
    } catch (error) { setError(normalizeError(error).message); }
  };
  const backup = async () => {
    setBusy(true); setError(null);
    try { setStatus(await api.runAutoBackup()); pushToast({ title: "Automatic backup saved", tone: "success" }); }
    catch (error) { setError(normalizeError(error).message); }
    finally { setBusy(false); }
  };

  return <div className="card auto-backup-panel">
    <div className="setting-row"><div className="setting-main"><div className="setting-title">Automatic local backups</div><div className="setting-desc">Save once every 24 hours while TempoDesk is running, including in the tray. Missed backups run when the app opens. Off by default.</div></div><div className="setting-control"><Switch checked={settings.autoBackupEnabled} disabled={busy} label="Automatic local backups" onChange={(enabled) => void change({ autoBackupEnabled: enabled })} /></div></div>
    <div className="setting-row"><div className="setting-main"><div className="setting-title">Backup folder</div><div className="setting-desc mono">{status?.directory ?? "Loading…"}</div><div className="setting-desc">A dedicated folder keeps automatic backups separate from manual and safety backups.</div></div><div className="setting-control"><Button disabled={busy} onClick={() => void choose()}>Choose folder…</Button>{settings.autoBackupDirectory && <Button variant="ghost" disabled={busy} onClick={() => void change({ autoBackupDirectory: "" })}>Use default</Button>}</div></div>
    <div className="setting-row"><div className="setting-main"><div className="setting-title">Keep recent backups</div><div className="setting-desc">Older automatic backups are removed only after a new backup succeeds.</div></div><div className="setting-control"><select className="select" aria-label="Automatic backup retention" disabled={busy} value={settings.autoBackupRetention} onChange={(event) => void change({ autoBackupRetention: Number(event.target.value) })}>{[1, 7, 14, 30, 60, 90].map((count) => <option key={count} value={count}>{count} backups</option>)}</select></div></div>
    <div className="setting-row"><div className="setting-main"><div className="setting-title">Last automatic backup</div><div className="setting-desc">{status?.lastBackupAtUtc ? new Date(status.lastBackupAtUtc).toLocaleString() : "No automatic backup yet"}</div>{status?.lastBackupPath && <div className="setting-desc mono">{status.lastBackupPath}</div>}{(error || status?.error) && <p className="field-error" role="alert">{error || status?.error}</p>}</div><div className="setting-control"><Button disabled={busy || !settings.autoBackupEnabled} onClick={() => void backup()}>{busy ? "Saving…" : "Back up now"}</Button></div></div>
  </div>;
}
