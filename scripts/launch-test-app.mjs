// Launch the debug build against an isolated TEST data directory.
// The production TempoDesk app data is never opened by this process.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const reuse = process.argv.includes("--reuse");
const port = process.env.CDP_PORT ?? "9222";
const exe = join(
  process.cwd(),
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "tempodesk.exe" : "tempodesk",
);
const stateFile = join(process.cwd(), ".test-data", "current.json");

if (!existsSync(exe)) {
  console.error(`Debug app not found at ${exe}. Build it first with: npm run build:test`);
  process.exit(1);
}

let existing = null;
try {
  existing = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {
  /* no active test run */
}
if (existing?.pid) {
  try {
    process.kill(existing.pid, 0);
    console.error(
      `A test app appears to be running (pid ${existing.pid}). Run: node scripts/stop-test-app.mjs`,
    );
    process.exit(1);
  } catch {
    rmSync(stateFile, { force: true });
  }
}

try {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (response.ok) {
    console.error(
      `Port ${port} is already serving a WebView2 page. Stop that test app first or set CDP_PORT.`,
    );
    process.exit(1);
  }
} catch {
  /* port free */
}

let dataDir;
if (reuse) {
  if (!existing?.dataDir || !existsSync(existing.dataDir)) {
    console.error("--reuse requested but no previous test data directory was found.");
    process.exit(1);
  }
  dataDir = existing.dataDir;
  console.log(`Reusing test data: ${dataDir}`);
} else {
  dataDir = join(process.cwd(), ".test-data", `run-${Date.now()}`);
  mkdirSync(dataDir, { recursive: true });
}

const child = spawn(exe, [], {
  detached: true,
  stdio: "ignore",
  env: {
    ...process.env,
    TEMPO_DATA_DIR: dataDir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
});
child.unref();
mkdirSync(join(process.cwd(), ".test-data"), { recursive: true });
writeFileSync(
  stateFile,
  JSON.stringify(
    { pid: child.pid, dataDir, port, startedAt: new Date().toISOString() },
    null,
    2,
  ),
);

let pageReady = false;
for (let attempt = 0; attempt < 80; attempt += 1) {
  if (child.exitCode !== null) break;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    const targets = await response.json();
    if (targets.some((target) => target.type === "page")) {
      pageReady = true;
      break;
    }
  } catch {
    /* still booting */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const stopFailedLaunch = () => {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(child.pid, "SIGTERM");
    }
  } catch {
    /* already gone */
  }
  rmSync(stateFile, { force: true });
};

if (!pageReady) {
  stopFailedLaunch();
  console.error("Test app did not expose a WebView2 page. See the app logs/console.");
  process.exit(1);
}

// Verify the app is actually running against the isolated test profile.
process.env.CDP_PORT = port;
const { connect } = await import("./cdp-lib.mjs");
let appData = null;
try {
  const cdp = await connect();
  appData = cdp.platformInfo;
  cdp.close();
} catch (error) {
  console.error(String(error));
  console.error("Stopping the test app because the profile guard failed.");
  stopFailedLaunch();
  process.exit(1);
}

console.log("TempoDesk TEST app running");
console.log(`  pid:      ${child.pid}`);
console.log(`  profile:  ${appData.dataProfile}`);
console.log(`  data dir: ${appData.dataDir}`);
console.log(`  db:       ${appData.dbPath}`);
console.log(`  cdp:      http://127.0.0.1:${port}`);
console.log("Stop with: node scripts/stop-test-app.mjs");
