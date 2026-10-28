import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Building2, Pencil, Plus, Search } from "lucide-react";
import { Button, IconButton } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { Field } from "../../components/Field";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import type { Client, Project } from "../../lib/types";
import { validateName } from "../../lib/validators";

export function ClientsPage() {
  const { dataVersion, refreshMeta } = useAppData();
  const { pushToast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [nextClients, nextProjects] = await Promise.all([
        api.listClients(true),
        api.listProjects(true),
      ]);
      setClients(nextClients);
      setProjects(nextProjects);
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
    return clients.filter((client) => {
      if (!showArchived && client.archivedAtUtc) return false;
      return !needle || client.name.toLowerCase().includes(needle);
    });
  }, [clients, query, showArchived]);

  const projectCount = (clientId: string) =>
    projects.filter((project) => project.clientId === clientId).length;

  const toggleArchive = async (client: Client) => {
    try {
      await api.archiveClient(client.id, !client.archivedAtUtc);
      pushToast({
        title: client.archivedAtUtc ? "Client unarchived" : "Client archived",
        message: client.archivedAtUtc
          ? "It can be assigned to projects again."
          : "Existing projects and entries keep their client association.",
        tone: "success",
      });
      await reload();
      await refreshMeta();
    } catch (err) {
      pushToast({
        title: "Could not update the client",
        message: normalizeError(err).message,
        tone: "error",
      });
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Clients</h1>
          <div className="page-sub">
            Link projects to clients for reporting. Active client names must be unique.
          </div>
        </div>
        <div className="page-header-actions">
          <Button
            variant="primary"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => setEditing("new")}
          >
            New client
          </Button>
        </div>
      </div>

      <div className="list-toolbar">
        <div className="header-search" style={{ marginLeft: 0, width: 260 }}>
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Search clients"
            aria-label="Search clients"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="badge">{clients.filter((c) => !c.archivedAtUtc).length} active</span>
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
            <Building2 size={16} aria-hidden="true" />
          </div>
          <div>
            <h3>Could not load clients</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <div className="card list-card">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Building2 size={28} aria-hidden="true" />}
            title={clients.length === 0 ? "No clients yet" : "No clients match"}
            description={
              clients.length === 0
                ? "Clients are optional. Add one when you want to group projects for reports."
                : "Try another search or show archived clients."
            }
            action={
              clients.length === 0 ? (
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Create client
                </Button>
              ) : undefined
            }
          />
        ) : (
          filtered.map((client) => (
            <div className="org-row" key={client.id}>
              <span
                className="color-dot"
                style={{
                  background: client.archivedAtUtc ? "var(--faint)" : "var(--teal)",
                }}
                aria-hidden="true"
              />
              <div className="org-main">
                <div className="org-name">
                  {client.name}
                  {client.archivedAtUtc ? (
                    <span className="badge" style={{ marginLeft: 7 }}>
                      Archived
                    </span>
                  ) : null}
                </div>
                <div className="org-sub">
                  {projectCount(client.id)}{" "}
                  {projectCount(client.id) === 1 ? "project" : "projects"}
                </div>
              </div>
              <div className="org-actions">
                <IconButton
                  label={`Edit ${client.name}`}
                  icon={<Pencil size={14} aria-hidden="true" />}
                  onClick={() => setEditing(client)}
                />
                <IconButton
                  label={
                    client.archivedAtUtc
                      ? `Unarchive ${client.name}`
                      : `Archive ${client.name}`
                  }
                  icon={
                    client.archivedAtUtc ? (
                      <ArchiveRestore size={14} aria-hidden="true" />
                    ) : (
                      <Archive size={14} aria-hidden="true" />
                    )
                  }
                  onClick={() => void toggleArchive(client)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <ClientDialog
        open={editing !== null}
        client={editing === "new" ? null : editing}
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

function ClientDialog({
  open,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  client: Client | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { pushToast } = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(client?.name ?? "");
    setError(null);
  }, [open, client]);

  const save = async () => {
    const nameError = validateName(name, "Client", 120);
    if (nameError) {
      setError(nameError);
      return;
    }
    setSaving(true);
    try {
      await api.saveClient({ id: client?.id ?? null, name: name.trim() });
      pushToast({
        title: client ? "Client updated" : "Client created",
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
      title={client ? "Edit client" : "New client"}
      description={
        client?.archivedAtUtc
          ? "Archived clients cannot be renamed. Unarchive it first."
          : "A client can be linked to many projects."
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
            onClick={() => void save()}
            disabled={saving || Boolean(client?.archivedAtUtc)}
          >
            {saving ? "Saving…" : client ? "Save changes" : "Create client"}
          </Button>
        </>
      }
    >
      <Field label="Client name" error={error}>
        {(props) => (
          <input
            {...props}
            className={`input${error ? " invalid" : ""}`}
            data-autofocus
            value={name}
            maxLength={120}
            placeholder="e.g. Acme Studio"
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}
