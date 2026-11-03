# TempoDesk Architecture

## 1. Layers

```text
React UI (src/)
   │ typed invoke / events
   ▼
Tauri commands (src-tauri/src/commands.rs)
   │ validation + app state + native events
   ▼
tempodesk-core (core/)  ← no Tauri dependency, unit/integration tested
   ├── domain::timer        start/stop/switch/resume/update/delete/recovery
   ├── domain::templates    saved task metadata, validation, start inputs
   ├── domain::bulk         transactional metadata edits, conflict-aware undo snapshots
   ├── domain::auto_backup  snapshot schedule, status, safe retention
   ├── domain::idle         keep/exclude/stop-at-idle review resolution
   ├── domain::reports      timesheet + report aggregation + CSV
   ├── domain::summary      local summary, AI prompt, Gemini response parsing
   ├── domain::portability  versioned JSON backup / validated restore
   ├── domain::timeutil     local-day/DST math
   ├── domain::validate     payload + time validation
   └── storage::*           SQLite repositories, migrations, settings
   ▼
SQLite (OS app-data directory, WAL, foreign keys)
   production / development / test profiles isolated (identifier + data directory)
```

The UI never runs SQL and never invokes a shell. The Tauri shell exposes only the command list in
`src-tauri/src/lib.rs`; all payloads are serde-typed and re-validated in Rust.

Platform integrations are isolated in `src-tauri/src/platform/`:

| Module | Responsibility |
|---|---|
| `tray.rs` | Native tray/menu-bar icon, live tooltip, start/stop, recent 5 resume, saved tasks, open/settings/quit |
| `menu.rs` | Native app menu (File/Edit/Window/Help + macOS app menu) and menu event routing |
| `shortcuts.rs` | Global shortcut registration, collision/error reporting, toggle handler |
| `window.rs` | Show/focus, close-to-tray, quit policy, clean-exit marker |
| `idle.rs` | OS idle API, 5s monitor loop, heartbeat, sleep/clock-gap review creation, notifications |
| `mod.rs` | Autostart synchronization |

## 2. Database

Migration `0002_workflows.sql` adds `task_templates` and `bulk_edit_undo` without modifying existing
entries. Templates store validated metadata, with project foreign keys and a JSON tag-ID list.
Bulk-edit undo records hold server-generated before/after metadata; an undo checks all entries
against the after values before writing any changes, and leaves independently edited times intact.
Old undo records expire during subsequent bulk edits after seven days; restore clears undo records.

History pages and full-range aggregate SQL share one set of predicates. The aggregate clips UTC
intervals to timezone-resolved local date boundaries without applying LIMIT/OFFSET. Equal timestamps
are ordered by entry ID after start/creation time to keep pagination deterministic. The renderer
advances matching running time from the aggregate's timestamp and caps it at the range end.

`src-tauri/src/backups.rs` checks scheduling every 60 seconds on a background thread, including while
the window is hidden. Snapshot construction and retention run under the database mutex. Successful
timestamps/paths and actionable errors live in runtime state. Retention only considers regular files
whose names match the app's timestamp-and-UUID automatic-backup convention; manual backups, safety
backups, symlinks, and directories are excluded. A newly written snapshot survives backwards clock
changes. Backup v2 carries templates; v1 reads default to no templates. Scheduling and folder paths
are excluded from portable backups, and restore turns scheduling off for this device.

Migration `core/migrations/0001_init.sql` creates:

- `clients`, `projects`, `tags` with `archived_at_utc`; clients/tags have unique active-name
  partial indexes; soft deletion (`deleted_at_utc`) exists for tags.
- `time_entries` with UTC epoch-ms timestamps (whole-second aligned), integer duration seconds,
  source (`timer`, `manual`, `idle_adjustment`), soft delete, CHECK constraints, and indexes on
  start time, project+start, end time and deletion.
- `entry_tags` many-to-many with FK cascade and composite PK.
- `idle_review_events` with kind (`idle`, `sleep`), pending/resolution status, resumed instant and
  result entry link.
- `app_settings` key/JSON value, and `runtime_state` for `clean_exit`, `last_heartbeat_utc`,
  `restored_at_utc`.
- `schema_migrations` is created by the Rust migrator; each migration runs in a transaction and
  updates `PRAGMA user_version`.

The active-timer invariant is enforced by both the service layer (transactional checks) and the
database:

```sql
CREATE UNIQUE INDEX time_entries_one_active
  ON time_entries ((CASE WHEN end_at_utc IS NULL AND deleted_at_utc IS NULL THEN 1 END));
```

NULL values are distinct in SQLite indexes, so only the single `1` value is constrained. A second
unfinished row is rejected even if two callers race.

Data-directory isolation: release builds resolve the official OS app-data path and ignore
`TEMPO_DATA_DIR`. Debug builds resolve a sibling `...-dev` directory, or an explicit
`TEMPO_DATA_DIR` test directory, and report the profile (`production`, `development`, `test`) via
`get_platform_info`. This keeps development, UI automation, and crash tests away from installed-app
data.

