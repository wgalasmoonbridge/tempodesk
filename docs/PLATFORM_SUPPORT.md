# Platform Support

TempoDesk targets **Windows 11** and **macOS 13+**, with experimental **Linux** builds now configured.
This repository was developed and runtime-tested
only on Windows 11 x64. An unsigned Intel macOS app/DMG builds successfully in GitHub Actions, but
macOS runtime behavior remains **unverified** until tested on real hardware. The new CI/release
matrices also include Apple Silicon and Linux; those new packages have not been built on this host.
See [MACHINE_ACTIVITY.md](MACHINE_ACTIVITY.md) for the account/login feature's three-OS capability
matrix, compile checks, privacy boundaries, and remaining runtime tests.

## Support matrix

| Capability | Windows 11 | macOS 13+ |
|---|---|---|
| Build status on this repo | **Verified** locally (GNU) and in CI (MSVC) | **Intel CI build passed**; runtime unverified |
| Installer | **0.5.0 local NSIS installed and verified** over 0.4.0; previous 0.4.0 NSIS/MSI published | **0.4.0 Intel app/DMG published**; install/runtime unverified |
| Native titlebar/window controls | **Verified** | Implemented (Tauri native decorations), unverified |
| Native menu bar | **Verified visually** (File/Edit/Window/Help) | Implemented (app menu added on macOS), unverified |
| System tray / menu-bar icon | Created (`trayAvailable: true`); menu actions not click-tested | Implemented with tray title elapsed time; unverified |
| Close-to-tray + quit policy | **Verified** | Same code path; unverified |
| Single instance | **Verified** | Same plugin; unverified |
| Global shortcuts | Registration **verified**; synthetic key press blocked in this session; manual press required | Implemented with `CommandOrControl`; unverified |
| OS theme following | Light/dark/system overrides **verified**; live OS switch not toggled | Same `matchMedia` path; unverified |
| Native notifications | Implemented; permission prompt not exercised; in-app fallback **verified** | Requires notification permission at first send/request; unverified |
| Idle detection | **Verified** with `GetLastInputInfo` (opt-in) | Implemented via `CGEventSourceSecondsSinceLastEventType` (combined session, no window content); unverified |
| Machine activity | **0.5.0 installed**; native identity/session query, dev UI, and data-preserving upgrade verified; physical lock/RDP checks pending | Intel/Apple Silicon adapters cross-checked; runtime unverified; public lock events unsupported |
| AI API key storage | **Verified** Windows Credential Manager (per-profile accounts); fake test key set/removed | Implemented with Keychain (`apple-native`); unverified |
| AI summaries | Local summaries **verified**; Gemini request path compiled, key storage verified, live call not tested without a key | Local summaries implemented; Gemini live call unverified |
| Autostart | **Verified** (HKCU Run create/remove + hidden `--autostart` launch; second launch shows window) | Implemented via LaunchAgent; unverified |
| SQLite data dir | **Verified** `%APPDATA%\com.tempodesk.desktop\tempodesk.db` | `~/Library/Application Support/com.tempodesk.desktop/tempodesk.db` |
| Native Save/Open dialogs | Dialog plugin wired; backend writes verified; UI click-through manual | Same plugin; unverified |
| WebView content widgets | WebView2 | WKWebView (Tauri); not native SwiftUI controls |
| Code signing | Not signed | Not signed/notarized |

Legend: **Verified** = run on this host; **Implemented** = code present, not run on this host.

## Windows notes

- **Toolchain deviation:** the host lacks MSVC Build Tools and admin rights, so the verified build
  uses `x86_64-pc-windows-gnu` with MinGW-w64 GCC 16.2.0 UCRT. This is a valid app build but not the
  recommended public-release toolchain.
- A GNU link warning appears: `.rsrc merge failure: multiple non-default manifests`. The executable
  and NSIS installer launch correctly. Build with MSVC (`x86_64-pc-windows-msvc` + Visual Studio
  Build Tools) for a clean production artifact.
- Installer is per-user (`nsis.installMode = "currentUser"`), installs to `%LOCALAPPDATA%\TempoDesk`,
  and does not need admin rights. It is unsigned, so SmartScreen may warn.
- `GetLastInputInfo` provides aggregate idle seconds; no accessibility permission is required.
- Global shortcuts are registered with the OS; `get_shortcut_status` reports success. Synthetic
  `keybd_event`/`SendInput` did **not** trigger `RegisterHotKey` in the automation session, so a
  physical press remains a manual check.
- Notifications use the Windows toast API via `tauri-plugin-notification`; permission handling is
  OS-managed. In-app idle banners work regardless.
- Window chrome: native Windows titlebar with system menu, plus the app’s native menu bar.

## macOS implementation notes (unverified)

- **Bundle identifier:** `com.tempodesk.desktop` (production) and `com.tempodesk.desktop.dev`
  (development). The NSIS/Windows data paths are documented above; macOS uses Application Support.
