# TempoDesk — Implementation Plan & Status

Source of truth: `PRD.md` (v1.0, 2026-10-28). This plan tracks the **P0 MVP**. P1 items
(calendar, Pomodoro, activity auto-tracking, PDF/XLSX, cloud sync) are intentionally not started.

**Status as of 2026-10-28:** M0–M5 complete on Windows 11 x64. P0 implemented; macOS unverified.
Detailed test evidence: [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## Host / toolchain (confirmed)

| Tool | Version | Notes |
|---|---|---|
| OS | Windows 11 x64 (10.0.26200.9711) | Only host verified. macOS is **not** tested from here. |
| Node / npm | 24.22.0 / 11.19.1 | |
| Rust | 1.99.1 (`stable-x86_64-pc-windows-gnu`) | No MSVC Build Tools and no admin rights on host; GNU + MinGW-w64 GCC 16.2.0 UCRT. |
| Tauri | 2.12.5 (CLI 2.12.4) | Compiles and launches; installer built. |
| SQLite | `rusqlite` 0.40.2 bundled | No system dependency. |
| WebView2 | Installed (155+/156+) | Windows runtime present. |

**Material deviation:** the PRD suggests Tauri/MSVC; this host uses `x86_64-pc-windows-gnu`. The
app and NSIS installer work, but public distribution should rebuild with MSVC and signing. A GNU
linker warning (`.rsrc merge failure: multiple non-default manifests`) is benign here.

## Architecture summary

- **Rust is the source of truth** in the Tauri-free `core/` crate (domain/timer, report math,
  SQLite, validation, CSV/backup). `src-tauri/` owns typed IPC and platform integration.
- **Typed IPC only.** No `execute_sql`, no shell. Every payload is validated in Rust.
- **SQLite** in the OS app-data directory: WAL, FK, versioned migrations, integrity check, and a
  partial unique index enforcing at most one active timer.
- **React 19 + TS + Vite** renders state from Rust, listens to typed events, re-syncs on focus, and
  uses a display-only monotonic ticker.
- **Native integration:** native titlebar/menu, tray/menu bar, global shortcuts, OS theme, native
  dialogs, notifications with fallback, autostart, single instance, close-to-tray.
- **Privacy:** zero network calls/telemetry; idle detection off by default; no surveillance.

## Milestones

Complexity scale used during planning: S (<0.5 day), M (0.5–1.5), L (>1.5).

### M0 — Repository & runnable shell — **COMPLETE**
| # | Task | Complexity | Status |
|---|---|---|---|
| M0-1 | npm + Tauri 2 + Vite + React + TS scaffold, git, gitignore | S | [x] |
| M0-2 | Rust crate layout, error type, SQLite connection + migrations v1 | M | [x] |
| M0-3 | Design tokens, platform fonts, light/dark/system theme provider, app shell nav | M | [x] |
| M0-4 | Settings route persisted in SQLite | S | [x] |
| M0-5 | Lint/format/test scripts, icon assets, capabilities, check pipeline | S | [x] |
| M0-6 | Native window defaults (native decorations, 1180×760, min 850×620), native menu | S | [x] |

**Exit evidence:** app builds/launches (`npm run smoke`), SQLite file created, native menu/sidebar
render, settings persisted, `npm run check` passes.

### M1 — Persistence & timer core — **COMPLETE**
| # | Task | Complexity | Status |
|---|---|---|---|
| M1-1 | Full schema (clients/projects/tags/entries/tag links/idle reviews/settings/runtime), indexes, FK, active unique index | L | [x] |
| M1-2 | Timer start/stop (idempotent)/atomic switch/resume; UTC ms; monotonic UI tick | L | [x] |
| M1-3 | Manual entry validation (overnight prompt, ≤24h, overlap warning), edit/delete soft-delete + undo | L | [x] |
| M1-4 | Tracker UI: running bar, history, manual dialog, entry editor, empty states, toasts | L | [x] |
| M1-5 | Crash/quit recovery: heartbeat, clean-exit marker, Continue / Stop at last seen / Stop now | L | [x] |
| M1-6 | Local-midnight/DST-safe day math | L | [x] |

**Exit evidence:** AC-01, AC-04, AC-05, AC-06, AC-08 pass (Rust + real UI). Kill/relaunch recovery
verified. Overnight 23:30→00:30 splits correctly. 39 Rust tests total (33 unit + 6 integration).

### M2 — Projects, clients, tags & history editing — **COMPLETE**
| # | Task | Complexity | Status |
|---|---|---|---|
| M2-1 | Client/project/tag CRUD, archive/unarchive, unique active names, color/default billable | L | [x] |
| M2-2 | Tag attach/detach, rename reflected in history, soft delete preserves history/reports | M | [x] |
| M2-3 | History filters: date range, project, client, tag, billable, free text, reset, pagination | M | [x] |
| M2-4 | Edit/delete UI with confirmation + undo; inline validation | M | [x] |
| M2-5 | Projects/Clients/Tags screens with empty states | M | [x] |

**Exit evidence:** AC-09/AC-16 pass. Tag rename/archive/delete reflected while history remains;
archived project hidden from new-entry selectors; client-linked reports verified.

### M3 — Native desktop integration — **COMPLETE (with documented automation gaps)**
| # | Task | Complexity | Status |
|---|---|---|---|
| M3-1 | Tray/menu-bar live status, start/stop, last 5 resume, open, settings, quit | L | [x] |
| M3-2 | Close-to-tray default on, quit flow (stop vs keep running) | M | [x] |
| M3-3 | Single-instance focus existing window | S | [x] |
| M3-4 | Configurable global shortcuts, collision/error reporting, disable | M | [x] |
| M3-5 | Permission-aware notifications + in-app fallback | M | [x] |
| M3-6 | Opt-in idle detection, one review/episode, Keep/Exclude/End, no auto-delete | L | [x] |
| M3-7 | Native menu, OS theme, launch at login | M | [x] |

**Exit evidence:** AC-02, AC-12 (override), AC-13, AC-17 pass. AC-03 registration + validation pass;
physical hotkey press not automatable in this session. AC-14 fallback path implemented; permission
denial not exercised. Tray creation verified; menu clicks are manual.

### M4 — Timesheet, reporting & data portability — **COMPLETE**
| # | Task | Complexity | Status |
|---|---|---|---|
| M4-1 | Weekly timesheet, Monday/Sunday, grouping, cell editor/new entry | L | [x] |
| M4-2 | Reports totals/billable/per-day/project/client/table with DST-safe splits | L | [x] |
| M4-3 | Bar chart + shared report filters | M | [x] |
| M4-4 | RFC 4180 CSV via native Save dialog, totals matching report | M | [x] |
| M4-5 | Versioned JSON backup, preview, transactional restore, safety backup | L | [x] |
| M4-6 | 10k-entry performance/accuracy test | M | [x] |

**Exit evidence:** AC-07, AC-10, AC-15, AC-18 pass. 10k report 108.6 ms debug, exact totals.
CSV row count/total equal filtered report. Restore safety backup verified.

### M5 — Polish, test & package — **COMPLETE (Windows)**
| # | Task | Complexity | Status |
|---|---|---|---|
| M5-1 | First-run onboarding (3 steps), skippable permissions | M | [x] |
| M5-2 | Accessibility: labels, focus trap/rings, keyboard, reduced motion, contrast | M | [x] |
| M5-3 | Error surfaces, degraded states, recovery UX, empty states | M | [x] |
| M5-4 | README, TEST_REPORT, PLATFORM_SUPPORT, architecture, demo procedure | S | [x] |
| M5-5 | `tauri build` installer on host, launch smoke, app-data DB | L | [x] |
| M5-6 | Full verification run (`npm run check`, tests, build) | M | [x] |

**Exit evidence:** NSIS installer `TempoDesk_0.1.0_x64-setup.exe` built, silent-installed per-user,
installed app launched with DB under `%APPDATA%\com.tempodesk.desktop`. See test report.

## FR → task checklist (P0)

Legend: `[x]` implemented + verified on Windows (or noted partial).

| FR | Requirement | Status / evidence |
|---|---|---|
| FR-001 | Start timer | [x] Rust + UI smoke, project/tags/billable, instant persistence |
| FR-002 | Stop timer; continues while hidden | [x] hidden-window test: elapsed increased, process alive; stop aligns seconds |
| FR-003 | Single active timer / atomic switch | [x] DB unique index + Rust switch test + UI switch path |
| FR-004 | Resume past work as new session | [x] Rust resume test + UI resume flow; original unchanged |
| FR-005 | Manual entry + validation + overlap warning | [x] Rust/frontend validation; overnight UI; overlap toast |
| FR-006 | Edit/delete with soft delete + undo | [x] UI edit/delete/undo; seconds preserved; running end edit rejected |
| FR-007 | Search/filters | [x] API + UI filters; LIKE escaped; Rust filter matrix |
| FR-008 | UTC storage + local midnight/DST splits | [x] 23h/25h DST tests; overnight split; reports use same math |
| FR-009 | Sleep/clock/crash recovery + review | [x] heartbeat gap review; kill/relaunch recovery; clean quit policy |
| FR-010 | HH:MM:SS / HH:MM, integer seconds | [x] all aggregation in integer seconds; sub-minute seconds display |
| FR-011 | Projects CRUD/archive/color/billable/client | [x] UI + Rust tests; archived hidden from selectors |
| FR-012 | Clients CRUD/archive/unique names | [x] UI + Rust unique/archive tests |
| FR-013 | Tags CRUD/many-to-many/rename/soft delete | [x] UI + Rust; rename/delete preserved in history/reports |
| FR-014 | Weekly timesheet from same entries | [x] UI week nav/cells/editor; Mon/Sun setting verified |
| FR-015 | Reports shared filters/totals/chart/table | [x] shared report object; UI project filter; Rust CSV consistency |
| FR-016 | RFC 4180 CSV via native Save | [x] backend verified; native Save dialog wired (manual click-through documented) |
| FR-017 | Tray/menu bar live controls & recents | [x] creation verified (`trayAvailable`), menu built; clicks manual |
| FR-018 | Close-to-tray + quit policy | [x] hide/restore, stop-and-quit, keep-running recovery all verified |
| FR-019 | Configurable global shortcuts + collisions | [~] registration/validation/disable verified; physical keypress + OS-collision manual |
| FR-020 | Opt-in idle detection + explicit review | [x] real Windows idle test; one review; split; no auto-delete |
| FR-021 | Notifications + fallback | [~] notification send wired; in-app fallback verified; OS permission grant/deny manual |
| FR-022 | Theme/timezone/12-24h/start-of-week/autostart | [x] theme override, week start, autostart registry verified; OS theme live switch manual |
| FR-023 | First-run onboarding ≤3 steps | [x] 3-step flow verified (project step implemented, skipped in test run) |
| FR-024 | Backup/restore validation + safety copy | [x] Rust + UI IPC delete/restore; invalid backup changes nothing |
| FR-025 | Single instance + versioned migrations | [x] second launch focuses first; migrations + user_version tested |
| FR-026 | Local-only, least privilege, typed/validated IPC | [x] no network code, CSP, no fs/shell plugin, command validation |
| FR-027 | Integrity: WAL, FK, transactions, indexes, integer time | [x] pragmas, constraints, integrity check on startup, casts avoided |

## Acceptance criteria verification matrix

| AC | Status | Evidence |
|---|---|---|
| AC-01 | **Pass** | Fresh UI run + Rust persistence |
| AC-02 | **Pass** | Hidden window 17 s elapsed, second-launch restore, same timer |
| AC-03 | **Partial (manual)** | Registration/validation OK; synthetic hotkeys blocked by automation session |
| AC-04 | **Pass** | Rust atomic switch test + UI |
| AC-05 | **Pass** | Rust resume test + UI |
| AC-06 | **Pass** | Rust 1800+1800 split; UI overnight entry |
| AC-07 | **Pass** | Rust America/New_York 23h/25h + report DST |
| AC-08 | **Pass** | Kill/relaunch recovery review |
| AC-09 | **Pass** | UI tag/client/project flows + report/CSV totals |
| AC-10 | **Pass** | Rust filter/CSV consistency + UI project filter |
| AC-11 | **Pass** | No network code; all flows work offline |
| AC-12 | **Partial (manual)** | Light/dark/system overrides verified; live OS theme switch manual |
| AC-13 | **Pass** | Real OS idle API, one review/episode, explicit actions, split persisted |
| AC-14 | **Manual** | In-app fallback verified; denied notification permission not exercised |
| AC-15 | **Pass** | Backup/restore + safety copy + invalid backup rejected |
| AC-16 | **Pass** | Validation + parameterized SQL + LIKE escaping tests |
| AC-17 | **Pass** | Single process / focus existing window |
| AC-18 | **Pass** | 10k report 108.6 ms debug, exact totals |
| AC-19 | **Partial (manual)** | Labels/focus trap/keyboard/responsive verified structurally; full SR walkthrough manual |
| AC-20 | **Pass** | Installer built + installed + launched + app-data DB |

## Deviations from PRD

1. **GNU toolchain on Windows** instead of MSVC due to host constraints (documented above).
2. **Tauri-free `core/` crate** was extracted so domain/persistence tests can run on this GNU host
   (the Tauri-linked test harness could not load WebView2 in the session). This is an architectural
   improvement, not a feature deviation.
3. **`idle_review_events.kind`** (`idle`/`sleep`) added to reuse idle review UX for sleep/clock gaps.
4. **Idle “exclude”** is implemented by splitting into two persisted entries (auditable) rather than
   a separate excluded-interval table; aggregation remains consistent and documented.
5. **Sub-minute durations** are shown as `Ns` (and times with seconds) instead of misleading `00:00`.
6. **CSV duration** is in-range seconds so report totals and export totals match for range filters.
7. **Backup version 1** carries tags including soft-deleted metadata to preserve historical names.

## Remaining blockers / manual checks

- macOS build/run/feature verification (no macOS host).
- Physical global hotkey press verification (synthetic input blocked in this session).
- Tray menu click-through, native notification permission allow/deny, native Save/Open dialog
  click-through, and full screen-reader walkthrough.
- Signed/notarized installers and updater are P1.
- MSVC build for public Windows distribution preferred over the GNU artifact.

## Verification commands and results

```bash
npm run check                    # typecheck + lint + 22 Vitest + 39 Rust tests + clippy + cargo check — PASS
npx tauri build --debug --no-bundle   # PASS
npx tauri build --bundles nsis        # PASS (5.84 MiB installer)
npm run smoke                          # PASS (debug)
npm run smoke -- --release             # PASS (release)
```

UI automation and screenshots: see [docs/TEST_REPORT.md](docs/TEST_REPORT.md) and
[scripts/README.md](scripts/README.md).

## Reporting protocol

After each milestone: files changed, commands run, results, acceptance IDs passed, and remaining
blockers. macOS-specific claims are never made from the Windows host.
