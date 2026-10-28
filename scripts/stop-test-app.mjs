// Stop only the app launched by launch-test-app.mjs. Never touches the installed production app.
import { readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const stateFile = join(process.cwd(), ".test-data", "current.json");
let state;
try {
  state = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {
  console.error("No .test-data/current.json found; no test app to stop.");
  process.exit(1);
}
if (!state?.pid) {
  console.error("current.json has no pid; refusing to kill anything.");
  process.exit(1);
}

try {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(state.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    process.kill(state.pid, "SIGTERM");
  }
  console.log(`Stopped test app pid ${state.pid}. Test data retained at ${state.dataDir}`);
} catch (error) {
  console.error(`Could not stop pid ${state.pid}: ${error}`);
  process.exit(1);
} finally {
  rmSync(stateFile, { force: true });
}
