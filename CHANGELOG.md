# Changelog

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
