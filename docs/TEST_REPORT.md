# TempoDesk Test Report

**Date:** 2026-10-28  
**Host:** Windows 11 x64 (10.0.26200.9711)  
**Build under test:** debug `src-tauri/target/debug/tempodesk.exe`, release + NSIS installer
`TempoDesk_0.1.0_x64-setup.exe` (5.84 MiB)  
**Toolchain:** Node 24.22.0, npm 11.19.1, Rust 1.99.1 `x86_64-pc-windows-gnu`, MinGW-w64 GCC
16.2.0 (UCRT), Tauri 2.12.5, React 19.3.1, Vite 7.3.7, TypeScript 5.9.3, Vitest 3.2.7,
rusqlite 0.40.2 (bundled SQLite).

> macOS was not tested. No claim of macOS verification is made. See
> [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md).

## 1. Summary

| Area | Result |
|---|---|
| Rust unit tests (`tempodesk-core`) | **33 passed** |
| Rust integration tests (filters, CSV, 10k, timer flow) | **6 passed** |
| Frontend Vitest suites | **22 passed** (2 files) |
| `tsc --noEmit` | Pass |
| ESLint | Pass (0 warnings) |
| `cargo fmt --check` (core + shell) | Pass |
| `cargo clippy --all-targets -- -D warnings` (core + shell) | Pass |
| `cargo check` (Tauri shell) | Pass |
| Debug app launch | Pass |
| Release build | Pass |
| NSIS installer build | Pass |
| Installer silent per-user install | Exit 0 |
| Installed app launch + DB in app-data | Pass |
| 10,000-entry report | **108.6 ms** (debug), totals exact |
| UI flows through WebView2 CDP | Pass (details below) |

Commands used (run with the MinGW/Rust `bin` directories on `PATH`; close the running app before
`cargo check` on Windows because the executable file is locked):

```bash
npm run typecheck
npm run lint
npm run test
cargo test --manifest-path core/Cargo.toml
cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path core/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
npx tauri build --debug --no-bundle
npx tauri build --bundles nsis
npm run smoke
npm run smoke -- --release
```

`npm run check` runs the combined static/test suite and passed at the end of implementation.

## 2. Rust test coverage

### Unit tests (33)

- **timeutil**: local midnight, 23-hour spring-forward day, 25-hour fall-back day, DST elapsed
  seconds, cross-midnight split, report-range clipping, week start (Mon/Sun).
- **timer/idle**: unaligned stop timestamps, idle review once per episode, keep, exclude split into
  two audited entries, stop-at-idle, stale reviews, recovery detection (unclean/clean), stop at last
  heartbeat, millisecond alignment of resumed segments.
- **reports**: midnight and DST report totals, billable split, CSV quoting/escaping and row counts,
  timesheet grouping by project+description.
- **validate**: names, colors, manual range, future start, ≤24h, second precision.
- **storage/db**: migrations, `user_version`, foreign keys, one-active-entry unique index.
- **repositories**: client/project/tag create/update/archive, unique active names, archived
  assignment rejection, tag rename and soft-delete preserving historical resolution.
- **portability**: backup/restore round trip, invalid backup leaves data untouched, running timer
  survives backup/restore, CSV export, path extension validation.
- **settings**: defaults, persistence, validation, runtime state.

### Integration tests (6, `core/tests/filters_and_perf.rs`)

1. `entry_filters_share_one_computation` — project/client/tag/billable/search/date/sort/soft-delete
   filters, LIKE escaping (`%`), includeDeleted.
2. `report_and_csv_filters_match` — project, client, tag, billable filters produce identical report
   totals, row counts and CSV totals.
3. `ten_thousand_entries_report_stays_accurate_and_responsive` — 10k entries across 100 days:
   total 36,000,000 s; daily sum equals total; report 108.6 ms debug; 100-row page < 2 s.
4. `backup_preview_and_csv_destination_validation` — versioned backup, preview counts, reject
   missing source.
5. `day_helpers_match_reports_across_dst` — public day helpers agree with DST math.
6. `timer_flow_enforces_one_active_entry_and_resume_copy_semantics` — duplicate start rejected,
   atomic switch, double stop cannot create a second entry, resume copies metadata without changing
   the original, running-entry end-time edit rejected.

## 3. Frontend tests (21)

- IANA-zone day boundaries: 23h/25h DST days, midnight timestamps, formatted times.
- Local date/time conversion including seconds and DST offsets.
- Midnight splitting, DST session allocation, overnight allocations.
- Week starts, report presets, duration formatting (including negative and sub-minute), invalid
  timezone fallback.
- Manual form validation: same-day, overnight flag prompt, >24h, future start, second precision.
- Names/colors/settings validation.

## 4. UI verification (real WebView2 app)

Automated via Chrome DevTools Protocol against the real Tauri window (scripts in `scripts/`), not a
browser mock. Each run used a fresh SQLite profile for the main suite, then kill/relaunch phases for
recovery/quit.

