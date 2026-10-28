# TempoDesk — Native-Feeling Desktop Time Tracker

**Product Requirements Document (PRD)**  
**Version:** 1.0  
**Date:** 2026-10-28  
**Status:** Ready for implementation  
**Working name:** TempoDesk (replaceable)  
**Primary platforms:** Windows 11 and macOS 13+ (desktop; x64/ARM64 where toolchain supports)  
**Authoring intention:** This document is the source of truth for an autonomous coding agent (Pi). Implement incrementally with independently verifiable milestones.

---

## 0. Instructions to the coding agent

You are building a **real, installable desktop application**, not a mockup, website, browser extension, or Clockify API client. No internet or external account should be needed to use the MVP. The app is *inspired by common Clockify time-tracking workflows*, but must have its own design and assets.

1. Read this PRD completely before editing files. Inspect the existing repository, if any.
2. Create `IMPLEMENTATION_PLAN.md` with milestones, risks, dependencies, and a checklist mapped to FR IDs below. Then begin implementation; do not stop after planning.
3. Prefer **Tauri 2 + React + TypeScript + Vite + Rust + SQLite**. Use maintained libraries and lock their versions. Check installed toolchain and repository before choosing exact package versions.
4. Build actual working features end to end. Do not substitute static mock data or a front-end-only simulation for any MVP requirement.
5. Treat app state and SQLite writes as trusted Rust-side domain operations. Do not give the UI arbitrary SQL execution or unrestricted OS shell access.
6. Run lint, typecheck, unit tests, integration tests, and platform-appropriate build checks at each milestone. Fix failures rather than reporting false success.
7. When a capability requires an OS permission or cannot be implemented on the current host, feature-gate it, provide a graceful fallback, record the limitation, and continue other work.
8. Never silently collect user activity. All app activity monitoring is opt-in, off by default, local-only, and deferred beyond the MVP.
9. Provide an actionable `README.md`, test evidence, a feature-status checklist, and installation/build instructions. Report what was actually tested vs not tested.
10. Keep scope disciplined: implement the MVP (P0) before P1. Do not add SaaS authentication, cloud sync, AI features, payroll, or team administration without explicit direction.

## 1. Product vision

**Problem:** Individuals and freelancers often need a lightweight way to record work sessions, organize them by project and client, and review time spent. Browser-centric products can interrupt the desktop workflow. Users need a tracker that is quick to operate, works offline, and offers the conveniences of a native desktop app.

**Solution:** TempoDesk is a private, local-first time tracker offering one-click timer control, manual entries, projects/clients/tags, weekly timesheets, reports, and OS-native integrations. It lives in the system tray/menu bar, respects system appearance and shortcuts, persists data on the device, and asks before taking any action involving idle time.

**Differentiators:**
- Desktop-first workflow: app window, native system menus/dialogs, tray/menu-bar popover, global shortcuts, OS notifications, autostart option.
- Local-first: no account, no background network dependency, resilient to app restarts and offline use.
- Privacy by default: no screenshots, keystrokes, browser-history collection, or employer monitoring.
- Visual quality: polished adaptive layout that fits macOS and Windows conventions rather than copying Clockify's UI.

### Personas / primary jobs

- **Solo developer:** Start a coding timer immediately, switch projects, recover after closing the window, and view weekly hours.
- **Freelancer/consultant:** Assign tracked hours to clients and projects, mark billable work, export a CSV for invoices.
- **Professional:** Enter missed sessions manually, review idle gaps, and obtain accurate workday totals.

### MVP success criteria

- New user can create a project and start a timer in <= 60 seconds, with zero sign-in steps.
- Timer starts/stops in <= 2 user interactions from the open main window and <= 2 from the tray/menu-bar UI.
- The user can leave the app running in the background and reopen it without losing timer state.
- All records remain accessible without network access.
- Report totals match the sum of saved entries to the second; exported CSV matches the report's visible filters.
- No known data-loss failures in restart/crash-recovery acceptance tests.
- Main flows are keyboard navigable and work in light/dark OS modes.

## 2. Scope and priority

