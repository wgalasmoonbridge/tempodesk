# Changelog

## 0.4.0 — 2026-11-04

### Added

- Live browser sharing from Reports and Timesheet: preview fixed filters and selected fields,
  set a 15-minute to 24-hour expiry, create/copy a temporary link, and replace its token.
- A sharing banner on every screen with Stop sharing. Quit, expiry, tunnel failure and backup
  restore end sharing; closing to the tray keeps it active.
- Automatic, checksum-verified Cloudflare helper setup, loopback-only read-only HTTP, a separate
  read-only SQLite connection, restricted public projection, random capabilities, scope/method
  rejection, request limits, no-store headers and a browser view without external assets.
- Live totals from committed edits and running timers. The browser retains its last report on
  connection failure, reconnects, and clears locally at known expiry.

### Data and limitations

- No schema change. Sharing is off on launch and starts only after Create public link. Descriptions
  and billable details are hidden by default; selected project names and session times are visible
  in the preview. Existing local records are retained.
- Quick Tunnels are a beta feature with no uptime guarantee. PC/app/Internet availability is
  required; new sessions receive new addresses. Anyone with a link can view and retain the shared
  data. Stable hosting and email/password gates remain outside this release.
- Windows native app/public-tunnel tests pass with generated records in an isolated profile.
  macOS runtime and physical sleep/wake remain unverified.

### Windows upgrade verification

- Applied the 0.4.0 NSIS installer over the installed 0.3.0 app in update mode. Before/after
  per-row checks passed for existing entries, clients, projects, tags, tag links, settings,
  templates, undo and idle-review records; the running timer stayed active. SQLite/JSON backups
  and the previous executable were retained before installation. Sharing starts off.
- Local GNU installer SHA-256:
  `91b7d540d520049714fe47f04e608bd97e941ed7a249a67411005f7d18236364`.

### GitHub release artifacts

All four downloaded assets match GitHub's published SHA-256 digests:

- Windows MSVC NSIS `TempoDesk_0.4.0_x64-setup.exe`:
  `ec5fe97132cca093ed5ede9b3b3b57471ef957fd2f2e0e2725a017c981423f3a`
- Windows MSVC MSI `TempoDesk_0.4.0_x64_en-US.msi`:
  `a536e8be06a9a5e9a7f6aabdc7c31e15319dcced311da836db5b05be6cfda085`
- macOS Intel `TempoDesk_0.4.0_x64.dmg`:
  `691afcbb580a7bb2f8adff2cf69ac332eeb1ffc218835052f06fafc4ea4c89c5`
- macOS Intel `TempoDesk_x64.app.tar.gz`:
  `e9ebd85213820b6bf98b16cb60720257be013c638420334f41ba40a39c8d185a`

The installed Windows copy uses the locally tested GNU bundle listed above. GitHub's Windows
artifacts use MSVC. macOS build/test checks pass; runtime still needs Mac hardware.

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