Runtime pragmas: `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, `temp_store=MEMORY`,
5s busy timeout. Startup runs `PRAGMA integrity_check`; a failure halts startup rather than resetting
data.

## 3. Timekeeping model

- All persisted instants are **integer UTC epoch milliseconds aligned to whole seconds**. This
  guarantees that per-day allocations sum exactly to stored durations.
- Completed duration = `(end - start) / 1000` as integer seconds, minimum 1 second for timer stops
  (stops clamp to 1s and align `now` down to the second to satisfy DB checks).
- The UI's running counter is display-only: it anchors to the last server instant and advances with
  `performance.now()`, so wall-clock jumps do not alter the display or stored time.
- Local-day allocation (`timeutil::split_by_local_day`) clips intervals at local midnights and
  handles DST:

  - spring-forward day = 23h, fall-back day = 25h (America/New_York tests);
  - midnight that does not exist resolves to the first valid instant of that day;
  - ambiguous midnight resolves to the earlier instant;
  - appending to a day allocates whole seconds, so totals equal the exact elapsed time.

- Reports apply `allocation_in_range` to clip entries at the requested date range, then sum per-day,
  per-billable, per-project and per-client. The detailed table and CSV use the same report object,
  with `inRangeSeconds` as the duration column, so totals and exports never diverge.

## 4. Timer / recovery lifecycle

1. `start_timer` validates project/tags, normalizes description, rejects an existing active timer
   with a stable error code, inserts the running row + tags in one transaction, and emits
   `timer-state-changed`.
2. `switch_timer` resolves metadata first, then in one transaction stops the current timer and
   inserts the new one, starting at max(now, previous end) to avoid overlap.
3. `stop_timer` is idempotent in effect: a second call returns `no_active_timer` and cannot create a
   second entry.
4. `resume_entry` copies metadata/tags into a new running row; the original is untouched.
5. Bulk history operations (`delete_entries` / `restore_entries`) run in one transaction, dedupe IDs,
   soft-delete only completed entries, skip running/unknown rows with explicit reasons, and share
   one deletion timestamp for the batch so Undo can restore the exact set.
6. A background heartbeat (5s loop, persisted every 15s) updates `last_heartbeat_utc`. A heartbeat
   gap > 90s (sleep/hibernate/clock move, either direction) queues a `sleep` review if a timer is
   running.
7. On launch, `clean_exit != 1` or an active entry left from a graceful “keep running & quit”
   produces `pending_recovery` with start, last-seen, estimated seconds and reason. The UI cannot
   dismiss it without choosing **Continue**, **Stop at last seen**, or **Stop now**. No path deletes
   the session.

## 5. Idle review

- Disabled by default. When enabled, the monitor reads aggregate OS idle seconds only.
- One pending review per active entry; when idle crosses the threshold a review row is inserted with
  `idle_started_at_utc` clamped to the session start. When input resumes, `activity_resumed_at_utc`
  is recorded. Only one event per episode.
- Resolution:
  - **Keep** → the session remains whole.
  - **Remove gap (exclude)** → stop the running entry at idle start (source marked
    `idle_adjustment`), then start a new running entry at activity resume, preserving both audited
    segments. If no timer is active by the time of resolution, the review becomes `stale` and no
    time is changed.
  - **End at idle start** → stop at idle start.
- No auto-deletion exists. Notifications are best-effort; the in-app banner is always present.

## 6. Settings

Settings are typed (`AppSettings`) and stored one JSON value per key in `app_settings`. Loading merges
defaults, normalizes invalid stored values, then exposes them to the UI. Updates are validated
(theme/week/timezone/time format/threshold/shortcut syntax and equality) before saving. Shortcut
collisions at the OS level are reported as warnings and do not block the timer. Autostart is
synchronized with the OS on every settings update.

## 7. Backup / restore / CSV

- Backup format: `{ format: "tempodesk-backup", version: 1, createdAtUtc, appVersion, clients,
  projects, tags, entries, entryTags, settings }`.
- Validation checks format/version, duplicate IDs, references, timestamp alignment, duration
  consistency, exactly ≤1 active entry, tag link integrity and description limits.
- Restore builds a safety backup in `<app-data>/backups`, then replaces all tables in one
  transaction, clears runtime state, writes a fresh heartbeat, and triggers the recovery review if
  the backup contains a running timer.
- CSV is RFC 4180 (comma, CRLF, doubled quotes) with the required columns. Duration seconds are
  in-range seconds so the CSV total equals the report total. The timezone column stores the IANA
  zone name.

## 8. Security / IPC

- No `execute_sql`, shell, or arbitrary filesystem command is exposed. The optional AI summary is the
  only outbound network feature: a user click sends the selected range aggregation to Gemini over
  HTTPS. The API key lives in the OS credential store (per data profile) and is never returned over
  IPC, logged, or backed up. AI is disabled by default and requires explicit consent.
- Writes require an absolute destination with `.csv`/`.json` extension and an existing parent
  directory; paths come from native Save/Open dialogs. No unrestricted filesystem plugin is
  initialized.
- CSP: `default-src 'self'`, scripts restricted to self (dev CSP permits Vite HMR), IPC connect
  only, data/asset images. All remote content is disallowed.
- Error payloads carry a stable code (`active_timer_exists`, `end_before_start`, `conflict`, …) and a
  human-readable message; task descriptions are not logged in error paths.

## 9. Frontend state

`AppProvider` loads platform/settings/status/metadata, subscribes to typed Tauri events, re-syncs on
window focus, and exposes actions. Pages fetch their own report/timesheet/calendar range data from
IPC. The calendar is a visual projection of `time_entries`: it clips blocks to local day boundaries,
uses wall-clock placement with DST-safe UTC conversion for creation, and opens the shared entry
editor rather than maintaining a second ledger. The theme provider follows `prefers-color-scheme`
with manual override. A top-level error boundary keeps
the DB safe if the UI crashes and offers a reload.