| Priority | Capability | MVP release decision |
|---|---|---|
| P0 | One running timer, start/stop/restart recent task | Required |
| P0 | Manual time entries: create, edit, delete, cross-midnight | Required |
| P0 | Local projects, clients, tags; billable flag | Required |
| P0 | Entry history by day, search and filters | Required |
| P0 | Weekly timesheet (read/edit using existing entry data) | Required |
| P0 | Summary/detailed reports and CSV export | Required |
| P0 | System tray/menu-bar quick controls and close-to-tray | Required |
| P0 | Global shortcut, configurable key binding | Required; safe fallback if denied |
| P0 | OS theme, native window controls, native dialogs and notifications | Required; OS permissions respected |
| P0 | Idle detection with explicit review; no silent removal | Required where OS API permits |
| P0 | Preferences, first-run onboarding, local backup/restore | Required |
| P0 | Single instance, data migrations, recover running timer after restart | Required |
| P1 | Visual daily calendar timeline / drag-to-create entries | After MVP |
| P1 | Pomodoro focus/break cycles and reminders | After MVP |
| P1 | Optional local app-activity auto-tracker with opt-in permission | After MVP; separate gated module |
| P1 | PDF/XLSX report export, rates and financial summaries | After MVP |
| P1 | Signed installer and updater pipeline for every target OS | After MVP (development installers in P0) |
| P2 | Cross-device sync, accounts, collaboration, approvals, invoicing | Out of scope until specified |
| P2 | Screenshots, employee surveillance, GPS, timesheet approvals | Explicitly not in MVP |

## 3. Desktop platform / UI strategy

### Technology choice

- **Shell:** Tauri 2, using native OS windows, menu, tray, notifications, file dialogs and lifecycle events.
- **Frontend:** React + TypeScript + Vite. Use a small accessible component layer (e.g. Radix primitives where helpful) and styling tokens (CSS variables or Tailwind).
- **Backend:** Rust commands/services, SQLite via a Rust SQLite library (`rusqlite` or `sqlx`) and migrations. Centralize business logic in Rust.
- **State:** React Query or a small typed state store for UI; Rust is source of truth for timer and data. Typed commands/events cross the Tauri boundary.
- **Tests:** Rust unit/integration tests, TypeScript tests with Vitest/React Testing Library, end-to-end desktop smoke tests if host/toolchain supports them.

**Important distinction:** Tauri embeds OS-native webviews, **not native SwiftUI or WinUI controls**. Deliver a high-quality, OS-adaptive desktop *look and behavior* via the design system and native system integration. If strictly platform-native content widgets are later required, that would be a separate SwiftUI/WinUI implementation or shell effort, not a claim about this MVP.

### OS-adaptive design requirements (UX-001)

- Use native window titlebar and traffic-light/control buttons by default. Do not make a browser-like fake titlebar.
- Choose platform fonts: macOS system font; Windows Segoe UI or system font. Respect OS font scaling and reduced-motion preferences.
- Mirror OS appearance (system/light/dark), with user override. Persist choice.
- Use a restrained palette, subtle dividers, compact dense lists, accessible contrast, and 8px-based spacing. Brand accent: indigo/teal (original logo, no Clockify identity).
- macOS: familiar grouped preferences, menu bar app controls, Command-based shortcuts, conventional context menus.
- Windows: Windows 11-like spacing/hover/focus treatment, taskbar/tray integration, Control-based shortcuts, Windows-style settings.
- Native open/save dialogs for backups and CSV exports; native notifications when authorized; avoid browser alert/confirm.
- Support 1024x700 main window minimum (responsive down to ~850px width), keyboard focus indicators, proper labels, and accessible error text.
- The app remains usable without transparency, blur, or special compositor effects; visual effects may be optional polish.

### Primary information architecture (UX-002)

