# Changelog

## 0.3.0 — 2026-11-03

### Added

- Saved task templates with local CRUD, project/tags/billable metadata, tracker start/switch,
  and native tray start.
- Transactional bulk metadata editing with add/remove/replace tags and conflict-aware undo.
- Opt-in daily local backups with folder selection, retention, last-backup/error status, and
  immediate backup. Scheduling works while hidden in the tray and catches up on launch.
- Backup format v2 includes templates and continues to restore v1 backups. Folder paths and
  automatic scheduling are device-specific and excluded; restore leaves scheduling off.

### Fixed

- History now pages through the full filtered dataset and reports complete counts and totals,
  replacing the previous 1,000-entry cap. Live totals respect the selected range end.
- Schema migration v2 preserves existing entries and adds templates and bulk-edit undo records.

### Windows installation verification

- Built and applied the 0.3.0 NSIS installer over the installed 0.2.0 app using update mode.
- Confirmed all existing time entries, project/client/tag data, stored settings, and the running
  timer were unchanged after migration and launch. SQLite/JSON backups and the previous executable
  were retained locally before the upgrade.

### GitHub release artifacts

- Windows x64 bundles built and published by GitHub Actions:
  - `TempoDesk_0.3.0_x64-setup.exe`
    - SHA-256: `bf005abb1416542e8339693789dee8c3fb2e5fffab9a6f671b2d392129476320`
  - `TempoDesk_0.3.0_x64_en-US.msi`
    - SHA-256: `97d0e8ed0f5e0a2bd7f877ed6f95067427ae3af3ec854a7d881553f9353107c4`
- macOS Intel bundles built and published by GitHub Actions (runtime unverified):
  - `TempoDesk_0.3.0_x64.dmg`
    - SHA-256: `842e259f7b8994b9352e83e261bc6d859f756f22bb383ec0ad4a35ebf9a148bc`
  - `TempoDesk_x64.app.tar.gz`
    - SHA-256: `0e436d76b72be9dd5b249a3f219740ee2256fad7389b686d516e078b227299b8`

## 0.2.0 — 2026-11-02

### Added

- Visual Calendar screen with day and week views.
- Project-colored entry blocks clipped to local calendar days.
- 15-minute click/drag creation using the shared manual-entry editor.
- Click-to-edit for existing calendar blocks.
- Side-by-side lanes for overlapping entries.
- Current-time marker and quick day/week navigation.
- Calendar WebView2 verification script and screenshot.

### Improved

- Manual-entry dialog accepts preselected calendar start/end times.
- Local date/time conversion now chooses the earlier repeated time during DST fall-back and moves
  nonexistent spring-forward times to the first valid instant after the gap.
- Version strings and AI HTTP user agent now follow the 0.2.0 application version.

### Verification

- `npm run check`: 24 frontend tests and 50 Rust tests passed.
- Real Tauri/WebView2 calendar flow passed: week render, pointer drag 14:00–15:30, save, edit,
  and day/week switching.
- Windows bundles built:
  - `src-tauri/target/release/bundle/nsis/TempoDesk_0.2.0_x64-setup.exe`
    - SHA-256: `4d51383115c3c51a829748f98ef83bc0f00a7340d929efe562964534ae89dfb5`
  - `src-tauri/target/release/bundle/msi/TempoDesk_0.2.0_x64_en-US.msi`
    - SHA-256: `0270caded310e61d04291ca0480cfdad3779ce5b6702f7051cab429f7b717103`

### Known release limitations

- Windows bundles are unsigned and use the GNU toolchain; MSVC plus code signing is recommended for
  public distribution.
- Unsigned Intel macOS app/DMG bundles build in GitHub Actions; signing, notarization, installation,
  and runtime verification still require macOS release credentials/hardware.
- The 0.2.0 installer upgrade path has not been run over an active production installation.
