-- TempoDesk schema v1
-- All instants are integer UTC epoch milliseconds, always aligned to whole seconds
-- (multiples of 1000) so that local-day allocations sum exactly to stored durations.
-- Durations are integer seconds.

CREATE TABLE clients (
  id              TEXT PRIMARY KEY NOT NULL,
  name            TEXT NOT NULL,
  archived_at_utc INTEGER NULL,
  deleted_at_utc  INTEGER NULL,
  created_at_utc  INTEGER NOT NULL,
  updated_at_utc  INTEGER NOT NULL,
  CHECK (length(trim(name)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX clients_active_name
  ON clients (lower(name))
  WHERE archived_at_utc IS NULL AND deleted_at_utc IS NULL;

CREATE TABLE projects (
  id               TEXT PRIMARY KEY NOT NULL,
  name             TEXT NOT NULL,
  color            TEXT NOT NULL DEFAULT '#4f46e5',
  client_id        TEXT NULL REFERENCES clients(id) ON DELETE SET NULL,
  default_billable INTEGER NOT NULL DEFAULT 0 CHECK (default_billable IN (0,1)),
  archived_at_utc  INTEGER NULL,
  deleted_at_utc   INTEGER NULL,
  created_at_utc   INTEGER NOT NULL,
  updated_at_utc   INTEGER NOT NULL,
  CHECK (length(trim(name)) BETWEEN 1 AND 120)
);

CREATE INDEX projects_client ON projects (client_id);
CREATE INDEX projects_active ON projects (archived_at_utc, deleted_at_utc);

CREATE TABLE tags (
  id              TEXT PRIMARY KEY NOT NULL,
  name            TEXT NOT NULL,
  color           TEXT NULL,
  archived_at_utc INTEGER NULL,
  deleted_at_utc  INTEGER NULL,
  created_at_utc  INTEGER NOT NULL,
  updated_at_utc  INTEGER NOT NULL,
  CHECK (length(trim(name)) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX tags_active_name
  ON tags (lower(name))
  WHERE archived_at_utc IS NULL AND deleted_at_utc IS NULL;

CREATE TABLE time_entries (
  id               TEXT PRIMARY KEY NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  project_id       TEXT NULL REFERENCES projects(id) ON DELETE SET NULL,
  start_at_utc     INTEGER NOT NULL,
  end_at_utc       INTEGER NULL,
  duration_seconds INTEGER NULL,
  is_billable      INTEGER NOT NULL DEFAULT 0 CHECK (is_billable IN (0,1)),
  source           TEXT NOT NULL DEFAULT 'timer'
                   CHECK (source IN ('timer','manual','idle_adjustment')),
  deleted_at_utc   INTEGER NULL,
  created_at_utc   INTEGER NOT NULL,
  updated_at_utc   INTEGER NOT NULL,
  CHECK (length(description) <= 1000),
  CHECK (start_at_utc % 1000 = 0),
  CHECK (end_at_utc IS NULL OR end_at_utc % 1000 = 0),
  CHECK (end_at_utc IS NULL OR end_at_utc >= start_at_utc),
  CHECK (
    (end_at_utc IS NULL AND duration_seconds IS NULL) OR
    (end_at_utc IS NOT NULL AND duration_seconds IS NOT NULL AND duration_seconds >= 1)
  )
);

-- Exactly zero or one unfinished, non-deleted entry. The expression evaluates to 1 for
-- active rows and NULL for the rest; NULLs are distinct in a unique index, so only the
-- single 1 value is constrained.
CREATE UNIQUE INDEX time_entries_one_active
  ON time_entries ((CASE WHEN end_at_utc IS NULL AND deleted_at_utc IS NULL THEN 1 END));

CREATE INDEX time_entries_start ON time_entries (start_at_utc);
CREATE INDEX time_entries_project_start ON time_entries (project_id, start_at_utc);
CREATE INDEX time_entries_deleted ON time_entries (deleted_at_utc);
CREATE INDEX time_entries_end ON time_entries (end_at_utc);

CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE INDEX entry_tags_tag ON entry_tags (tag_id);

CREATE TABLE idle_review_events (
  id                     TEXT PRIMARY KEY NOT NULL,
  timer_entry_id         TEXT NULL REFERENCES time_entries(id) ON DELETE SET NULL,
  kind                   TEXT NOT NULL DEFAULT 'idle' CHECK (kind IN ('idle','sleep')),
  idle_started_at_utc    INTEGER NOT NULL,
  activity_resumed_at_utc INTEGER NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','keep','exclude','stop_at_idle','stale')),
  result_entry_id        TEXT NULL REFERENCES time_entries(id) ON DELETE SET NULL,
  resolved_at_utc        INTEGER NULL,
  created_at_utc         INTEGER NOT NULL
);

CREATE INDEX idle_review_pending ON idle_review_events (status, created_at_utc);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL
);

CREATE TABLE runtime_state (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