**Main window (default about 1180 x 760):**

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ TempoDesk                                        Search   Today   Settings │
├────────────────┬───────────────────────────────────────────────────────────┤
│ Overview       │ What are you working on?                     01:23:45 [■]│
│ Time Tracker * │ Project ▾    Client   Tags   Billable ☐      [Start/Stop] │
│ Timesheet      ├───────────────────────────────────────────────────────────┤
│ Calendar (P1)  │ Today — Wed, Oct 28                              06:45:00│
│ Reports        │ • Build API            Project Alpha  09:00–11:10  02:10  │
│ Projects       │ • Review PRD          Project Alpha  11:25–12:05  00:40  │
│ Clients        │ • Meeting             Internal       13:00–14:05  01:05  │
│ Tags           │ Yesterday ...                                         ...│
│ Settings       │                                       [+ Manual entry]  │
└────────────────┴───────────────────────────────────────────────────────────┘
```

**Screens:**
1. **Time Tracker:** prominent start/stop row; running status; daily grouped entries with resume/edit/delete actions; daily/weekly total.
2. **Timesheet:** week selector, rows of projects/tasks, seven date columns, totals; edit cell by showing underlying entries or a short entry editor; no second independent time ledger.
3. **Reports:** summary cards (today, this week, billable); bar chart by date; breakdown by project/client; detailed entries table; filters; export CSV.
4. **Projects/Clients/Tags:** list with create/edit/archive; client linked to projects; colors for projects; search.
5. **Settings:** general, appearance, idle, shortcuts, data/backup, privacy, about.
6. **Tray/menu bar:** live timer status, Start/Stop, recent project/task, Open TempoDesk, Preferences, Quit. Show a compact popup or native tray menu; either must function.

**Interaction standards:**
- Only one running timer per local user/installation.
- Clicking resume on a prior entry creates a NEW session with copied metadata (never mutates prior times).
- In a changing-project workflow, starting another timer atomically stops the previous running timer and begins the next, with visible feedback.
- Show meaningful empty states, inline validation, undo/toast for reversible actions, and clear destructive confirmations.
- Avoid page reloads, external browser UI, and fake/placeholder actions.

## 4. Detailed functional requirements (MVP/P0)

### 4.1 Tracking & time entries

**FR-001 — Start timer.** User can enter a description and optionally project, tags, billable status, then Start. Description may be empty; default billable depends on project setting (default false). Start must persist immediately and display elapsed time within ~1 second.

**FR-002 — Stop timer.** Stop finalizes exact start/end timestamps and a nonnegative duration. Timer continues when the main window is hidden; only explicit Stop, approved idle action, or OS shutdown policy stops it.

**FR-003 — Single active timer.** Enforce at most one unfinished entry in a transaction or an equivalent database invariant. Start while one is active: show a visible confirmation or intentionally implement atomic switch. No overlapping running entries can be created accidentally.

**FR-004 — Resume past work.** Resume copies description/project/client association/tags/billable status into a new active session; prior entry remains unchanged.

**FR-005 — Manual entry.** Create entries with local date, start time/end time or duration. If end time is earlier than start, prompt for next-day end. Store UTC instants and resolve local timezone at creation. Validation: duration > 0, max manual entry 24h (configurable later), no invalid timestamps. Manual overlap is permitted but flagged with a nonblocking warning.

**FR-006 — Edit/delete entries.** Update description, project, tags, billable, start/end. A running entry's start time can be edited, but its end time cannot be committed until stopped. Delete shows confirmation; soft-delete is preferred for undo/recovery. Visible totals update immediately after commit.

**FR-007 — Search/filter.** History can be filtered by date range, project, client (via project), tag, billable status, and free-text description. A clear-all action resets filters.

**FR-008 — Day boundaries/time zones.** UTC is authoritative for storage. For daily/weekly summaries, split elapsed intervals at **local calendar midnight** in the chosen display time zone (default OS locale); preserve the original underlying entry. Support daylight saving transitions and crossing midnight. Never assume a day is exactly 24h.

**FR-009 — Sleep, clock changes, crashes.** Persist active session start and last-known state transactionally. In process use a monotonic clock for smooth UI display, but persist instants in UTC; don't store the UI counter as the source of truth. On wake/restart, reconstruct running state and flag ambiguous gaps caused by sleep/clock changes for user review; never silently discard recorded time. Simulate process kill, suspended host, wall-clock adjustment and a timezone change in tests.

**FR-010 — Entry presentation.** Show HH:MM:SS on active timer and HH:MM on list totals by default; offer HH:MM:SS detail and optionally decimal-hour report formatting. Aggregations use integer seconds before formatting and rounding.

### 4.2 Organization

**FR-011 — Projects.** CRUD and archive/unarchive local projects, with name, color, optional default billable status, optional client link. Archived project remains visible in old entries but is hidden from new-entry selectors unless explicitly included.

**FR-012 — Clients.** CRUD/archive local clients, unique display name within active records. One client can be linked to many projects; association belongs to project in MVP.

**FR-013 — Tags.** CRUD tags and attach many tags to many entries. Changing a tag name updates future display of existing entries. Soft deletion must not erase historical reports unexpectedly.

### 4.3 Timesheet and reporting

**FR-014 — Weekly timesheet.** Monday-start by default, configurable Sunday; navigate weeks. Group existing entries by project + description (task-label surrogate in MVP). Show daily totals and weekly totals. Editing a cell opens an editor for sessions on that day, or creates a new manual entry. Do not overwrite multiple entries with an aggregated number.

**FR-015 — Reports.** Filters: preset date range (Today, This Week, Last Week, This Month, Custom), project, client, tag, billable. Show total time, billable time, nonbillable time; daily bar chart; group by project/client; a detailed sortable table. All widgets share the same filters and computation layer.

**FR-016 — Export.** Export filtered detailed entries as RFC 4180 CSV via OS Save dialog, UTF-8 with header, CSV-safe escaping. Columns: entry ID, description, project, client, tags, billable, local start date/time, local end date/time, duration seconds, decimal hours, timezone. Export total rows and filter range in UI confirmation. No service or login.

### 4.4 Native desktop behavior

**FR-017 — Tray/menu bar.** On supported Windows/macOS desktop platforms show an app tray/menu-bar icon even while window is hidden. Native menu offers current status, Start/Stop, last 5 recent entries (resume), Open, Settings, Quit. Opening restores/focuses existing window. Quit explicitly exits and applies policy below.

**FR-018 — Close/minimize preferences.** Default: closing main window hides to tray while timer may continue; display a one-time explanation in onboarding. Preference: close-to-tray ON/OFF. Explicit Quit asks whether to stop an active timer or preserve it as running until next launch; default safer choice is Stop and save, with clear action labels. On OS shutdown, perform best-effort graceful stop and recovery markers; never rely on shutdown callbacks alone.

**FR-019 — Shortcuts.** Provide configurable global shortcut for open/hide app (`CmdOrCtrl+Shift+T` suggested) and a separate shortcut to toggle the timer (`CmdOrCtrl+Shift+Y` suggested). Validate collisions, show failure without crashing, and let user disable either. Normal focused-window shortcuts also work with menu items.

**FR-020 — Idle detection.** Opt-in (default OFF), threshold 5 minutes (configurable 1–60). Use supported OS idle-time APIs; detect transition once per idle episode, queue a non-spamming native/in-app notification. When active again, ask whether to **Keep entire time**, **Remove the idle interval from a session** (split preserving auditable segments), or **End at idle start**. No auto-deletion without an explicit preference and confirmation; for MVP, do not offer auto-deletion at all. If OS API unavailable or permission denied, keep timer running and explain why.

**FR-021 — Notifications/reminders.** Permission-aware native notifications for idle review and optionally user-configured tracking reminders. If denied, use in-app indicators; never repeatedly request permission.

**FR-022 — Appearance/localization settings.** Follow OS theme by default; light/dark overrides; time zone default system; 12/24-hour format from locale (override optional); start-of-week preference, launch at login OFF by default.

**FR-023 — First-run onboarding.** At most 3 simple steps: brief app introduction, optional first project, optional permissions / startup preferences. All permissions explained and skippable. Show main tracker immediately thereafter. Include sample project suggestion but no fictional historical time logs.

**FR-024 — Backup and restore.** Export a versioned local backup with project/client/tag/entry/settings data (excluding machine-specific OS permission states and secrets). User chooses file via native dialog. Restore validates schema, previews counts, requires confirmation, and restores transactionally after creating a safety backup. No cloud uploads.

**FR-025 — Single-instance and updates.** Relaunch focuses existing window; does not start a duplicate timer process. Schema migrations are versioned and reversible by safety backup where practical. MVP builds an installable package on available host; signed auto-updates postponed to P1.

### 4.5 Data protection

**FR-026 — Privacy/security.** Entire P0 app is local by design; no analytics/telemetry/network calls. No screenshots, keystroke logging, document titles or URL collection. Never invoke arbitrary shell commands based on UI content. Tauri permissions are least-privilege and scoped per window/plugin; no unrestricted filesystem access. Validate all IPC payloads in Rust. Store DB in OS app data directory with user-level access controls; backup may contain sensitive work names, so warn the user. Avoid logging task descriptions in error logs.

**FR-027 — Data integrity.** Use SQLite migrations, foreign keys, parameterized queries, transactions, indexes, `PRAGMA journal_mode=WAL` where appropriate, and integrity checks. Prefer integer epoch milliseconds for timestamps and integer seconds (or milliseconds) for duration; do not use binary float for core time arithmetic. Handle database corruption/write errors with actionable error messages, not silent reset.

## 5. Optional later requirements — do NOT block MVP

**P1-001 — Calendar view:** daily/weekly time-block display; hover details; click/drag creation; edit existing entries.

**P1-002 — Pomodoro:** configurable work/short break cycles, system notifications, dedicated break timer, without mutating tracked time unexpectedly.

**P1-003 — Automatic activity tracking (privacy-first):** a **separate explicit opt-in** module. Detect foreground application name and active duration using platform APIs only with lawful OS permissions; do not automatically record URLs, document titles, keystrokes, screen images, or window content. Store solely in local SQLite with retention defaults (e.g., 30 days) and deletion controls. Review timeline and explicitly convert selected activity into time entries. Never make inferred app activity billable or a work entry without user confirmation. Mac accessibility/screen-recording/automation requirements vary; assess permissions separately before coding. Include conspicuous recording state, pause, excluded apps, and Delete All Data. No background surveillance by default.

**P1-004 — Rate cards:** project hourly rates and earned amount in reports; store money as integer minor currency units and currency codes.

**P1-005 — PDF/XLSX:** locally generated reports, only after summary and detailed CSV reporting pass tests.

**P2-001 — Sync/team features:** require a separate backend PRD specifying authentication, conflict resolution, encryption, roles, authorization and privacy controls.

## 6. Data model

All IDs are UUID/ULID strings. `created_at_utc`, `updated_at_utc` stored consistently as UTC instants. Include `deleted_at_utc` for soft deletes where appropriate. Schema below is conceptual; convert to actual migration SQL with constraints and indexes.

```text
clients
  id PK, name, archived_at_utc NULL, created_at_utc, updated_at_utc

