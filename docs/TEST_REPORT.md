# TempoDesk Test Report

## GitHub release 0.3.0 — 2026-11-03

[Release workflow](https://github.com/wgalasmoonbridge/tempodesk/actions/runs/41663271527)
built and published Windows x64 NSIS/MSI installers and macOS Intel DMG/application archives to
the [v0.3.0 release](https://github.com/wgalasmoonbridge/tempodesk/releases/tag/v0.3.0). Frontend
typecheck, lint, and all 26 tests passed on both runners. Asset names, sizes, and SHA-256 digests
were verified through GitHub's release API; checksums are recorded in CHANGELOG.md.
macOS runtime remains unverified. Local databases and upgrade backups were excluded from the push.

## Installed upgrade to 0.3.0 — 2026-11-03

The installed Windows app was upgraded from 0.2.0 using the NSIS installer's `/S /UPDATE` mode
(exit code 0) and reopened from `%LOCALAPPDATA%\TempoDesk\tempodesk.exe`. Its version resource
reports 0.3.0. The installed executable matches the release byte-for-byte after accounting for
Tauri's documented-in-source three-byte NSIS bundle marker (`UNK` → `NSS`). Installed SHA-256:
`b3a352994c3729548045453891439d692dc7a4e76aa88fe10a7f7da3f5ecc4bc`.

Before installation, consistent read-only SQLite snapshots included committed WAL data. The schema
upgrade was rehearsed against a snapshot, and an app-readable JSON backup and previous executable
were saved. Every original row was fingerprinted and compared both before launch and after the
installed app migrated the production database from schema 1 to schema 2.

All existing time-entry rows (including soft-deleted entries and a running timer), clients,
projects, tags, tag associations, and stored settings were preserved exactly. The active timer's
ID, original start time, and metadata were unchanged. The app's recovery flow can continue it.

Recovery artifacts are retained locally in the git-ignored `.upgrade-backups/` directory, including
the final snapshot, JSON backup, and installation-verification record.
No existing time records were created, edited, or deleted for upgrade verification.

## Workflow enhancements — 2026-11-03

The new workflow changes were verified on Windows using the isolated debug build and a fresh
`.test-data/run-*` profile. The installed production app remained running in a separate profile.

| Check | Result |
|---|---|
| Core Rust tests | 57 passed: 42 unit, 15 integration |
| Frontend tests | 26 passed across 3 files |
| Typecheck / ESLint | Pass, no warnings |
| Core + shell formatting / Clippy | Pass with warnings denied |
| Native `cargo check` | Pass |
| Frontend production build | Pass |
| Native debug app build | Pass (`npm run build:test`) |
| `node scripts/ui-workflows.mjs` | Pass against actual Tauri/WebView2 |

New regression coverage includes preserving entries through a v1→v2 schema upgrade, v1 backup
compatibility, template backup round trips, single-running-timer protection, transactional bulk edits,
metadata undo conflicts and preservation of later time edits, 1,205-entry complete totals with range
clipping, stable page ordering, daily backup scheduling, retention that preserves other files,
backwards clock changes, and visible/recoverable backup errors.

The real UI flow created and edited a project/tag/billable template, started it, confirmed switching
from a running task, applied and undid metadata changes to two sessions, enabled automatic backups,
checked file contents and retention, restored a template from an automatic backup, and paged a
1,005-entry history with complete totals. Template deletion was also verified.

Screenshots: `docs/screenshots/templates-history.png`, `bulk-edit.png`, `automatic-backups.png`.
The native tray template submenu and native folder chooser are implemented and build-verified;
physical OS click-through is still manual. The 24-hour scheduler was verified with deterministic
core tests; an elapsed 24-hour desktop soak was not run. macOS runtime remains untested. The installed
Windows release upgrade was subsequently verified as recorded above.

The frontend build/test tool required an approved run outside the filesystem sandbox to resolve
its configuration; PowerShell execution policy required invoking `npm.cmd` on this host.

---

**Date:** 2026-11-02

**Host:** Windows 11 x64 (10.0.26200.9711)

**Build under test:** TempoDesk 0.2.0 debug `src-tauri/target/debug/tempodesk.exe`, release binary,
NSIS `TempoDesk_0.2.0_x64-setup.exe` (7.07 MiB), and MSI (10.55 MiB)

**Toolchain:** Node 24.22.0, npm 11.19.1, Rust 1.99.1 `x86_64-pc-windows-gnu`, MinGW-w64 GCC
16.2.0 (UCRT), Tauri 2.12.5, React 19.3.1, Vite 7.3.7, TypeScript 5.9.3, Vitest 3.2.7,
rusqlite 0.40.2 (bundled SQLite).

> macOS was not tested. No claim of macOS verification is made. See
> [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md).

## 1. Summary

| Area | Result |
|---|---|
| Rust unit tests (`tempodesk-core`) | **41 passed** |
| Rust integration tests (filters, CSV, 10k, timer, tag history, bulk, duplicate) | **9 passed** |
| Frontend Vitest suites | **24 passed** (2 files) |
| `tsc --noEmit` | Pass |
| ESLint | Pass (0 warnings) |
| `cargo fmt --check` (core + shell) | Pass |
| `cargo clippy --all-targets -- -D warnings` (core + shell) | Pass |
| `cargo check` (Tauri shell) | Pass |
| Debug app launch | Pass |
| Release build | Pass |
| 0.2.0 Windows NSIS + MSI CI build/publish | Pass |
| 0.2.0 Intel macOS app + DMG CI build/publish | Pass; runtime unverified |
| Installer silent per-user install | Prior 0.1.0 package: Exit 0 |
| Installed app launch + DB in app-data | Prior 0.1.0 package: Pass |
| 10,000-entry report | **108.6 ms** (debug), totals exact |
| UI flows through WebView2 CDP | Pass (details below) |
| Production/dev/test data isolation | **Pass** — dev profile at `%APPDATA%\com.tempodesk.desktop.dev`; UI tests at `.test-data/run-*` (`dataProfile: test`); installed app stayed running untouched |
| Guard against production UI tests | **Pass** — debug/test builds allowed; release smoke refused without explicit opt-in |

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
npm run smoke               # debug: isolated .test-data profile
npm run smoke -- --release  # blocked unless ALLOW_PRODUCTION_TESTS=1
```

`npm run check` runs the combined static/test suite and passed at the end of implementation.

## 2. Rust test coverage

### Unit tests (41)

- **summary**: local summary totals/projects/tasks/tags/observations; empty ranges; prompt includes aggregates and respects the description-exclusion setting; Gemini success/error/blocked response parsing.
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

### Integration tests (9, `core/tests/filters_and_perf.rs`)

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
7. `editing_an_entry_keeps_soft_deleted_tag_association` — historical tag names survive tag deletion
   and remain editable; unknown tag IDs are rejected.
8. `bulk_delete_and_restore_are_transactional_and_report_skips` — three entries deleted in one
   transaction, running/unknown IDs skipped with reasons, batch restore recovers all three,
   re-restore reports `not_deleted`, empty batch rejected.
9. `duplicate_entry_copies_metadata_and_interval` — duplicates a completed entry as a new saved
   session while preserving classification and leaving the source unchanged.

## 3. Frontend tests (24)

- IANA-zone day boundaries: 23h/25h DST days, midnight timestamps, formatted times.
- Local date/time conversion including seconds and DST offsets.
- Midnight splitting, DST session allocation, overnight allocations.
- Week starts, report presets, duration formatting (including negative and sub-minute), invalid
  timezone fallback.
- Calendar 15-minute selection snapping, pointer-position conversion, midnight time values, and
  cross-midnight block clipping.
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
| `ui-bulk-delete` | Select two entries, bulk-delete (only those two soft-deleted with one transaction timestamp), third entry untouched, batch Undo restores both; Select-all excludes the running entry; self-contained fixtures | Pass |
| `ui-ai-summary` | AI settings consent/enable, fake Gemini key saved to and removed from the test-profile OS credential store (never returned by IPC/settings), local weekly summary in Reports, weekly summary from Timesheet, daily summary from Tracker | Pass |
| `ui-calendar.mjs` | Seven-column week view, real pointer drag 14:00→15:30, saved block, click-to-edit, day/week switching, screenshot | Pass |
| Profile isolation | Installed production app (pid 2284) stayed running while a Dev build reported `dataProfile: development` at `%APPDATA%\com.tempodesk.desktop.dev`, and the test launcher reported `dataProfile: test` at `.test-data/run-*`; bulk actions ran only on the test DB. `npm run smoke` uses a test directory; release smoke refused without `ALLOW_PRODUCTION_TESTS=1`. | Pass |

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
- `scroll-fixed.png` — vertical scrolling in the reports view after the fix
- `bulk-select.png`, `bulk-confirm.png` — bulk selection toolbar and batch delete confirmation
- `ai-settings.png`, `ai-key-configured.png`, `ai-summary-local.png` — AI configuration, configured key, and offline high-level summary
- `calendar.png` — week timeline with a drag-created and edited entry
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
| AC-11 | **Pass** | All P0 flows work offline with no network; the new AI summary is optional, explicit, and has a local fallback. Tests ran without contacting Gemini. |
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
7. **Main content could not scroll vertically** (reported after initial build). The `.app` CSS grid’s
   implicit row auto-sized to its content, so `.main`/`.content` grew to 1056px inside a 740px window
   while `.app` hid overflow. Fixed with `grid-template-rows: minmax(0, 1fr)` and `min-height: 0` on
   the flex/grid children. Verified on the real window: `.content` 684px client height / 1146px
   scroll height, programmatic scroll to 300px works (max 462px); screenshot `scroll-fixed.png`.

## 7. Not tested (explicit)

- **Live Gemini API call**: not verified without a real API key; request/response parsing, keyring storage, consent gating, and local fallback were tested. The key was never stored in production profile during tests.
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

- 0.2.0 debug build: `src-tauri/target/debug/tempodesk.exe` — calendar UI verification passed.
- 0.2.0 release build: `src-tauri/target/release/tempodesk.exe` — compiled successfully.
- 0.2.0 NSIS: `src-tauri/target/release/bundle/nsis/TempoDesk_0.2.0_x64-setup.exe` (7.07 MiB).
- 0.2.0 MSI: `src-tauri/target/release/bundle/msi/TempoDesk_0.2.0_x64_en-US.msi` (10.55 MiB).
- GitHub Actions additionally built/published MSVC Windows bundles and unsigned Intel macOS
  `TempoDesk_0.2.0_x64.dmg` / `TempoDesk_x64.app.tar.gz` artifacts.
- The 0.2.0 bundles were not installed over the user’s running production copy. The earlier 0.1.0
  silent install and installed-app launch remain valid packaging evidence; install/upgrade of 0.2.0
  is still a manual release check.
- Linker warning on GNU: `.rsrc merge failure: multiple non-default manifests`; app/installer still
  work. MSVC is recommended for production/signing.
