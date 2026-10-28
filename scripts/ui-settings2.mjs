import { execFileSync } from "node:child_process";
import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const dialog = "document.querySelector('[role=dialog]')";
const invoke = (c, a) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const info = await invoke("get_platform_info");
  assert(info.trayAvailable, "tray available");
  assert(info.idleAvailable, "Windows idle API available");
  assert(info.dbPath.includes("tempodesk.db"), "database path exposed");
  console.log("PASS platform capabilities", info.platform, info.appVersion);

  await cdp.click("Timesheet");
  await cdp.waitFor("document.body.innerText.includes('Daily totals')");
  const clicked = await cdp.evaluate(`(() => {
    const cells = [...document.querySelectorAll('.cell-btn')];
    const target = cells.find((cell) => cell.textContent.includes('01:00'));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert(clicked, "timesheet cell clicked");
  await cdp.waitFor("document.body.innerText.includes('Add entry')", { label: "cell dialog" });
  assert((await cdp.text()).includes("Manual review edited"), "cell dialog lists underlying entry");
  await cdp.click("Close", dialog);
  console.log("PASS timesheet cell editor");

  await cdp.click("Reports");
  await cdp.waitFor("document.body.innerText.includes('Detailed entries')");
  const projectId = await cdp.evaluate(`(() => {
    const select = document.querySelector('select[aria-label="Project filter"]');
    const option = [...select.options].find((o) => o.textContent.includes('Project Alpha'));
    return option?.value ?? null;
  })()`);
  assert(projectId, "project filter option exists");
  await cdp.select('select[aria-label="Project filter"]', projectId);
  await cdp.waitFor("!document.body.innerText.includes('Calculating report')");
  await wait(700);
  const filteredText = await cdp.text();
  assert(filteredText.includes('Build API'), "project report shows Alpha entry");
  assert(!filteredText.includes('Manual review edited'), "project report excludes other entries");
  const today = (await invoke("get_app_status", { timezone: "America/Chicago" })).todayDate;
  const filtered = await invoke("get_report", {
    filter: { dateFrom: today, dateTo: today, timezone: "America/Chicago", projectId },
  });
  assert(filtered.totalSeconds === 3, "project filter total is 3s");
  console.log("PASS report project filter");

  await cdp.screenshot("docs/screenshots/report-filtered.png");

  await cdp.click("Settings");
  await cdp.waitFor("document.body.innerText.includes('Start of week')");
  await cdp.select('select[aria-label="Start of week"]', "sunday");
  await wait(500);
  assert((await invoke("get_settings")).startOfWeek === "sunday", "start of week persisted");
  await cdp.click("Timesheet");
  await cdp.waitFor("document.body.innerText.includes('Week starts Sunday')");
  const firstDay = await cdp.evaluate("document.querySelector('.sheet thead th:nth-child(2)')?.innerText");
  assert(firstDay.includes("Sun"), "timesheet starts Sunday");
  await cdp.click("Settings");
  await cdp.select('select[aria-label="Start of week"]', "monday");
  await wait(400);
  console.log("PASS start-of-week preference");

  const trayInfo = await invoke("get_platform_info");
  assert(trayInfo.trayAvailable, "tray active");

  await invoke("update_settings", { patch: { launchAtLogin: true } });
  await wait(800);
  const readRunKey = () => {
    try {
      return execFileSync(
        "reg",
        ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"],
        { encoding: "utf8" },
      );
    } catch {
      return "";
    }
  };
  assert(readRunKey().toLowerCase().includes("tempodesk"), "autostart registry entry created");
  await invoke("update_settings", { patch: { launchAtLogin: false } });
  await wait(800);
  assert(!readRunKey().toLowerCase().includes("tempodesk"), "autostart registry entry removed");
  console.log("PASS launch-at-login sync");

  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('History')");
  console.log("Settings/feature checks passed");
} finally {
  cdp.close();
}
