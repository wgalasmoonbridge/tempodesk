// Launch smoke test: starts the built app, waits for the real SQLite database, then exits.
// Run when TempoDesk is not already running: `npm run smoke` (debug) or `npm run smoke -- --release`.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const release = process.argv.includes("--release");
const allowProduction = process.env.ALLOW_PRODUCTION_TESTS === "1";
if (release && !allowProduction) {
  console.error(
    "Refusing to launch the production build: it would write heartbeat/clean-exit state to the " +
      "installed app data. Set ALLOW_PRODUCTION_TESTS=1 only for an intentional packaging check.",
  );
  process.exit(1);
}
const exe = join(
  process.cwd(),
  "src-tauri",
  "target",
  release ? "release" : "debug",
  process.platform === "win32" ? "tempodesk.exe" : "tempodesk",
);

if (!existsSync(exe)) {
  console.error(`Built app not found at ${exe}. Run: npx tauri build ${release ? "" : "--debug --no-bundle"}`);
  process.exit(1);
}

const identifier = "com.tempodesk.desktop";
const env = { ...process.env };
let dbPath;
if (!release) {
  // Debug smoke always uses an isolated test directory, never the dev or production profile.
  const dataDir = resolve(process.cwd(), ".test-data", `smoke-${Date.now()}`);
  mkdirSync(dataDir, { recursive: true });
  env.TEMPO_DATA_DIR = dataDir;
  dbPath = join(dataDir, "tempodesk.db");
} else if (process.platform === "win32") {
  dbPath = join(process.env.APPDATA, identifier, "tempodesk.db");
} else if (process.platform === "darwin") {
  dbPath = join(process.env.HOME, "Library", "Application Support", identifier, "tempodesk.db");
} else {
  dbPath = join(process.env.HOME, ".local", "share", identifier, "tempodesk.db");
}

const child = spawn(exe, [], { stdio: "ignore", windowsHide: false, env });
let exitedEarly = false;
child.on("exit", () => {
  exitedEarly = true;
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(500);
    if (!exitedEarly && existsSync(dbPath) && statSync(dbPath).size > 0) {
      ready = true;
      break;
    }
  }
  if (!ready) throw new Error(`App did not create ${dbPath}`);

  const fd = openSync(dbPath, "r");
  const header = Buffer.alloc(16);
  readSync(fd, header, 0, 16, 0);
  closeSync(fd);
  if (header.toString("utf8") !== "SQLite format 3\u0000") {
    throw new Error("Database does not have a valid SQLite header");
  }
  console.log(`PASS launch smoke: ${exe}`);
  console.log(`PASS SQLite database: ${dbPath}`);
} finally {
  if (!child.killed) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* already gone */
    }
  }
}
