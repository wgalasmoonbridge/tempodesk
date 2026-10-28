# Verification scripts

These scripts drive the **real Tauri/WebView2 app** over the Chrome DevTools Protocol. They are
verification artifacts, not product runtime dependencies.

## Prerequisites

- A built debug app: `npx tauri build --debug --no-bundle`
- TempoDesk closed (the debug executable is locked while running on Windows)
- The app launched with a debugging port:

```bash
cd src-tauri/target/debug
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" ./tempodesk.exe
```

Wait for the window before running scripts. On Windows PowerShell you can set the variable first:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
.\tempodesk.exe
```

## Fresh profile

The main suite assumes first-run onboarding. Quit the app and delete:

```text
%APPDATA%\com.tempodesk.desktop
```

This deletes all local TempoDesk data **for the current Windows user** — only do this in a test
profile/VM, never with real data.

## Recommended order

```bash
node scripts/ui-smoke.mjs       # onboarding, first project, timer, manual entry
node scripts/ui-features.mjs    # timesheet, reports, CSV, backup/restore
node scripts/ui-entries.mjs     # edit, delete/undo, overnight, theme
node scripts/ui-org.mjs         # clients, tags, project classification/archives
node scripts/ui-idle.mjs        # real idle API + review split
node scripts/ui-settings2.mjs   # cell editor, report filter, week start, autostart
node scripts/ui-resize.mjs      # 860x700 responsive layout
node scripts/ui-closepref.mjs   # close-to-tray off → quit dialog
node scripts/check-scroll.mjs   # installed/debug app: content pane has a working scroll range
node scripts/ui-bulk-delete.mjs # self-contained bulk select/delete/undo + running guard
node scripts/ui-capture.mjs     # screenshots
```

Recovery and quit policies require killing/relaunching the process:

```bash
node scripts/start-crash-timer.mjs
# kill tempodesk.exe (Task Manager / taskkill /F), then relaunch with the debug port
node scripts/check-recovery.mjs

node scripts/ui-quit.mjs          # starts a timer and quits with "stop"
# relaunch with debug port
node scripts/check-quit-stop.mjs

node scripts/ui-quit-keep.mjs     # starts a timer and quits with "keep"
# relaunch with debug port
node scripts/check-quit-keep.mjs
```

`check-hidden-timer.mjs` verifies close-to-tray with an active timer and single-instance restore.

`npm run smoke` (no CDP required) launches the built app, verifies the SQLite file header/path, and
kills it. Use `npm run smoke -- --release` for the release binary.

## Host-specific assumptions

- Time zone: `America/Chicago` is used in a few scripts to read the current date.
- Overnight test date: `2026-10-27` (valid because the host clock is 2026-10-28).
- `ui-settings2.mjs` checks the Windows `HKCU\...\Run` autostart key; on macOS this section must be
  adapted to a LaunchAgent check.
- `ui-shortcuts.mjs` documents the shortcut registration/invalid-binding checks, but **synthetic
  global hotkey presses were blocked in the automation session**; verify physical presses manually.
- Tray menu clicks, native notification permission, and native Save/Open dialog clicks cannot be
  automated this way; use the manual checklist in `docs/PLATFORM_SUPPORT.md` and
  `docs/TEST_REPORT.md`.

## Notes

- Scripts are intentionally stateful and ordered. Re-running `ui-smoke.mjs` without a fresh profile
  will skip onboarding (it detects the missing welcome dialog) and create additional test data.
- Screenshots are written to `docs/screenshots/`.
- `cdp-lib.mjs` contains the small CDP client (evaluate, click by text/aria, type, select, wait,
  screenshot).