| Script | Verified behavior | Result |
|---|---|---|
| `ui-smoke.mjs` | 3-step onboarding, project creation, start timer with project, stop, entry visible, manual entry, report load, screenshot | Pass |
| `ui-features.mjs` | Timesheet render, report totals = daily allocation (3603 s), backup + preview counts, CSV export rows/total/header, destructive delete → restore via same IPC, settings render | Pass |
| `ui-entries.mjs` | Edit entry, delete + undo, overnight validation prompt + next-day save (1h), theme dark/light/system override | Pass |
| `ui-org.mjs` | Client create, link project↔client, tag create, attach tag, rename reflected in history, archive tag hidden from selectors but kept in history, deleted tag preserved in history/reports, archive project hidden from new-entry selector but kept in history, unarchive | Pass |
| `ui-idle.mjs` | Enable real Windows idle detection, running timer, one review banner, Remove idle gap → split entries (idle_adjustment + new running), disable idle, cleanup | Pass |
| `ui-settings2.mjs` | Platform capabilities (tray + idle available), timesheet cell dialog lists sessions and Add entry, project-filtered report excludes other entries and totals 3 s, start-of-week Sunday applied to timesheet, launch-at-login registry sync | Pass (registry assertions re-run separately after a quoting fix) |
| `ui-closepref.mjs` | Close-to-tray OFF → window close shows quit confirmation, cancel keeps app, preference restored | Pass |
| `ui-resize.mjs` | Resize to 860×700 → collapsed icon rail, no page horizontal overflow, restore 1180×760 | Pass |
| `ui-capture.mjs` | Screenshots of tracker/timesheet/reports/projects/clients/tags/settings; no visible error alerts | Pass |
| `start-crash-timer` + `check-recovery` | Start timer, SIGKILL process (Task Manager style), relaunch → recovery dialog, Stop at last seen saves entry | Pass |
| `ui-quit` + `check-quit-stop` | Quit with **Stop timer** → entry saved; relaunch has no recovery prompt and no active timer | Pass |
| `ui-quit-keep` + `check-quit-keep` | Quit with **Keep running** → relaunch recovery prompt reason `running_at_launch`; Continue resumes the same session, then stop | Pass |
| `check-hidden-timer` (manual follow-up) | Start timer → WM_CLOSE hides window (visible=false) → wait → second launch restores first instance → same active entry, elapsed grew from ~0 to 17 s; single process | Pass |
| `check-installed` | Installed package launches, platform info reports `%APPDATA%\com.tempodesk.desktop\tempodesk.db`, UI rendered | Pass |

### Screenshots (evidence)

`docs/screenshots/` contains:

- `tracker-populated.png`
- `tracker-final.png` — overnight split, tags, client, sub-minute seconds
- `timesheet.png` — week grid, session counts, second-precision cells
- `reports.png` — summary, DST-safe daily chart, project/client breakdown
- `report-filtered.png`
- `projects.png`, `clients.png`, `tags.png`
- `settings-general.png`, `dark-settings.png`
- `idle-review.png`
- `recovery-modal.png`, `quit-dialog.png`
- `responsive-860.png`
- `installed-app.png`

## 5. Acceptance criteria matrix

Legend: **Pass** = automated evidence on this host; **Manual** = implemented but requires physical
OS interaction; **Unverified** = cannot be tested on this host.

| ID | Status | Evidence / notes |
|---|---|---|
| AC-01 | **Pass** | Fresh UI run: create project → start → stop → entry visible; Rust persistence tests. |
| AC-02 | **Pass** | Hidden-window test above: timer stayed active, elapsed increased, second launch restored window, one process. |
| AC-03 | **Partial / Manual** | Registration status OK; invalid binding and duplicate rejection; toggle logic in Rust/Rust tests; synthetic WM_HOTKEY input was blocked by the automation session (a probe could not trigger any RegisterHotKey). Physical key press must be spot-checked. |
| AC-04 | **Pass** | Rust timer-flow test (atomic switch, one active) + switch UI/delete flows. |
| AC-05 | **Pass** | Rust resume test: original unchanged, new metadata copy; UI resume path exercised. |
| AC-06 | **Pass** | Rust 23:30→00:30 split 1800+1800; UI overnight entry saved as 1h and displayed with “from previous day”. |
| AC-07 | **Pass** | Rust America/New_York 23h/25h DST day tests, report allocation; public day-helper test. |
| AC-08 | **Pass** | Process kill + relaunch → recovery modal → stop at last seen; no silent loss. |
| AC-09 | **Pass** | UI tag attach/rename/archive/delete, project/client classification; Rust report/CSV consistency. |
| AC-10 | **Pass** | Rust filter matrix + project filter UI + CSV total equality; report and CSV row counts agree. |
| AC-11 | **Pass** | No network code or telemetry; all flows above ran offline (no network configured). |
| AC-12 | **Partial / Manual** | Light/dark/system overrides verified; OS `prefers-color-scheme` change not toggled at OS level. Code listens for the change. |
| AC-13 | **Pass** | Real Windows idle API enabled: one banner per episode, Keep/Remove/End actions; split persisted; disabled by default; no auto-delete. |
| AC-14 | **Manual / Unverified** | In-app fallback banner always shown; permission request implemented. OS notification denial flow was not exercised. |
| AC-15 | **Pass** | Rust invalid/valid restore tests, safety backup, running timer restore; UI IPC backup→delete→restore with totals recovery. |
| AC-16 | **Pass** | Validation unit tests, parameterized SQL, LIKE escaping test, Unicode/description limits enforced. |
| AC-17 | **Pass** | Second launch focused existing window; only one `tempodesk.exe` process. |
| AC-18 | **Pass** | 10k report 108.6 ms debug, exact total; paginated list limit. |
| AC-19 | **Partial / Manual** | Labels/aria roles, focus-trapped dialog, visible focus, reduced motion, responsive layout; full screen-reader/keyboard walkthrough not automated. |
| AC-20 | **Pass** | NSIS installer built, silent install exit 0, installed app launched, DB created at `%APPDATA%\com.tempodesk.desktop\tempodesk.db`. |