projects
  id PK, name, color, client_id FK NULL,
  default_billable BOOLEAN DEFAULT 0,
  archived_at_utc NULL, created_at_utc, updated_at_utc

tags
  id PK, name UNIQUE, color NULL, archived_at_utc NULL,
  created_at_utc, updated_at_utc

time_entries
  id PK, description TEXT NOT NULL DEFAULT '', project_id FK NULL,
  start_at_utc INTEGER NOT NULL, end_at_utc INTEGER NULL,
  duration_seconds INTEGER NULL, is_billable BOOLEAN NOT NULL DEFAULT 0,
  source ENUM('timer','manual','idle_adjustment') NOT NULL,
  deleted_at_utc INTEGER NULL,
  created_at_utc, updated_at_utc

entry_tags
  entry_id FK, tag_id FK, PRIMARY KEY(entry_id,tag_id)

app_settings
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL

idle_review_events
  id PK, timer_entry_id FK, idle_started_at_utc,
  activity_resumed_at_utc, status ENUM('pending','keep','exclude','stop_at_idle'),
  resolved_at_utc NULL

schema_migrations
  version, applied_at_utc
```

Data constraints and rules:
- A **unique partial index** on unfinished, non-deleted time entries enforces zero or one active timer (SQLite syntax to be selected in migration).
- Completed entry requires end >= start and duration >= 1 second. Active entry has NULL end/duration. Use a consistent rule for all timer operations.
- `entry_tags` prevents duplicate associations; referential integrity ON.
- Prefer preserving historical project/client/tag names after archive; do not cascade-delete history.
- Index `start_at_utc`, `project_id`, `deleted_at_utc`, and report/filter paths.
- For idle exclusion, split time into explicit persisted intervals, or add `excluded_intervals` relation with audit metadata. Pick a single well-tested implementation and document aggregation behavior; never silently adjust a display-only total.
- Reports calculate duration overlap with the requested display-day boundaries. When an entry spans days, proportionally allocate elapsed seconds by the exact boundary instant rather than its start date.
- If the OS changes time zone after the entry was created, report using the currently selected display time zone by default; retaining original creation-offset metadata is optional but recommended for interpretability.

## 7. Tauri/Rust domain API

Expose a small, typed command surface. Suggested names (may adapt to repository idioms):

```typescript
// Domain payloads are illustrative, not an excuse to skip runtime validation.
getAppStatus(): Promise<{ activeEntry: TimeEntry | null; todaySeconds: number }>;
startTimer(input: StartTimerInput): Promise<TimeEntry>;
stopTimer(): Promise<TimeEntry>;
switchTimer(input: StartTimerInput): Promise<TimeEntry>;
resumeEntry(entryId: string): Promise<TimeEntry>;
listEntries(filter: EntryFilter): Promise<TimeEntry[]>;
createManualEntry(input: ManualEntryInput): Promise<TimeEntry>;
updateEntry(id: string, patch: EntryPatch): Promise<TimeEntry>;
deleteEntry(id: string): Promise<void>;
listProjects(): Promise<Project[]>; saveProject(input: ProjectInput): Promise<Project>;
listClients(): Promise<Client[]>; saveClient(input: ClientInput): Promise<Client>;
listTags(): Promise<Tag[]>; saveTag(input: TagInput): Promise<Tag>;
getTimesheet(weekStart: string, timezone: string): Promise<Timesheet>;
getReport(filter: ReportFilter): Promise<ReportResult>;
exportReportCsv(filter: ReportFilter, destination: string): Promise<ExportResult>;
getSettings(): Promise<AppSettings>; updateSettings(patch: SettingsPatch): Promise<AppSettings>;
getPendingIdleReview(): Promise<IdleReviewEvent[]>;
resolveIdleReview(id: string, action: 'keep' | 'exclude' | 'stop_at_idle'): Promise<void>;
createBackup(destination: string): Promise<BackupResult>;
previewRestore(source: string): Promise<BackupPreview>;
restoreBackup(source: string): Promise<RestoreResult>;
```

- Prefer native dialog plugin to obtain user-selected export/import paths and pass only authorized paths to commands. Validate destination and prevent writes outside explicitly chosen paths / app scope.
- Never expose an unrestricted `execute_sql` or arbitrary `run_command` IPC endpoint.
- Emit typed `timer-state-changed`, `entry-updated`, `settings-updated`, `idle-review-required` events as needed; UI should resync on wake/focus rather than relying solely on missed events.
- All timer transitions and persistence must be serialized via a service/repository layer; do not have separate competing timer logic in multiple components.

## 8. Timekeeping algorithm and edge cases

1. Starting a timer persists `start_at_utc` and a singleton active record in one transaction; then emits a state event.
2. The visible ticker uses a monotonic clock plus a periodically resynced persisted UTC start, updated ~1 Hz; background event timing may vary. The ticker is **display only**.
3. Stopping obtains authoritative current UTC instant, validates nonnegative elapsed interval, and stores end/duration in a transaction. The operation is idempotent at the service level: double-click Stop must not produce two entries.
4. A session that spans midnight contributes its time to both days in timesheet/report views. Day partitions must account for DST and leap year.
5. If app window closes, Rust backend remains alive and tray controls remain usable. If process exits or crashes with a running record, on next launch prompt to continue or finish at estimated last-known timestamp; never erase it.
6. When system wakes, compute/flag an idle or sleep gap for review if applicable; avoid blindly trusting a stale UI timer.
7. If the clock moves backward/forward unexpectedly, flag the inconsistency and let user correct the session. Preserve original timestamps until user confirms.
8. Do not hide or suppress overlapping manual entries; warn, allow user to fix.
9. Support empty project, deleted/archived metadata, Unicode task descriptions, empty history, high-volume history (10k+ entries), and explicit app quit while active.
10. Prefer database transaction snapshots for consistent reporting while timer is changing.

## 9. Nonfunctional requirements

- **Performance:** cold start target < 3s on a typical supported laptop; start/stop response target < 250ms for local DB operation excluding OS overhead; smooth scrolling for 10k entries through pagination/virtualization.
- **Reliability:** no lost completed entries from routine close/reopen; resilience to double actions and app crash. Migration failures halt safely and preserve DB.
- **Offline:** MVP makes zero essential network requests; no login, backend, or telemetry required.
- **Security:** minimal plugin capabilities; no arbitrary shell commands; no secrets in repository; input validation and safe export/backup paths.
- **Accessibility:** keyboard navigation, screen-reader labels, >= 4.5:1 contrast for normal text, visible focus, reduced-motion support, scalable fonts.
- **Platform:** Windows 11 and macOS 13+ target. Host-specific builds can be verified on that host; the other platform is marked unverified until tested on hardware/CI. Linux can be considered later, not guaranteed by the MVP.
- **Distribution:** `tauri build` creates a usable installer/package for the host. Code signing/notarization is required for public distribution but is deferred unless credentials exist.
- **No account/lock-in:** export all user data via CSV/backup. Deleting local data must require explicit confirmation.

## 10. Acceptance scenarios (must automate where feasible)

| ID | Given / When / Then | Priority |
|---|---|---|
| AC-01 | Fresh install -> create project -> start timer -> stop -> correct entry is visible and persisted | P0 |
| AC-02 | Start timer -> close main window -> wait -> reopen from tray -> timer remains active and elapsed increases | P0 |
| AC-03 | Running timer -> press global toggle shortcut -> stops exactly once; shortcut conflict shows recoverable error | P0 |
| AC-04 | Running A -> switch to B -> A finishes, B starts, never two unfinished entries | P0 |
| AC-05 | Resume old entry -> old entry remains intact; new timer has same metadata | P0 |
| AC-06 | Manual entry 23:30 to 00:30 next day -> 30 minutes on each local day (no DST boundary) | P0 |
| AC-07 | Entry through DST transition -> daily seconds match actual elapsed instants, not fixed 24h assumption | P0 |
| AC-08 | Start timer -> terminate process -> relaunch -> pending active timer is recovered/reviewable; no silent loss | P0 |
| AC-09 | Add/edit/delete tagged entries -> list, timesheet, report, CSV totals stay consistent | P0 |
| AC-10 | Filter to one project and week -> summary, detailed report, and exported CSV describe same subset | P0 |
| AC-11 | App offline from first launch -> all P0 features work | P0 |
| AC-12 | Change system light/dark or override -> UI updates with valid contrast; no broken tray controls | P0 |
| AC-13 | Idle detection OFF -> no activity polling; ON and threshold exceeded -> only one review event per episode; no silent deletion | P0 |
| AC-14 | Deny OS notifications/idle permission -> app continues, status explains degraded feature | P0 |
| AC-15 | Backup -> delete records -> restore -> projects, tags, entries, totals recover; invalid backup changes nothing | P0 |
| AC-16 | Try invalid dates, empty optional fields, Unicode, SQL-like input -> validation handles safely; database remains intact | P0 |
| AC-17 | Open app twice -> only one instance and one active timer database | P0 |
| AC-18 | Open with 10,000 records -> reports calculate accurately; list remains responsive | P0 |
| AC-19 | Main functions accessible by keyboard and screen reader labels; focus not trapped | P0 |
| AC-20 | Installer/package from target host launches actual app and creates data in OS app data directory | P0 |

## 11. Delivery milestones / implementation order

### Milestone M0 — Repository & runnable shell
- Scaffold Tauri 2 / React / TypeScript / Rust app and platform-aware design tokens.
- Add app icon, navigation shell, settings route, dark/light mode, native window/titlebar, CI scripts.
- Set up Rust/TS lint, format, tests, and typed Tauri IPC boundaries.
- **Exit:** App builds and launches, navigation works, no fake data is passed off as functionality.

### Milestone M1 — Persistence & timer core
- SQLite schema/migrations and repositories; domain tests; active timer invariant.
- Start/stop/switch/resume timer; recover on reopen; day/timezone calculation functions.
- Main tracker UI with real database entries, manual entry modal and validations.
- **Exit:** AC-01, AC-04, AC-05, AC-06, AC-08 pass.

### Milestone M2 — Project classification & editing
- Client/project/tag CRUD, archive, selected projects/tags; edit/delete history; filters.
- Desktop list with empty states, keyboard operation, notifications/toasts.
- **Exit:** AC-09 (classification/history) and AC-16 pass.

### Milestone M3 — Native desktop integration
- Tray/menu bar, close-to-tray, quick actions; singleton instance, preferences.
- Global hotkeys; native notifications; idle detection with explicit review, fallback permission states.
- **Exit:** AC-02, AC-03, AC-12, AC-13, AC-14, AC-17 pass.

### Milestone M4 — Timesheet, reporting & data portability
- Weekly timesheet from same entries; report aggregation with day-boundary splits; filters and charts.
- CSV export, backup/restore, tested data migrations.
- **Exit:** AC-07, AC-10, AC-15, AC-18 pass.

### Milestone M5 — Polish, test & package
- Onboarding, accessibility, responsive layout, recovery flows, errors, performance.
- Package builds; README/screenshots/test record; platform verification matrix.
- **Exit:** All P0 acceptance criteria verified or explicitly documented with why a particular host is unable to verify it.

## 12. Suggested repository structure

```text
/
  PRD.md                          # copy of this document
  IMPLEMENTATION_PLAN.md
  README.md
  package.json
  src/
    app/                          # root app, router, theme, state providers
    components/                   # reusable accessible controls
    features/
      timer/  entries/  projects/  clients/  tags/
      timesheet/  reports/  settings/  onboarding/
    lib/                          # typed IPC client, time formatting, validators
    styles/
    tests/
  src-tauri/
    src/
      main.rs
      lib.rs
      commands/
      domain/                     # timer, reports, idle logic
      storage/                    # sqlite repository & migrations
      platform/                   # tray, shortcuts, idle, OS lifecycle
    migrations/
    capabilities/
    tauri.conf.json
  tests/                           # e2e and end-to-end fixtures
  docs/
    architecture.md
    TEST_REPORT.md
    PLATFORM_SUPPORT.md
