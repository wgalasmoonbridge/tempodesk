# Machine activity (opt-in)

Open **Settings → Machine activity → Log my machine activity**, then confirm **Enable logging**.
This records the OS account running TempoDesk, not a TempoDesk account. Monitoring is **off by
default** and never starts, stops, or edits work timers. Enable **Tray & startup → Launch at login**
for better coverage; closing to the tray keeps monitoring running.

## What is saved

- Native account identifier (Windows SID / Unix UID), username, optional domain, machine name,
  session identifier when available, event type, source, and timestamps.
- **Login:** an OS-reported login/session-start time, possibly observed later when TempoDesk starts.
  Re-observing the same login does not duplicate it, including across restarts.
- **Session observed:** when TempoDesk first observes a session after enabling, launch, or a
  monitoring gap. This is deliberately **not** labelled as a login.
- Supported lock/unlock and session activation/deactivation events. Native notification receipt
  and sampled changes have observation timestamps, not claims of exact historical event times.
- UTC epoch milliseconds aligned to whole seconds; the history UI uses the configured time zone.
  CSV includes both `event_at_utc` and `observed_at_utc`, source, and timing classification.

No passwords, input content, screenshots, URLs, or other accounts' login history are collected.
Account lookup uses native APIs, not USER/USERNAME/HOSTNAME environment variables or shell commands.
The process's account must match the desktop/session account before session details are attached;
run-as/sudo/SSH must not attach another user's active console login.

## OS coverage

| Capability | Windows 11 | macOS 13+ (Intel / Apple Silicon) | Linux (X11 / Wayland) |
|---|---|---|---|
| Current account and machine | Process token / native machine API | libc account / hostname | libc account / hostname |
| Login time | WTS session logon time | Matching OS console utmpx record, if present | logind/elogind session Timestamp, if attached |
| Lock / unlock | WTS notifications; sampled fallback if registration fails | Explicitly unsupported; private lock notifications are not used | Advisory logind LockedHint, if the desktop updates it |
| Session active / inactive | Native console/RDP connect/disconnect notifications | NSWorkspace session activation notifications | logind Active property |
| Sampling | Identity/session snapshot every 5 seconds | Snapshot every 5 seconds | Properties every 5 seconds; short transitions can be missed |
| Logoff | Best-effort WTS notification only | Not claimed | Not claimed |

The Settings capability list distinguishes **available**, **unavailable**, **permission required**,
**unsupported**, and **disabled**. Missing login times stay unknown. Display sleep is not a lock;
session switching is not login/logout. Monitoring restarts its baseline after suspension or native
query failures instead of inventing transitions across the gap.

On Linux, logind and elogind use the same `org.freedesktop.login1` system D-Bus interface. The monitor
queries the session attached to its process and validates the session UID. It does not enumerate
all users or guess an unrelated active session. Without a matching session service, account identity
still works and the other capabilities show an explanation. No administrator escalation is attempted.
Linux's lock hint depends on GNOME/KDE/compositor cooperation, not an X11-only input API.

This is a personal activity log, **not** a tamper-resistant security audit, attendance system,
machine-wide historical event-log reader, or proof of working time. Events while TempoDesk is closed,
or during abrupt logout/shutdown, may be missed. No background OS service is installed.

## Retention, clearing, and portability

- Default retention: **30 days**, configurable from **1–365 days**. Cleanup runs on startup, hourly
  while the app runs (including when logging is off), and before history reads/exports.
- Disabling immediately clears the cached current identity and rejects in-flight writes, but keeps
  existing history until it expires or is cleared. Native subscriptions are dropped by the worker.
- **Clear all history** requires confirmation and deletes all activity, not only the visible range.
  It also suppresses pending observations and re-importing that old login time after restart.
  If monitoring stays on, new observations can still be saved.
- CSV exports use the selected date range, not the current page; exports over 100,000 events require
  a narrower range. Account/device names are sensitive. Formula-like CSV values are escaped.
- Activity records, consent, and retention settings are excluded from **all portable JSON backups**,
  including automatic and pre-restore safety backups. Use CSV if you explicitly want an activity copy.
- Restoring a work backup leaves this device's activity ledger, retention preference, and clear-history
  cutoff intact, but **turns monitoring off** and requires fresh consent. A backup cannot enable it.
- Records are separate from time entries. Reports, public sharing projections, and AI summaries never
  include this ledger. The feature makes no outbound network requests. Local SQLite is not encrypted.
- Production/development/test profiles retain their existing separate data directories.

## Validation and remaining manual checks

Automated tests cover schema v1/v2 upgrades, consent, login deduplication, native notification filtering,
unknown states, monitoring gaps, retention, date bounds, full-range CSV, clear suppression, backup privacy,
restore consent, UI confirmations, and timer isolation. Native Windows tests send **synthetic window
messages**; they do not lock the machine. `scripts/ui-machine-activity.mjs` exercises the Windows UI
and real identity query only against an isolated test profile. Its screenshot stays under `.test-data/`
because it contains the local account/device name.

The macOS adapters are cross-checked for Intel and Apple Silicon; Linux adapters are cross-checked for
x64. These are compile/type/lint checks, **not runtime verification**. CI matrices are configured for
native Windows, both macOS architectures, and Linux builds/tests. CI and packages must be verified on
those runners before claiming successful builds for this change.

The local Windows **0.5.0** NSIS update has now been installed over 0.4.0, preserving existing work
records, settings, and the running timer; logging stayed off. See [TEST_REPORT.md](TEST_REPORT.md)
for the installation receipt and backup evidence. This does not verify macOS/Linux runtime or
physical Windows login/lock/RDP events.

Manual checks before claiming full runtime support:

1. Enable logging and launch at login; log out/in or reboot. Confirm OS login time is distinct from
   observation time and is not duplicated by reopening/restarting TempoDesk.
2. Windows: lock/unlock physically, switch users, disconnect/reconnect RDP, and log off. Confirm only
   the matching session is recorded, including in tray mode. Abrupt shutdown may omit logoff.
3. macOS: test both CPU architectures, normal login, fast user switching, missing console records,
   sleep/wake, and LaunchAgent startup. Screen lock must remain unsupported rather than inferred.
4. Linux: test GNOME/KDE on Wayland and X11, logind/elogind, user-service-launched apps, missing D-Bus,
   denied access, and desktops that never publish LockedHint. Validate packaging/tray/autostart too.
5. All platforms: suspend/resume, clock changes, native service failure/recovery, clear/restart,
   opt-out, backup/restore, timezone/DST filters, and unchanged running timers.
