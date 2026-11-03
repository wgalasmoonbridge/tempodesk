# Live report sharing

TempoDesk 0.4 adds optional, temporary browser links to Reports and Timesheet. No account or
separate terminal is required. This beta uses Cloudflare Quick Tunnels; temporary addresses have
no uptime guarantee and change when a new share starts.

## Use

1. Choose dates and filters in **Reports**, or a week in **Timesheet**, and click **Share**.
2. Review the frozen scope and preview. Set a title and duration (15 minutes, 1 hour, 8 hours or
   24 hours). Descriptions and billable details are hidden unless explicitly selected.
3. Click **Create public link**. First use downloads the official tunnel helper from GitHub,
   verifying the release's SHA-256 digest before execution. Startup waits for DNS and public
   reachability before showing the link.
4. **Copy link** and send it to your recipient. The browser includes overview and timesheet views
   and refreshes every five seconds while visible. Committed edits and running work update live.
5. **Replace link** invalidates the old token without changing scope. **Stop sharing** is available
   in the dialog and the banner on every app screen.

Only one share is active at a time. Changing desktop filters does not widen an existing link.
Stop and create another to change scope. Quit, expiry, tunnel failure and backup restore end
sharing; startup never recreates it. Closing to the tray keeps sharing active. PC, Internet and
app availability are required.

Anyone with the complete link can view and copy the selected report. Cloudflare processes the
proxied traffic; this is not end-to-end encryption against the provider. Recipients can retain
received data. Offline browsers show their last report with an offline notice; known expiry
clears it locally. Closing the tunnel prevents further reads, but cannot erase copies or a view
already received. Email/password gates and stable named tunnels are not included in this beta.

## Architecture

- `tempodesk-sharing` is Tauri-independent. Typed desktop commands manage the service; only the
  separate Axum HTTP router is reachable through the tunnel.
- A separate SQLite connection uses `READ_ONLY` and `query_only`, without running migrations.
  Short read transactions see committed WAL updates consistently. Reads never change the main
  writer, timer, templates, backups or settings.
- An immutable policy stores the exact filters, approved title/fields and expiry. A dedicated
  public projection reuses core report math and clips intervals. IDs, client metadata, tags,
  settings, backups and IPC stay private. Project names, session dates and durations are shared.
- Tokens have 256 random bits. The HTTP source keeps only their SHA-256 hash; the owner's current
  URL stays in process memory. Every viewer/data/health request checks token, revocation and
  expiry. Owner actions have no HTTP routes. Query parameters are rejected.
- The server binds to `127.0.0.1` on an assigned port and permits only GET/HEAD. Limits are 8
  concurrent handlers, 120 requests/second, a one-second projection cache, 366 days and 10,000
  sessions. Responses use no-store, no-referrer, nosniff, noindex and a restrictive CSP. The viewer
  uses text rendering, local assets, no credentials, no storage and no analytics.
- The service owns its server and child process. Generation checks prevent cancelled startup
  from publishing a link. Stop/quit synchronously revoke and terminate both. Connection failure
  shows reconnecting; a dead helper ends sharing. A crashed parent has no report listener, though
  abnormal termination may leave a helper running without its source until OS cleanup.
- Helpers live in `<app-data>/sharing-tools/`. macOS archives are verified first and read only the
  expected executable into a fixed filename; archive paths are never extracted.

## Verification

```powershell
npm.cmd run check:sharing
npm.cmd run build:test
node scripts/launch-test-app.mjs
node scripts/ui-sharing.mjs
```

The native script requires a test profile inside `.test-data/`. It seeds generated fixtures,
checks preview/public access/live edits/timers, verifies ledger preservation across reads, and
tests scope/method rejection, rotation, startup cancellation, global stop and normal quit cleanup.
It never shares installed-app data. Screenshots/results remain in the ignored test-profile folder.
The earlier experiment remains in `sharing-poc/`; both harnesses use `sharing/web/` browser assets.

Windows native end-to-end checks pass. Physical sleep/wake and macOS runtime remain manual checks.
See [test evidence](../docs/TEST_REPORT.md). Regular production hosting with a stable hostname needs
a named tunnel and access policy before extending this beta.

Primary references: [Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/),
[regular tunnel setup](https://developers.cloudflare.com/tunnel/get-started/),
[official helper releases](https://github.com/cloudflare/cloudflared/releases).