## 6. Defects found during verification (and fixed)

1. **Stop failed with CHECK constraint** when wall-clock milliseconds were not aligned to the second
   (`end_at_utc % 1000 != 0`). Fixed by aligning stop/recovery/idle timestamps; added regression
   tests, including an idle split with unaligned resume time.
2. **Editing a sub-minute entry lost seconds**, making start/end equal and blocking the save.
   Fixed by carrying `HH:MM:SS` in edit time inputs (`step=1`), parsing seconds in the validator and
   UTC conversion, and adding second-precision tests. Verified tag attach now preserves the 3-second
   entry.
3. **Report bar chart drew a 2 px bar for zero days** and sub-minute project totals showed `00:00`.
   Fixed zero-bar rendering and added seconds display for sub-minute values (timesheet, history,
   reports, breakdowns).
4. **Duplicate idle banner** on the tracker page removed; tracker shows the actionable inline review
   only, other pages get the global pointer.
5. **Header duplication / narrow-window nav accessibility** adjusted; collapsed icon rail keeps
   `aria-label`s.
6. **Timesheet row duplicated the project name** and showed `1 sessions`; corrected to “1 session”
   and sub-minute cells show seconds.

## 7. Not tested (explicit)

- **macOS** anything: build, tray/menu bar, CoreGraphics idle, notifications permission, global
  hotkeys, LaunchAgent autostart, DMG/installer, WKWebView rendering.
- **Physical global hotkey press** on Windows (synthetic input blocked by the automation session).
- **Tray menu clicks**: tray icon creation is verified (`trayAvailable: true`); menu actions are
  implemented and share tested service paths, but clicking native tray items was not automated.
- **Native notification permission grant/deny** and toast appearance.
- **Native Save/Open dialogs** UI: the dialogs are invoked by the frontend; backend export/backup
  commands were verified directly. A manual click-through is listed in the demo procedure.
- **Screen-reader pass** with NVDA/Narrator and full Tab traversal.
- **OS theme switch** while running (manual override verified).
- **Code signing / notarization** (deferred).
- **Linux** (not an MVP target).

## 8. Reproduce

1. Close TempoDesk.
2. Start the app with remote debugging:

```bash
cd src-tauri/target/debug
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" ./tempodesk.exe
```

3. For a fresh profile, quit the app and remove `%APPDATA%\com.tempodesk.desktop` first.
4. Run the suite in order:

```bash
node scripts/ui-smoke.mjs
node scripts/ui-features.mjs
node scripts/ui-entries.mjs
node scripts/ui-org.mjs
node scripts/ui-idle.mjs
```

Some scripts change settings/cleanup; they are written for the seeded fresh profile described in
`scripts/README.md`. Recovery/quit/close-to-tray scripts require kill/relaunch phases and are
documented there.

## 9. Build/package evidence

- Debug build: `src-tauri/target/debug/tempodesk.exe` — launch smoke passed.
- Release build: `src-tauri/target/release/tempodesk.exe` — launch smoke passed.
- Installer: `src-tauri/target/release/bundle/nsis/TempoDesk_0.1.0_x64-setup.exe` (5.84 MiB), rebuilt after the final autostart/window changes.
- Silent install (`/S`) exit 0; installed to `%LOCALAPPDATA%\TempoDesk`; installed app launched and
  reported the roaming app-data DB path.
- Linker warning on GNU: `.rsrc merge failure: multiple non-default manifests`; app/installer still
  work. MSVC is recommended for production/signing.
