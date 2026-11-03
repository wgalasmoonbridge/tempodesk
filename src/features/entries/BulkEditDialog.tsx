import { useState } from "react";
import { useAppData } from "../../app/AppProvider";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TagPicker } from "../../components/TagPicker";
import { useToast } from "../../components/Toast";
import { api, normalizeError } from "../../lib/ipc";
import type { BulkEditPatch } from "../../lib/types";

export function BulkEditDialog({ ids, onClose, onSaved }: { ids: string[]; onClose: () => void; onSaved: () => void }) {
  const { projects, tags } = useAppData();
  const { pushToast } = useToast();
  const [changeDescription, setChangeDescription] = useState(false);
  const [description, setDescription] = useState("");
  const [project, setProject] = useState("keep");
  const [billable, setBillable] = useState("keep");
  const [tagMode, setTagMode] = useState("keep");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = changeDescription || project !== "keep" || billable !== "keep" || tagMode !== "keep";

  const save = async () => {
    if (busy || !changed) return;
    setBusy(true);
    setError(null);
    const patch: BulkEditPatch = {};
    if (changeDescription) patch.description = description;
    if (project !== "keep") { patch.setProject = true; patch.projectId = project || null; }
    if (billable !== "keep") patch.isBillable = billable === "yes";
    if (tagMode !== "keep") { patch.tagIds = tagIds; patch.tagMode = tagMode as BulkEditPatch["tagMode"]; }
    try {
      const result = await api.bulkEditEntries(ids, patch);
      pushToast({ title: `${result.updatedCount} entries updated`, tone: "success", duration: 15000,
        message: "Changes are saved across history, timesheets, and reports.",
        action: { label: "Undo", onClick: () => {
          void api.undoBulkEdit(result.undoToken).then((count) => {
            pushToast({ title: `${count} entries reverted`, tone: "success" });
          }).catch((error) => pushToast({ title: "Could not undo", message: normalizeError(error).message, tone: "error" }));
        } },
      });
      onSaved();
    } catch (error) { setError(normalizeError(error).message); setBusy(false); }
  };

  return <Dialog open onClose={onClose} dismissible={!busy} title={`Edit ${ids.length} selected entries`}
    description="Choose the fields to change. All other values and session times are preserved."
    footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy || !changed || ids.length > 1000} onClick={() => void save()}>{busy ? "Saving…" : "Apply changes"}</Button></>}>
    <div className="workflow-form">
      <label className="check-label"><input type="checkbox" checked={changeDescription} disabled={busy} onChange={(event) => setChangeDescription(event.target.checked)} /> Change description</label>
      {changeDescription && <input className="input" aria-label="New description" value={description} maxLength={1000} disabled={busy} onChange={(event) => setDescription(event.target.value)} placeholder="Leave empty to clear descriptions" />}
      <label>Project<select className="select" aria-label="Bulk project" value={project} disabled={busy} onChange={(event) => setProject(event.target.value)}><option value="keep">Keep existing projects</option><option value="">No project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Billable status<select className="select" aria-label="Bulk billable status" value={billable} disabled={busy} onChange={(event) => setBillable(event.target.value)}><option value="keep">Keep existing status</option><option value="yes">Billable</option><option value="no">Non-billable</option></select></label>
      <label>Tags<select className="select" aria-label="Bulk tag operation" value={tagMode} disabled={busy} onChange={(event) => setTagMode(event.target.value)}><option value="keep">Keep existing tags</option><option value="add">Add tags</option><option value="remove">Remove tags</option><option value="replace">Replace all tags</option></select></label>
      {tagMode !== "keep" && <><TagPicker tags={tags} selected={tagIds} onChange={setTagIds} disabled={busy} />{tagMode === "replace" && <p className="field-hint">Existing tags will be replaced. Selecting none clears all tags.</p>}</>}
      {ids.length > 1000 && <p role="alert">Select at most 1,000 entries per edit.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  </Dialog>;
}
