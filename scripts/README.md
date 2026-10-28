# Verification scripts

These scripts drive the **real Tauri/WebView2 app** over the Chrome DevTools Protocol. They are
verification artifacts, not product runtime dependencies.

## Safety rules

**Production app data is protected.** The installed app uses
`%APPDATA%\com.tempodesk.desktop`. Development and tests never open it:

- Debug builds use a separate `com.tempodesk.desktop.dev` directory and Dev identifier.
- UI tests run against an isolated `.test-data/run-*` directory via `TEMPO_DATA_DIR`.
- `scripts/cdp-lib.mjs` refuses to connect to a `production` profile unless
  `ALLOW_PRODUCTION_TESTS=1` is explicitly set; it also fails closed if the profile is unknown.
- Do **not** delete `%APPDATA%\com.tempodesk.desktop` (the installed app's data) for tests.
- The installed app may stay open while tests run. They have separate single-instance locks,
  WebView2 profiles, databases, and backups.

## Prerequisites

- Build the debug app with the Dev identifier:

```bash
npm run build:test
```

- Start an isolated test profile:

```bash
node scripts/launch-test-app.mjs
```

The launcher creates `.test-data/run-<timestamp>`, sets `TEMPO_DATA_DIR`, starts the debug app with
`--remote-debugging-port=9222`, verifies `dataProfile === "test"`, and writes
`.test-data/current.json`.

Stop only that test app at any time with:

```bash
node scripts/stop-test-app.mjs
```

## Recommended order

The launcher starts a fresh profile, so onboarding is shown.

```bash
node scripts/ui-smoke.mjs       # onboarding, first project, timer, manual entry
node scripts/ui-features.mjs    # timesheet, reports, CSV, backup/restore
node scripts/ui-entries.mjs     # edit, delete/undo, overnight, theme
node scripts/ui-org.mjs         # clients, tags, project classification/archives
node scripts/ui-idle.mjs        # real idle API + review split
node scripts/ui-settings2.mjs   # cell editor, report filter, week start, autostart
node scripts/ui-resize.mjs      # 860x700 responsive layout
node scripts/ui-closepref.mjs   # close-to-tray off → quit dialog
node scripts/check-scroll.mjs   # content pane has a working vertical scroll range
node scripts/ui-bulk-delete.mjs # self-contained bulk select/delete/undo + running guard
node scripts/ui-ai-summary.mjs  # AI settings, fake test-profile key round trip, local summaries
node scripts/ui-capture.mjs     # screenshots
```

Some scripts quit the test app at the end (for example `ui-bulk-delete`). Use the launcher again
for a fresh run.

## Recovery / quit policies

These require killing and relaunching the test process while keeping its data:

```bash
node scripts/start-crash-timer.mjs
# close/kill the test app process (never the installed app)
node scripts/launch-test-app.mjs --reuse
node scripts/check-recovery.mjs

node scripts/ui-quit.mjs
node scripts/launch-test-app.mjs --reuse
node scripts/check-quit-stop.mjs

node scripts/ui-quit-keep.mjs
node scripts/launch-test-app.mjs --reuse
node scripts/check-quit-keep.mjs
```

`check-hidden-timer.mjs` verifies close-to-tray with an active timer and single-instance restore.

`npm run smoke` launches a debug build against a fresh `.test-data/smoke-*` directory and verifies
the SQLite header/path. Release smoke (`npm run smoke -- --release`) is intentionally blocked unless
`ALLOW_PRODUCTION_TESTS=1` is set, because launching production writes heartbeat/clean-exit state.

## Production-only packaging checks

Only these intentionally touch the installed profile, and they are never part of the dev loop:

```bash
ALLOW_PRODUCTION_TESTS=1 node scripts/check-installed.mjs   # launches installed app, then quits
ALLOW_PRODUCTION_TESTS=1 node scripts/check-scroll.mjs      # optional installed-app scroll check
```

Do not run them while actively using TempoDesk.

## Host-specific assumptions

- Time zone: `America/Chicago` is used in a few scripts to read the current date.
- Overnight test date: `2026-10-27` (host clock is 2026-10-28).
- `ui-settings2.mjs` checks the Windows `HKCU\...\Run` autostart key; on macOS this section must be
  adapted to a LaunchAgent check.
- `ui-shortcuts.mjs` documents shortcut registration/invalid-binding checks, but **synthetic global
  hotkey presses were blocked in the automation session**; verify physical presses manually.
- `ui-ai-summary.mjs` uses a clearly fake key and removes it afterwards. Keyring accounts are
  per-profile, so it cannot touch a production Gemini key.
- Tray menu clicks, native notification permission, and native Save/Open dialog clicks cannot be
  automated this way; use the manual checklist in `docs/PLATFORM_SUPPORT.md`.
- Scripts are stateful and ordered. Use a fresh launcher run for a clean profile.

## Notes

- Screenshots are written to `docs/screenshots/`.
- `cdp-lib.mjs` contains the small CDP client (evaluate, click by text/aria, type, select, wait,
  screenshot) and the production-profile guard.
