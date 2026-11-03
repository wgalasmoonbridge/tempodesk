CREATE TABLE task_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    project_id TEXT REFERENCES projects(id),
    is_billable INTEGER NOT NULL DEFAULT 0 CHECK (is_billable IN (0, 1)),
    tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tag_ids_json))
);

CREATE TABLE bulk_edit_undo (
    id TEXT PRIMARY KEY,
    snapshots_json TEXT NOT NULL,
    created_at_utc INTEGER NOT NULL
);
