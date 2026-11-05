-- Device-local, opt-in activity. Deliberately separate from time entries and backups.
CREATE TABLE machine_activity (
    id TEXT PRIMARY KEY NOT NULL,
    event_key TEXT UNIQUE,
    account_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    domain TEXT,
    machine_name TEXT NOT NULL,
    session_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('login', 'session_observed', 'lock', 'unlock', 'session_active', 'session_inactive', 'logoff')),
    event_at_utc INTEGER NOT NULL CHECK (event_at_utc >= 0 AND event_at_utc % 1000 = 0),
    observed_at_utc INTEGER NOT NULL CHECK (observed_at_utc >= 0 AND observed_at_utc % 1000 = 0),
    source TEXT NOT NULL,
    timing TEXT NOT NULL CHECK (timing IN ('os_reported', 'notification', 'sampled', 'observed'))
);
CREATE INDEX machine_activity_time ON machine_activity (event_at_utc DESC, id DESC);
