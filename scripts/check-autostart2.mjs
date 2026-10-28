import { execFileSync } from "node:child_process";
import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (c,a)=>cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
const registry = () => execFileSync("powershell", ["-NoProfile", "-Command", "Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue | Out-String"], { encoding: "utf8" });
try {
  await invoke("update_settings", { patch: { launchAtLogin: true } });
  await new Promise(r=>setTimeout(r,500));
  assert((await invoke("get_settings")).launchAtLogin, "setting true");
  assert(registry().toLowerCase().includes("tempodesk"), "registry entry present");
  await invoke("update_settings", { patch: { launchAtLogin: false } });
  await new Promise(r=>setTimeout(r,500));
  assert(!(await invoke("get_settings")).launchAtLogin, "setting false");
  assert(!registry().toLowerCase().includes("tempodesk"), "registry entry removed");
  console.log("PASS launch-at-login sync");
} finally { cdp.close(); }