- **Data isolation:** Release builds always use the production app-data directory and ignore
  `TEMPO_DATA_DIR`. Debug builds use a sibling `...dev` directory (or `TEMPO_DATA_DIR`), so running
  `npm run tauri:dev`, UI tests, or crash tests can never open the installed app’s database.
- **Window:** native traffic lights and titlebar; no custom fake titlebar.
- **Menu:** a `TempoDesk` app menu is added with About, Settings (⌘,), Hide/Hide Others/Show All and
  Quit; File/Edit/Window/Help menus include standard editing items.
- **Tray/menu bar:** `TrayIconBuilder` with a template-friendly icon; while a timer runs the tray
  title shows elapsed `HH:MM:SS`; menu contains status, start/stop, recent 5, open, settings, quit.
- **Global shortcuts:** default `CommandOrControl+Shift+T` and `+Y`, which map to ⌘⇧T / ⌘⇧Y.
  Registration must occur on the main thread; the plugin handles that internally.
- **Idle:** `CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState,
  kCGAnyInputEventType)` via a `#[link(name = "CoreGraphics", kind = "framework")]` declaration.
  This reads only aggregate idle duration; no screen recording/accessibility permission is used.
- **Autostart:** `tauri-plugin-autostart` LaunchAgent mode.
- **Notifications:** macOS requires user permission. TempoDesk requests it only from the onboarding
  “Allow notifications” button (never repeatedly) and always falls back to in-app banners.
- **Installer:** Tauri `dmg`/`app` bundle targets are configured; unsigned builds require
  right-click/Open or Gatekeeper approval.

### Exact macOS verification steps (when a Mac is available)

1. Install Xcode Command Line Tools (`xcode-select --install`), Node 20+, Rust stable with the
   `aarch64-apple-darwin` or `x86_64-apple-darwin` target.
2. `npm ci`, then `npm run check`.
3. `npm run tauri:dev`, create a project, start a timer, hide the window with ⌘W, verify the menu-bar
   elapsed title continues, reopen from the menu-bar icon, stop the timer.
4. Press ⌘⇧T (open/hide) and ⌘⇧Y (toggle) while another app is focused; verify registration status
   and that only one active entry exists after rapid presses.
5. Enable idle detection in Settings with a 1-minute threshold; leave the machine idle >1 minute
   with a timer running. Verify exactly one review notification/banner; test Keep, Remove gap split,
   and End at idle start; verify entries in Timesheet/Reports.
6. Deny notifications in System Settings → Notifications → TempoDesk and repeat idle test; verify
   the in-app banner and explanatory status remain.
7. Quit with a timer running using both “Stop timer & quit” and “Keep running & quit”; relaunch and
   verify no recovery prompt vs. recovery prompt with Continue/Stop options.
8. Toggle the OS appearance (System Settings → Appearance) while TempoDesk is open; verify the UI
   follows in System mode. Toggle the manual override.
9. Enable Launch at login; verify a LaunchAgent/Login Items entry, reboot (or log out/in), and verify
   the app starts in the tray. Disable and verify removal.
10. Create a backup and CSV using native Save dialogs; restore and compare totals.
11. `npm run tauri:build`; install/open the `.dmg`, launch from Applications, confirm data under
    `~/Library/Application Support/com.tempodesk.desktop/`, and record results in this document.
12. Configure Gemini in Settings → AI summaries; verify Keychain save/remove, consent gating, model
    validation, Test connection, a real AI summary, and the “Use local summary” fallback after
    revoking the key or going offline.
13. Run the CDP UI suite against the debug app if WebView2-equivalent remote debugging is available
    (WKWebView inspection differs; otherwise use manual checks above).

## Linux

Experimental desktop target. The check/release matrices now include Ubuntu 24.04 x64 with deb and
AppImage packaging configured; neither a Linux desktop nor the new packages were run on this host.
Native machine-activity adapters were cross-checked for x86_64 Linux. Account identity uses libc;
login/session metadata uses the current process's logind/elogind session over system D-Bus. UID
mismatches are rejected. Without that service or a matching session, identity still works and the UI
reports other capabilities unavailable. LockedHint is advisory and sampled, so GNOME/KDE compositor
support must be tested on both X11 and Wayland.

Tray/global shortcuts/autostart still vary by desktop environment and need runtime validation. The
existing idle API returns “unavailable” with a non-blocking explanation; it is independent of the new
machine-activity feature. Linux build dependencies include `libwebkit2gtk-4.1-dev`, `libssl-dev`,
`libdbus-1-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `libxdo-dev`, `patchelf`, and a C compiler.

## Distribution

- Windows: NSIS current-user installer (built, unsigned).
- macOS: unsigned Intel `.app`/`.dmg` previously built and published by GitHub Actions; not runtime-tested.
  Apple Silicon is now included in the build/release matrix, pending runner and real-device verification.
- Linux: deb/AppImage packaging configured in CI; build/install/runtime verification remains pending.
- Public distribution requires code signing/notarization and an update pipeline; those are P1 and
  intentionally deferred.
