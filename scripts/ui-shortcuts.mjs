import { connect, assert } from "./cdp-lib.mjs";
import { execFileSync } from "node:child_process";
const cdp = await connect();
const invoke = (command, args) =>
  cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const status = () => invoke("get_app_status", { timezone: "America/Chicago" });

try {
  await invoke("update_settings", { patch: { idleTrackingEnabled: false } });
  let current = await status();
  if (current.activeEntry) {
    await invoke("stop_timer");
  }

  const ps = (script) => execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  ps("Start-Process notepad; Start-Sleep -Milliseconds 1500; $w = New-Object -ComObject wscript.shell; $w.AppActivate('Notepad') | Out-Null; Start-Sleep -Milliseconds 500");

  ps("$w = New-Object -ComObject wscript.shell; $w.AppActivate('Notepad') | Out-Null; Start-Sleep -Milliseconds 400; $w.SendKeys('^+y')");
  await wait(1500);
  current = await status();
  assert(current.activeEntry, "global shortcut started a timer");
  console.log("PASS global shortcut started timer");

  ps("$w = New-Object -ComObject wscript.shell; $w.AppActivate('Notepad') | Out-Null; Start-Sleep -Milliseconds 400; $w.SendKeys('^+y')");
  await wait(1500);
  current = await status();
  assert(!current.activeEntry, "second global shortcut stopped the same timer exactly once");
  const entries = await invoke("list_entries", { filter: { timezone: "America/Chicago", limit: 20 } });
  const justStopped = entries.find((entry) => entry.description === "" && entry.endAtUtc);
  assert(justStopped, "shortcut-created entry saved");
  console.log("PASS global shortcut stopped timer once");

  const shortcutStatus = await invoke("get_shortcut_status");
  assert(shortcutStatus.openOk && shortcutStatus.toggleOk, "shortcuts registered");
  console.log("PASS shortcut registration status");

  let rejected = false;
  try {
    await invoke("update_settings", {
      patch: { openShortcut: "Definitely+Not+A+Key", toggleShortcut: "CommandOrControl+Shift+Y" },
    });
  } catch (error) {
    rejected = true;
    const message = JSON.stringify(error);
    assert(message.toLowerCase().includes("valid") || message.toLowerCase().includes("key"), "recoverable validation error");
  }
  assert(rejected, "invalid shortcut rejected without crashing");
  console.log("PASS invalid shortcut rejected");

  ps("Stop-Process -Name notepad -ErrorAction SilentlyContinue");
  console.log("Global shortcut checks passed");
} finally {
  cdp.close();
}
