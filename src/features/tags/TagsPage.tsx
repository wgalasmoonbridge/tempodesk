import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import { Button, IconButton } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { Field } from "../../components/Field";
import { ColorSwatches } from "../../components/ColorSwatches";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import type { Tag } from "../../lib/types";
import { validateName } from "../../lib/validators";

export function TagsPage() {
  const { dataVersion, refreshMeta } = useAppData();
  const { pushToast } = useToast();
  const [tags, setTags] = useState<Tag[]>([]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      setTags(await api.listTags(true));
      setError(null);
    } catch (err) {
      setError(normalizeError(err).message);
    }
  };

  useEffect(() => {
    void reload();
  }, [dataVersion]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tags.filter((tag) => {
      if (!showArchived && tag.archivedAtUtc) return false;
      return !needle || tag.name.toLowerCase().includes(needle);
    });
  }, [tags, query, showArchived]);

  const toggleArchive = async (tag: Tag) => {
    try {
      await api.archiveTag(tag.id, !tag.archivedAtUtc);
      pushToast({
        title: tag.archivedAtUtc ? "Tag unarchived" : "Tag archived",
        message: tag.archivedAtUtc
          ? "It is available for new entries again."
          : "Existing entries keep this tag; it is hidden from new-entry selectors.",
        tone: "success",
      });
      await reload();
      await refreshMeta();
    } catch (err) {
      pushToast({
        title: "Could not update the tag",
        message: normalizeError(err).message,
        tone: "error",
      });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.deleteTag(deleteTarget.id);
      pushToast({
        title: "Tag deleted",
        message:
          "It is removed from selectors. Historical entries and reports still show the tag name.",
        tone: "success",
      });
      setDeleteTarget(null);
      await reload();
      await refreshMeta();
    } catch (err) {
      pushToast({
        title: "Could not delete the tag",
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
          <h1>Tags</h1>
          <div className="page-sub">
            Lightweight labels for cross-project work. Renaming a tag updates history everywhere.
          </div>
        </div>
        <div className="page-header-actions">
          <Button
            variant="primary"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => setEditing("new")}
          >
            New tag
          </Button>
        </div>
      </div>

      <div className="list-toolbar">
        <div className="header-search" style={{ marginLeft: 0, width: 260 }}>
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Search tags"
            aria-label="Search tags"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="badge">{tags.filter((t) => !t.archivedAtUtc).length} active</span>
        <span className="spacer" />
        <label className="check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived
        </label>
      </div>

      {error ? (
        <div className="banner warning" role="alert">
          <div className="banner-icon">
            <Tags size={16} aria-hidden="true" />
          </div>
          <div>
            <h3>Could not load tags</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <div className="card list-card">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Tags size={28} aria-hidden="true" />}
            title={tags.length === 0 ? "No tags yet" : "No tags match"}
            description={
              tags.length === 0
                ? "Tags are optional. Use them to mark routines, focus work, or admin tasks."
                : "Try another search or show archived tags."
            }
            action={
              tags.length === 0 ? (
                <Button variant="primary" className="create-tag-button" onClick={() => setEditing("new")}>
                  Create tag
                </Button>
              ) : undefined
            }
          />
        ) : (
          filtered.map((tag) => (
            <div className="org-row" key={tag.id}>
              <span
                className="color-dot"
                style={{ background: tag.color ?? "var(--border-strong)" }}
                aria-hidden="true"
              />
              <div className="org-main">
                <div className="org-name">
                  {tag.name}
                  {tag.archivedAtUtc ? (
                    <span className="badge" style={{ marginLeft: 7 }}>
                      Archived
                    </span>
                  ) : null}
                </div>
                <div className="org-sub">
                  {tag.archivedAtUtc ? "Hidden from new entries" : "Available for entries"}
                </div>
              </div>
              <div className="org-actions">
                <IconButton
                  label={`Edit ${tag.name}`}
                  icon={<Pencil size={14} aria-hidden="true" />}
                  onClick={() => setEditing(tag)}
                />
                <IconButton
                  label={tag.archivedAtUtc ? `Unarchive ${tag.name}` : `Archive ${tag.name}`}
                  icon={
                    tag.archivedAtUtc ? (
                      <ArchiveRestore size={14} aria-hidden="true" />
                    ) : (
                      <Archive size={14} aria-hidden="true" />
                    )
                  }
                  onClick={() => void toggleArchive(tag)}
                />
                <IconButton
                  label={`Delete ${tag.name}`}
                  icon={<Trash2 size={14} aria-hidden="true" />}
                  danger
                  onClick={() => setDeleteTarget(tag)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <TagDialog
        open={editing !== null}
        tag={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await reload();
          await refreshMeta();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this tag?"
        description="The tag is removed from selectors. Historical entries and reports keep the tag name, so totals do not change."
        confirmLabel="Delete tag"
        tone="danger"
        busy={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p style={{ margin: 0 }}>{deleteTarget?.name}</p>
      </ConfirmDialog>
    </>
  );
}

function TagDialog({
  open,
  tag,
  onClose,
  onSaved,
}: {
  open: boolean;
  tag: Tag | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { pushToast } = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(tag?.name ?? "");
    setColor(tag?.color ?? "#64748b");
    setError(null);
  }, [open, tag]);

  const save = async () => {
    const nameError = validateName(name, "Tag", 80);
    if (nameError) {
      setError(nameError);
      return;
    }
    setSaving(true);
    try {
      await api.saveTag({
        id: tag?.id ?? null,
        name: name.trim(),
        color,
      });
      pushToast({
        title: tag ? "Tag updated" : "Tag created",
        tone: "success",
      });
      await onSaved();
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tag ? "Edit tag" : "New tag"}
      description={
        tag?.archivedAtUtc
          ? "Archived tags cannot be renamed. Unarchive this tag first."
          : "Renaming updates every historical entry that uses this tag."
      }
      dismissible={!saving}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className={tag ? undefined : "create-tag-button"}
            onClick={() => void save()}
            disabled={saving || Boolean(tag?.archivedAtUtc)}
          >
            {saving ? "Saving…" : tag ? "Save changes" : "Create tag"}
          </Button>
        </>
      }
    >
      <Field label="Tag name" error={error}>
        {(props) => (
          <input
            {...props}
            className={`input${error ? " invalid" : ""}`}
            data-autofocus
            value={name}
            maxLength={80}
            placeholder="e.g. Deep work"
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <div className="field" style={{ marginTop: 14 }}>
        <span className="field-label">Color</span>
        <ColorSwatches value={color} onChange={setColor} label="Tag color" />
      </div>
    </Dialog>
  );
}
