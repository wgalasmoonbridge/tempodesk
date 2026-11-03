# Live sharing proof of concept

This standalone experiment serves a live report and timesheet using generated records in an
in-memory SQLite database. It reuses `tempodesk-core` for validation, tracking, filtering, and
timezone allocation. It has no database-path option and never opens the installed app's data.

The selected scope is the demo **Website refresh** project over seven fixed calendar dates in
**Asia/Manila**. A second project's canary records must never appear in the shared projection.
Descriptions and billable fields are hidden by default. Raw entry IDs, client IDs, metadata,
settings, backups, SQL, and desktop IPC are not part of the public API.

## Run

Use Node 24 and the project's Rust toolchain. On this host, MinGW's `bin` directory must be on
PATH when building (`C:\Users\william.MB\tools\mingw64\bin`). Build and verify:

```powershell
npm.cmd run share:poc:build
npm.cmd run share:poc:test
npm.cmd run share:poc -- --verify
```

`--verify` creates a temporary Cloudflare URL, checks the public endpoints, and opens an isolated
headless Edge profile to verify the real browser page. Windows x64 tooling automatically downloads
the official `cloudflared` release into `.test-data/tools/` and verifies GitHub's published SHA-256
digest before executing it. Other platforms require an independently verified `CLOUDFLARED_PATH`.
The launcher checks report readiness before showing the link, allowing up to three minutes for
temporary DNS/connector startup. Initial hostname-resolution delays were observed on this host.

Local-only verification without a tunnel:

```powershell
npm.cmd run share:poc -- --local-only --verify
```

Optional flags: `--ttl-seconds 3600` (60–3,600), `--include-descriptions`, and `--include-billable`.
The default link expires one hour after server startup. The server shuts down after a 30-second
expiry grace period and the launcher stops its tunnel. A report link works only while both are
running. Temporary tunnel hostnames change when a new tunnel is created.

The run directory under `.test-data/sharing-*` contains the current link, process IDs, expiry,
verification flags, and browser screenshots. These artifacts and the helper binary are git-ignored.

## Owner controls

Type these into the running launcher's terminal:

| Command | Effect |
|---|---|
| `add` | Add one generated minute of work to the in-memory demo; viewers refresh automatically. |
| `pause` / `resume` | Simulate source unavailability and recovery without changing its records. |
| `rotate` | Replace an active link's token; the old link stops working. |
| `revoke` | Immediately deny future reads of the current link. |
| `new-link` | Create a different grant for the same fixed scope, bounded by the original demo expiry. |
| `status` | Check the in-memory ledger fingerprint. |
| `quit` | Shut down the demo and tunnel; Ctrl+C also performs cleanup. |

Owner commands use stdin and have no HTTP counterpart. The public server binds to `127.0.0.1`
on an automatically assigned port. Its API only supports GET/HEAD. Browser filters cannot widen
the stored scope; query parameters are rejected. Every data read checks the capability, expiry,
and revocation under the same lock used to build the projection.

## Browser behavior and safeguards

- Overview and timesheet use one filtered projection from the existing report calculation.
- Approved descriptions are rendered as text; the page loads no third-party scripts or assets.
- Five-second polling pauses in hidden tabs; source failures retain the last view with an offline
  indicator and retry automatically. Expired/revoked links clear the view and stop polling.
- Responses use `Cache-Control: no-store`, a restrictive CSP, `no-referrer`, and `nosniff`.
- Tokens have 256 random bits; only their SHA-256 hashes are kept in the grant. Link disclosure
  allows access until expiry/revocation; recipients can retain copies of already received data.
- Tests compare ledger fingerprints before/after read-only requests and check cross-project
  isolation, field minimization, live totals, clipping, rotation, expiry, and revocation.

## Limits before production integration

This is a generated-data experiment, not an installed-app feature. Quick Tunnels have no uptime
guarantee and are documented for testing/development. Regular sharing needs a stable tunnel setup,
owner-facing scope/field previews, access policy choices, request/concurrency limits, process
lifecycle handling, and a visible Stop sharing control in the desktop app. Password/email gates
are not part of this prototype.

Source interruption is tested through HTTP failures and browser retry behavior. A physical PC
sleep/wake cycle is not simulated because it would disturb the user's running desktop app.
macOS runtime behavior remains unverified. The normal Cloudflare HTTPS proxy can process selected
report traffic; this prototype does not claim end-to-end encryption against the tunnel provider.

## Verification evidence (2026-11-04)

- Seven Rust tests pass: projection/core totals, scope and fields, clipped intervals, immutable
  reads, live changes, token rotation, expiry, and revocation across unit and actual HTTP checks.
- Three browser-script tests pass: safe text rendering, offline retention/recovery, and clearing
  revoked reports while stopping further fetches.
- The public Quick Tunnel passes HTTPS report/viewer requests, fixed-filter rejection, write
  rejection with an unchanged ledger fingerprint, live updates, source recovery, token rotation,
  expiry, and revocation.
- Isolated headless Edge passes overview/timesheet switching, source interruption/recovery,
  revoked-data clearing, and no horizontal page overflow at 390px. Desktop and phone-width
  screenshots are retained in the ignored run directory.
- Native build, Rust formatting/Clippy, root typecheck, and ESLint pass. Neither the installed
  app nor its database was used or modified during these checks.

References: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/),
[regular tunnel setup](https://developers.cloudflare.com/tunnel/get-started/).
