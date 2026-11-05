// Windows WebView2 integration check. Never drives a production profile or locks the machine.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, assert } from "./cdp-lib.mjs";

const cdp = await connect();
const invoke = (command, args = {}) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
const dialog = "document.querySelector('[role=dialog]')";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitInvoke(command, args, predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await invoke(command, args);
    if (predicate(value)) return value;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${command}`);
}

let timerId;
try {
  assert(cdp.platformInfo.dataProfile === "test", "machine-activity verification requires an isolated test profile");
  const settings = await invoke("get_settings");
  assert(!settings.machineActivityEnabled, "monitoring defaults off");
  assert(!(await invoke("get_machine_activity_status")).currentSession, "disabled status contains no current identity");
  await invoke("update_settings", { patch: { onboardingComplete: true } });
  await cdp.waitFor("!document.querySelector('[role=dialog]')", { label: "onboarding dismissed" });
  const timer = await invoke("start_timer", { input: { description: "Machine activity verification timer", tagIds: [] } });
  timerId = timer.id;
  await cdp.click("Settings");
  await cdp.click("Machine activity");
  await cdp.waitFor("document.body.innerText.includes('No activity recorded in this range.')");
  await cdp.clickAria("Log my machine activity");
  await cdp.click("Cancel", dialog);
  assert(!(await invoke("get_settings")).machineActivityEnabled, "cancel does not grant consent");
  await cdp.clickAria("Log my machine activity");
  await cdp.click("Enable logging", dialog);
  const status = await waitInvoke("get_machine_activity_status", {}, (status) => Boolean(status.currentSession));
  assert(status.currentSession.userName && status.currentSession.accountId && status.currentSession.machineName, "native account identity resolved");
  const history = await waitInvoke("list_machine_activity", { filter: {} }, (page) => page.totalCount > 0);
  assert(history.events.some((event) => event.kind === "session_observed" && event.timing === "observed"), "startup observation is labelled honestly");
  if (status.currentSession.loginAtUtc !== null && status.currentSession.loginAtUtc >= Date.now() - settings.machineActivityRetentionDays * 86400000) {
    const login = history.events.find((event) => event.kind === "login");
    assert(login && login.eventAtUtc === status.currentSession.loginAtUtc && login.timing === "os_reported", "login time is OS-reported, not app startup");
  }
  assert((await invoke("get_app_status", { timezone: "UTC" })).activeEntry.id === timerId, "monitoring never changes the timer");
  await cdp.waitFor("document.body.innerText.includes('Account identifier')");
  await cdp.screenshot(".test-data/machine-activity.png"); // Contains local identity: never commit.
  await cdp.select('[aria-label="Machine activity retention"]', "7");
  assert((await invoke("get_settings")).machineActivityRetentionDays === 7, "retention saves");
  console.log("PASS consent, native identity, honest timestamps, retention, timer isolation");
  console.log(`Native capabilities available: ${status.capabilities.filter((item) => item.status === "available").map((item) => item.feature).join(", ")}`);

  const backupPath = join(cdp.platformInfo.dataDir, "machine-activity-backup.json");
  await invoke("save_backup", { destination: backupPath });
  const backupText = readFileSync(backupPath, "utf8");
  const backup = JSON.parse(backupText);
  assert(!backupText.includes(status.currentSession.accountId), "backups do not contain account identifiers");
  assert(!("machineActivityEnabled" in backup.settings), "portable backups cannot carry monitoring consent");
  const exportPath = join(cdp.platformInfo.dataDir, "machine-activity.csv");
  const exportHistory = await invoke("list_machine_activity", { filter: {} });
  const exported = await invoke("export_machine_activity_csv", { filter: {}, destination: exportPath });
  const csv = readFileSync(exportPath, "utf8");
  assert(csv.includes("observed_at_utc") && exported.rowCount === exportHistory.totalCount, "CSV includes observation timestamps and all rows");
  const loginCount = exportHistory.events.filter((event) => event.kind === "login").length;
  await cdp.clickAria("Log my machine activity");
  await cdp.waitFor("document.querySelector('[aria-label=\"Log my machine activity\"]').getAttribute('aria-checked') === 'false' && !document.querySelector('[aria-label=\"Log my machine activity\"]').disabled");
  await cdp.clickAria("Log my machine activity");
  await cdp.click("Enable logging", dialog);
  await waitInvoke("get_machine_activity_status", {}, (status) => Boolean(status.currentSession));
  const restartedHistory = await invoke("list_machine_activity", { filter: {} });
  assert(restartedHistory.events.filter((event) => event.kind === "login").length === loginCount, "login deduplication survives re-enabling");
  console.log("PASS backup privacy, full CSV, and login deduplication");

  await invoke("restore_backup", { source: backupPath });
  const restoredSettings = await invoke("get_settings");
  assert(!restoredSettings.machineActivityEnabled && restoredSettings.machineActivityRetentionDays === 7, "restore disables monitoring but retains this device's retention preference");
  assert(!(await invoke("get_machine_activity_status")).currentSession, "restore invalidates cached identity");
  const afterRestore = await invoke("list_machine_activity", { filter: {} });
  assert(JSON.stringify(afterRestore.events.map((event) => event.id)) === JSON.stringify(restartedHistory.events.map((event) => event.id)), "portable restore leaves the device-local ledger intact");
  await invoke("resolve_recovery", { action: "continue" });
  await cdp.waitFor("!document.querySelector('[role=dialog]')");
  assert((await invoke("get_app_status", { timezone: "UTC" })).activeEntry.id === timerId, "restore and recovery preserve the timer");
  await cdp.waitFor("document.querySelector('[aria-label=\"Log my machine activity\"]').getAttribute('aria-checked') === 'false'");
  await cdp.clickAria("Log my machine activity");
  await cdp.click("Enable logging", dialog);
  await waitInvoke("get_machine_activity_status", {}, (status) => Boolean(status.currentSession));
  console.log("PASS portable restore: fresh consent, retained local ledger/retention, timer preserved");

  await cdp.click("Clear all history");
  await cdp.click("Clear history", dialog);
  await cdp.waitFor("!document.querySelector('[role=dialog]')");
  await delay(5500);
  assert((await invoke("list_machine_activity", { filter: {} })).totalCount === 0, "clear does not immediately re-import old login events");
  await cdp.clickAria("Log my machine activity");
  const off = await invoke("get_machine_activity_status");
  assert(!off.enabled && !off.currentSession, "opt-out immediately removes cached identity");
  assert((await invoke("get_app_status", { timezone: "UTC" })).activeEntry.id === timerId, "clear and disable preserve the running timer");
  console.log("PASS clear-history suppression, opt-out, and timer isolation");
  console.log("All machine-activity UI checks passed; real login/lock/RDP/sleep remain manual OS checks.");
} finally {
  if (timerId) {
    const active = (await invoke("get_app_status", { timezone: "UTC" })).activeEntry;
    if (active?.id === timerId) await invoke("stop_timer");
  }
  cdp.close();
}
