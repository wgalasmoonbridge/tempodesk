import { useEffect, useState } from "react";
import { Pencil, Play, Plus, Star, Trash2 } from "lucide-react";
import { useAppData } from "../../app/AppProvider";
import { Button, IconButton } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Dialog } from "../../components/Dialog";
import { TagPicker } from "../../components/TagPicker";
import { useToast } from "../../components/Toast";
import { api, normalizeError } from "../../lib/ipc";
import type { TaskTemplate, TemplateInput } from "../../lib/types";

const blank: TemplateInput = { id: null, name: "", description: "", projectId: null, tagIds: [], isBillable: false };

export function TemplatePanel() {
  const { projects, tags, status, dataVersion, bumpData } = useAppData();
  const { pushToast } = useToast();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [draft, setDraft] = useState<TemplateInput | null>(null);
  const [remove, setRemove] = useState<TaskTemplate | null>(null);
  const [switchTo, setSwitchTo] = useState<TaskTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.listTemplates().then((items) => { if (!cancelled) { setTemplates(items); setLoadError(null); } })
      .catch((error) => { if (!cancelled) setLoadError(normalizeError(error).message); });
    return () => { cancelled = true; };
  }, [dataVersion]);

  const begin = (template: TemplateInput) => { setError(null); setDraft(template); };
  const start = async (template: TaskTemplate, switchActive = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.startTemplate(template.id, switchActive);
      setSwitchTo(null);
      pushToast({ title: `Started ${template.name}`, tone: "success" });
    } catch (error) {
      if (normalizeError(error).code === "active_timer_exists") setSwitchTo(template);
      else pushToast({ title: "Could not start template", message: normalizeError(error).message, tone: "error" });
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try { await api.saveTemplate(draft); setDraft(null); bumpData(); }
    catch (error) { setError(normalizeError(error).message); }
    finally { setBusy(false); }
  };
  const deleteTemplate = async () => {
    if (!remove || busy) return;
    setBusy(true);
    try { await api.deleteTemplate(remove.id); setRemove(null); bumpData(); }
    catch (error) { pushToast({ title: "Could not delete template", message: normalizeError(error).message, tone: "error" }); }
    finally { setBusy(false); }
  };

  return <section className="card template-panel" aria-label="Saved task templates">
    <div className="template-header"><h2><Star size={15} aria-hidden="true" /> Saved tasks</h2><span className="spacer" />
      {status?.activeEntry && <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
        const entry = status.activeEntry!;
        begin({ id: null, name: entry.description.slice(0, 120), description: entry.description, projectId: entry.projectId, tagIds: entry.tags.map((tag) => tag.id), isBillable: entry.isBillable });
      }}>Save current task</Button>}
      <Button size="sm" icon={<Plus size={13} aria-hidden="true" />} disabled={busy} onClick={() => begin({ ...blank })}>New template</Button>
    </div>
    {loadError ? <p role="alert">{loadError}</p> : templates.length === 0 ? <p className="field-hint">Save recurring tasks with their project, tags, and billable status. Start them here or from the tray.</p> :
      <div className="template-list">{templates.map((template) => <div className="template-item" key={template.id}>
        <Button size="sm" variant="ghost" icon={<Play size={13} aria-hidden="true" />} disabled={busy} onClick={() => status?.activeEntry ? setSwitchTo(template) : void start(template)} title={template.description || template.name}>{template.name}</Button>
        <IconButton label={`Edit template ${template.name}`} icon={<Pencil size={12} aria-hidden="true" />} disabled={busy} onClick={() => begin({ ...template })} />
        <IconButton label={`Delete template ${template.name}`} icon={<Trash2 size={12} aria-hidden="true" />} disabled={busy} onClick={() => setRemove(template)} />
      </div>)}</div>}
    <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} dismissible={!busy} title={draft?.id ? "Edit task template" : "New task template"} footer={<><Button disabled={busy} onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" disabled={busy || !draft?.name.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save template"}</Button></>}>
      {draft && <div className="workflow-form">
        <label>Name<input className="input" aria-label="Template name" data-autofocus maxLength={120} disabled={busy} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Description<input className="input" aria-label="Template description" maxLength={1000} disabled={busy} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label>Project<select className="select" aria-label="Template project" disabled={busy} value={draft.projectId ?? ""} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); setDraft({ ...draft, projectId: project?.id ?? null, isBillable: project?.defaultBillable ?? false }); }}><option value="">No project</option>{draft.projectId && !projects.some((item) => item.id === draft.projectId) && <option value={draft.projectId}>Unavailable project — choose another</option>}{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <TagPicker tags={tags} selected={draft.tagIds} onChange={(tagIds) => setDraft({ ...draft, tagIds })} disabled={busy} />
        {draft.tagIds.some((id) => !tags.some((tag) => tag.id === id)) && <Button size="sm" onClick={() => setDraft({ ...draft, tagIds: draft.tagIds.filter((id) => tags.some((tag) => tag.id === id)) })}>Remove unavailable tags</Button>}
        <label className="check-label"><input type="checkbox" disabled={busy} checked={draft.isBillable} onChange={(event) => setDraft({ ...draft, isBillable: event.target.checked })} /> Billable</label>
        {error && <p role="alert" className="field-error">{error}</p>}
      </div>}
    </Dialog>
    <ConfirmDialog open={Boolean(switchTo)} title="Switch to saved task?" description={`Stop the current timer and start “${switchTo?.name ?? ""}” as a new session.`} confirmLabel={busy ? "Starting…" : "Switch task"} busy={busy} onCancel={() => setSwitchTo(null)} onConfirm={() => { if (switchTo) void start(switchTo, true); }} />
    <ConfirmDialog open={Boolean(remove)} title="Delete task template?" description={`Remove “${remove?.name ?? ""}” from saved tasks. Recorded sessions are preserved.`} confirmLabel="Delete template" tone="danger" busy={busy} onCancel={() => setRemove(null)} onConfirm={() => void deleteTemplate()} />
  </section>;
}
