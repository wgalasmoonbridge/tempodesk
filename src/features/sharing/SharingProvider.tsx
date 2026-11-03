import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Copy, Link2, Loader2, RefreshCw, Square } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import { formatDuration } from "../../lib/time";
import type { ReportFilter, ShareInput, SharedReportPreview, SharingStatus } from "../../lib/types";

const OFF: SharingStatus = { phase:"stopped", message:"Sharing is off", url:null, expiresAtUtc:null, scope:null };
const running = (status: SharingStatus) => ["starting", "active", "reconnecting"].includes(status.phase);
const SharingContext = createContext<{
  status: SharingStatus;
  open: (filter?: ReportFilter, view?: "report" | "timesheet", title?: string) => void;
  stop: () => Promise<void>;
} | null>(null);

function useSharing() {
  const context = useContext(SharingContext);
  if (!context) throw new Error("SharingProvider is missing");
  return context;
}

export function SharingProvider({ children }: { children: ReactNode }) {
  const { projects, clients, tags } = useAppData();
  const { pushToast } = useToast();
  const [status, setStatus] = useState<SharingStatus>(OFF);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<ShareInput | null>(null);
  const [preview, setPreview] = useState<SharedReportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const observed = revision.current;
      try { const next = await api.getSharingStatus(); if (!disposed && observed === revision.current) setStatus(next); }
      catch { /* The normal app connection status handles IPC failures. */ }
      finally { pending = false; }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, []);

  const open = useCallback((filter?: ReportFilter, view: "report" | "timesheet" = "report", title = "Time report") => {
    setError(null);
    if (!running(status) && filter) {
      setDraft({ title, filter:structuredClone(filter), fields:{descriptions:false,billable:false}, ttlSeconds:3600, initialView:view, consent:false });
      setPreview(null);
    } else if (!running(status) && !draft && status.scope) {
      setDraft({...status.scope, consent:false});
    }
    setVisible(true);
  }, [status, draft]);

  const active = running(status);
  useEffect(() => {
    if (!visible || active || !draft) return;
    let cancelled = false;
    setPreviewing(true);
    setPreview(null);
    const timer = window.setTimeout(() => {
      api.previewSharing(draft).then((report) => {
        if (!cancelled) {setPreview(report);setError(null);}
      }).catch((failure) => {if (!cancelled) setError(normalizeError(failure).message);})
        .finally(() => {if (!cancelled) setPreviewing(false);});
    }, 180);
    return () => {cancelled = true;window.clearTimeout(timer);};
  }, [visible, active, draft]);

  const stop = useCallback(async () => {
    revision.current += 1;
    setBusy(true);
    try {setStatus(await api.stopSharing());setError(null);}
    catch (failure) {pushToast({title:"Could not stop sharing",message:normalizeError(failure).message,tone:"error"});}
    finally {setBusy(false);}
  }, [pushToast]);

  const create = async () => {
    if (!draft || !preview || previewing || busy) return;
    revision.current += 1;
    setBusy(true);setError(null);
    try {setStatus(await api.startSharing({...draft,consent:true}));}
    catch (failure) {setError(normalizeError(failure).message);}
    finally {setBusy(false);}
  };

  const rotate = async () => {
    revision.current += 1;
    setBusy(true);setError(null);
    try {setStatus(await api.rotateSharingLink());pushToast({title:"Link replaced",message:"The previous link no longer works.",tone:"success"});}
    catch (failure) {setError(normalizeError(failure).message);}
    finally {setBusy(false);}
  };

  const copy = async () => {
    if (!status.url) return;
    try {await navigator.clipboard.writeText(status.url);pushToast({title:"Sharing link copied",tone:"success"});}
    catch { document.querySelector<HTMLInputElement>("#sharing-url")?.select();setError("Select and copy the link from the field above."); }
  };

  const selected = active ? status.scope : draft;
  const scope = selected?.filter;
  const project = projects.find((item) => item.id === scope?.projectId)?.name ?? (scope?.projectId ? "Selected project" : "All projects");
  const client = clients.find((item) => item.id === scope?.clientId)?.name ?? (scope?.clientId ? "Selected client" : "All clients");
  const tag = tags.find((item) => item.id === scope?.tagId)?.name;
  const value = useMemo(() => ({status,open,stop}),[status,open,stop]);

  return <SharingContext.Provider value={value}>
    {children}
    <Dialog open={visible} onClose={() => setVisible(false)} title={active ? "Manage sharing" : "Share a live report"}
      description="A temporary browser link to your selected report and timesheet. Beta." wide footer={<>
        <Button onClick={() => setVisible(false)}>Close</Button><span className="spacer" />
        {active ? <Button variant="danger" icon={<Square size={13} />} onClick={() => void stop()} disabled={busy}>Stop sharing</Button>
          : <Button variant="primary" icon={<Link2 size={14} />} onClick={() => void create()} disabled={busy || previewing || !preview || !draft?.title.trim()}>{busy ? "Starting…" : "Create public link"}</Button>}
      </>}>
      {status.phase === "error" ? <p className="banner warning" role="alert">{status.message}</p> : null}
      {active ? <>
        <div className="sharing-state" role="status"><span className={`dot ${status.phase === "active" ? "sharing-live" : "sharing-wait"}`} /><strong>{status.message}</strong></div>
        {status.url ? <div className="sharing-link">
          <label htmlFor="sharing-url">Shareable link</label>
          <input id="sharing-url" className="input" value={status.url} readOnly onFocus={(event) => event.target.select()} />
          <div className="sharing-actions"><Button icon={<Copy size={14} />} onClick={() => void copy()}>Copy link</Button>
            <Button icon={<RefreshCw size={14} />} onClick={() => void rotate()} disabled={busy}>Replace link</Button></div>
        </div> : <p className="muted"><Loader2 size={14} className="spin" /> First-time setup can take a few minutes. You can close this window while it connects.</p>}
        <p className="muted">{selected?.title} · Expires {status.expiresAtUtc ? new Date(status.expiresAtUtc).toLocaleString() : "soon"}.</p>
      </> : draft ? <>
        <label className="sharing-field">Report title<input className="input" aria-label="Shared report title" value={draft.title} maxLength={100} onChange={(event) => setDraft({...draft,title:event.target.value})} /></label>
        <div className="sharing-options">
          <label><input type="checkbox" checked={draft.fields.descriptions} onChange={(event) => setDraft({...draft,fields:{...draft.fields,descriptions:event.target.checked}})} /> Include work descriptions</label>
          <label><input type="checkbox" checked={draft.fields.billable} onChange={(event) => setDraft({...draft,fields:{...draft.fields,billable:event.target.checked}})} /> Include billable status and totals</label>
          <label className="sharing-field">Link duration<select className="select" aria-label="Sharing link duration" value={draft.ttlSeconds} onChange={(event) => setDraft({...draft,ttlSeconds:Number(event.target.value)})}>
            <option value={900}>15 minutes</option><option value={3600}>1 hour</option><option value={28800}>8 hours</option><option value={86400}>24 hours</option>
          </select></label>
        </div>
      </> : <p>Choose a report or timesheet and use its Share button.</p>}
      {scope ? <section className="sharing-scope" aria-label="Shared report scope">
        <strong>Fixed report scope</strong><p>{scope.dateFrom} – {scope.dateTo} · {scope.timezone}</p>
        <p>{project} · {client}{tag ? ` · Tag: ${tag}` : ""}{scope.billable == null ? "" : scope.billable ? " · Billable only" : " · Non-billable only"}</p>
        {scope.search ? <p>Description search: {scope.search}</p> : null}
        <small>Visitors cannot change these filters. New or edited work matching them appears automatically.</small>
      </section> : null}
      {!active && draft ? <section className="sharing-preview" aria-label="Shared data preview">
        <h3>Preview of shared data</h3>
        {previewing ? <p className="muted" role="status">Loading preview…</p> : preview ? <>
          <p><strong>{formatDuration(preview.totalSeconds,"hm")}</strong> across {preview.entryCount} sessions. Project names, session dates and durations are visible.</p>
          <p className="muted">Descriptions {draft.fields.descriptions ? "included" : "hidden"} · Billable details {draft.fields.billable ? "included" : "hidden"}</p>
          <div className="sharing-preview-rows">{preview.entries.slice(0,4).map((entry,index) => <div key={index}>
            <span>{entry.project}{entry.description ? ` · ${entry.description}` : " · Work session"}</span><strong>{formatDuration(entry.seconds,"hm")}</strong>
          </div>)}</div>
          {preview.entryCount > 4 ? <small className="muted">Showing 4 of {preview.entryCount} sessions.</small> : null}
        </> : <p className="muted">A valid preview is required before creating a link.</p>}
      </section> : null}
      <p className="sharing-disclosure">Anyone with the link can view and copy the selected data. Cloudflare carries the shared report traffic. Keep TempoDesk and this PC online; links end when you quit. First use downloads Cloudflare’s verified tunnel helper. Temporary addresses change when you create a new share.</p>
      {error ? <p className="banner warning" role="alert">{error}</p> : null}
    </Dialog>
  </SharingContext.Provider>;
}

export function ShareButton({ filter, view = "report", title = "Time report", disabled = false }: {
  filter:ReportFilter; view?:"report" | "timesheet"; title?:string; disabled?:boolean;
}) {
  const {status,open} = useSharing();
  return <Button icon={<Link2 size={14} aria-hidden="true" />} disabled={disabled && !running(status)}
    onClick={() => open(filter,view,title)}>{running(status) ? "Manage sharing" : "Share"}</Button>;
}

export function SharingBanner() {
  const {status,open,stop} = useSharing();
  if (!running(status) && status.phase !== "error") return null;
  return <div className={`sharing-banner${status.phase === "error" ? " sharing-error" : ""}`} role="status">
    <Link2 size={16} aria-hidden="true" /><span><strong>{status.phase === "active" ? "Live report sharing" : status.phase === "starting" ? "Preparing sharing link" : status.phase === "reconnecting" ? "Sharing is reconnecting" : "Sharing stopped"}</strong><small>{status.phase === "error" ? status.message : status.scope?.title}</small></span>
    <Button size="sm" onClick={() => open()}>Manage</Button>
    {running(status) ? <Button size="sm" onClick={() => void stop()}>Stop sharing</Button> : null}
  </div>;
}
