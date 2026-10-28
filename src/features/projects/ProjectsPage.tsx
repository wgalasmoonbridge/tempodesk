import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, AlertTriangle, FolderKanban, Pencil, Plus, Search } from "lucide-react";
import { Button, IconButton } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { Field } from "../../components/Field";
import { ColorSwatches } from "../../components/ColorSwatches";
import { BillableBadge } from "../../components/Badge";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import type { Client, Project } from "../../lib/types";
import { clampText } from "../../lib/format";
import { validateName } from "../../lib/validators";

export function ProjectsPage() {
  const { dataVersion, refreshMeta } = useAppData();
  const { pushToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [nextProjects, nextClients] = await Promise.all([
        api.listProjects(true),
        api.listClients(true),
      ]);
      setProjects(nextProjects);
      setClients(nextClients);
      setError(null);
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [dataVersion]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (!showArchived && project.archivedAtUtc) return false;
      if (!needle) return true;
      return (
        project.name.toLowerCase().includes(needle) ||
        (project.clientName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [projects, query, showArchived]);

  const activeCount = projects.filter((project) => !project.archivedAtUtc).length;
  const archivedCount = projects.length - activeCount;

  const toggleArchive = async (project: Project) => {
    try {
      await api.archiveProject(project.id, !project.archivedAtUtc);
      pushToast({
        title: project.archivedAtUtc ? "Project unarchived" : "Project archived",
        message: project.archivedAtUtc
          ? "It is available again for new entries."
          : "Existing entries keep their project; it is hidden from new-entry selectors.",
        tone: "success",
        action: {
          label: "Undo",
          onClick: () => {
            void api
              .archiveProject(project.id, Boolean(project.archivedAtUtc))
              .then(() => reload());
          },
        },
      });
      await reload();
      await refreshMeta();
    } catch (err) {
      pushToast({
        title: "Could not update the project",
        message: normalizeError(err).message,
        tone: "error",
      });
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <div className="page-sub">
            Group tracked time by project, link a client, and choose a default billable state.
          </div>
        </div>
        <div className="page-header-actions">
          <Button
            variant="primary"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => setEditing("new")}
          >
            New project
          </Button>
        </div>
      </div>

      <div className="list-toolbar">
        <div className="header-search" style={{ marginLeft: 0, width: 260 }}>
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Search projects or clients"
            aria-label="Search projects"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="badge">{activeCount} active</span>
        <span className="badge">{archivedCount} archived</span>
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
            <AlertTriangle size={16} aria-hidden="true" />
          </div>
          <div>
            <h3>Could not load projects</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <div className="card list-card">
        {!loading && filtered.length === 0 ? (
          <EmptyState
            icon={<FolderKanban size={28} aria-hidden="true" />}
            title={projects.length === 0 ? "No projects yet" : "No projects match"}
            description={
              projects.length === 0
                ? "Create your first project to organize tracked time. You can always track without one."
                : "Try a different search, or show archived projects."
            }
            action={
              projects.length === 0 ? (
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Create project
                </Button>
              ) : undefined
            }
          />
        ) : (
          filtered.map((project) => (
            <div className="org-row" key={project.id}>
              <span
                className="color-dot"
                style={{ background: project.color }}
                aria-hidden="true"
              />
              <div className="org-main">
                <div className="org-name">
                  {project.name}
                  {project.archivedAtUtc ? (
                    <span className="badge" style={{ marginLeft: 7 }}>
                      Archived
                    </span>
                  ) : null}
                </div>
                <div className="org-sub">
                  {project.clientName ?? "No client"}
                  {project.defaultBillable ? " · Billable by default" : ""}
                </div>
              </div>
              <BillableBadge billable={project.defaultBillable} />
              <div className="org-actions">
                <IconButton
                  label={`Edit ${project.name}`}
                  icon={<Pencil size={14} aria-hidden="true" />}
                  onClick={() => setEditing(project)}
                />
                <IconButton
                  label={
                    project.archivedAtUtc
                      ? `Unarchive ${project.name}`
                      : `Archive ${project.name}`
                  }
                  icon={
                    project.archivedAtUtc ? (
                      <ArchiveRestore size={14} aria-hidden="true" />
                    ) : (
                      <Archive size={14} aria-hidden="true" />
                    )
                  }
                  onClick={() => void toggleArchive(project)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <ProjectDialog
        open={editing !== null}
        project={editing === "new" ? null : editing}
        clients={clients}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await reload();
          await refreshMeta();
        }}
      />
    </>
  );
}

function ProjectDialog({
  open,
  project,
  clients,
  onClose,
  onSaved,
}: {
  open: boolean;
  project: Project | null;
  clients: Client[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { pushToast } = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4f46e5");
  const [clientId, setClientId] = useState("");
  const [billable, setBillable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setColor(project?.color ?? "#4f46e5");
    setClientId(project?.clientId ?? "");
    setBillable(project?.defaultBillable ?? false);
    setError(null);
  }, [open, project]);

  const save = async () => {
    const nameError = validateName(name, "Project", 120);
    if (nameError) {
      setError(nameError);
      return;
    }
    setSaving(true);
    try {
      await api.saveProject({
        id: project?.id ?? null,
        name: name.trim(),
        color,
        clientId: clientId || null,
        defaultBillable: billable,
      });
      pushToast({
        title: project ? "Project updated" : "Project created",
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
      title={project ? "Edit project" : "New project"}
      description="Projects group entries; archived projects stay visible in history."
      dismissible={!saving}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : project ? "Save changes" : "Create project"}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="span-2">
          <Field label="Project name" error={error}>
            {(props) => (
              <input
                {...props}
                className={`input${error ? " invalid" : ""}`}
                data-autofocus
                value={name}
                maxLength={120}
                placeholder="e.g. Website redesign"
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="span-2 field">
          <span className="field-label">Color</span>
          <ColorSwatches value={color} onChange={setColor} />
        </div>
        <Field label="Client">
          {(props) => (
            <select
              {...props}
              className="select"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            >
              <option value="">No client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                  {client.archivedAtUtc ? " (archived)" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="field">
          <span className="field-label">Default billable</span>
          <label className="check" style={{ height: 34 }}>
            <input
              type="checkbox"
              checked={billable}
              onChange={(event) => setBillable(event.target.checked)}
            />
            New entries are billable
          </label>
        </div>
      </div>
      <p className="field-hint" style={{ marginTop: 10 }}>
        {clampText(
          "The client must be active. Unarchive a client before assigning it to a project.",
          180,
        )}
      </p>
    </Dialog>
  );
}