```

## 13. Decision log & known risks

**Decisions (for implementation):**
- Single-user, local-only MVP. No workspace, authentication, internet, or billing server.
- Cross-platform Windows/macOS through Tauri WebView + system integration, not two separate SwiftUI/WinUI frontends.
- Local SQLite, Rust business operations, UI driven by typed IPC.
- App activity auto-tracking and calendar UI are P1, not prerequisites.
- Project and client classification for V1; advanced hierarchical tasks deferred.
- Default idle tracking OFF; explicit user review; no covert monitoring.

**Risks and mitigations:**
- Idle API differences/permissions: hide behind platform interface, feature detection, nonblocking fallback; test on both OSes.
- Tray and global shortcuts vary by OS/compositor: keep main window controls usable; report capability errors.
- Clock drift/sleep/DST: UTC/monotonic separation, reconciliation UI and thorough tests.
- Migration/backup corruption: transactional schema changes, pre-restore safety copy, validation.
- Cross-platform packaging: CI matrix and smoke test on actual OS hardware; no unsupported claim of verified platforms.
- Excessive scope: enforce M0–M5; P1 requires separate approval.

## 14. Definition of Done

MVP is done only when:

- A genuine installable desktop app exists, starts without a server or login, and stores real user data locally.
- Timer, manual entries, organization, history, timesheets, reports, CSV, tray, shortcuts, idle review, backup/restore, theme and settings work end to end on a supported host.
- Tests cover timer state invariants, persistence, DST/midnight splits, crash recovery, report math, and export correctness.
- Project includes documented setup, run, test and build commands, screenshots, a data model/migration summary and a list of platform limitations.
- `IMPLEMENTATION_PLAN.md` has each P0 FR marked done with evidence or a clearly identified blocker; no falsely marked green checks.
- No unnecessary cloud service, telemetry, covert tracking or Clockify-branded assets are included.

## 15. Reference products and technical documents

These are for capability understanding, **not** instructions to copy branding or proprietary visuals/source code.

- Clockify official product overview: https://clockify.me/
- Clockify timer features: https://clockify.me/features/timer
- Clockify desktop apps and capabilities: https://clockify.me/apps
- Clockify desktop feature differences: https://clockify.me/desktop-time-tracking
- Clockify reports: https://clockify.me/features/reports
- Clockify timesheet: https://clockify.me/features/timesheet
- Clockify auto-tracker privacy model: https://clockify.me/features/auto-tracker
- Tauri 2 official plugins and capabilities: https://v2.tauri.app/plugin/
- Tauri 2 permissions/security: https://v2.tauri.app/learn/security/using-plugin-permissions/

**Final instruction:** Prioritize M0–M5 in order and deliver usable software at each checkpoint. Build the actual app; do not stop at wireframes, mock APIs, static screenshots, or a high-level architectural proposal.
