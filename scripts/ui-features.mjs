// Exercises timesheet/report rendering, IPC data portability and captures screenshots.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, connect } from "./cdp-lib.mjs";

const cdp = await connect();
const dialog = "document.querySelector('[role=dialog]')";
const temp = mkdtempSync(join(tmpdir(), "tempodesk-ui-"));
const backupPath = join(temp, "backup.json").replaceAll("\\", "\\\\");
const csvPath = join(temp, "report.csv").replaceAll("\\", "\\\\");

const invoke = (command, args) =>
  cdp.evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
  );

try {
  await cdp.click("Timesheet");
  await cdp.waitFor("document.body.innerText.includes('Week starts')", { label: "timesheet" });
  const sheet = await cdp.text();
  assert(sheet.includes("Project Alpha"), "timesheet shows project");
  assert(sheet.includes("Build API"), "timesheet shows task description");
  await cdp.screenshot("docs/screenshots/timesheet.png");
  console.log("PASS timesheet rendering");

  await cdp.click("Reports");
  await cdp.waitFor("document.body.innerText.includes('Detailed entries')", { label: "reports" });
  await cdp.waitFor("!document.body.innerText.includes('Calculating report')");
  const reports = await cdp.text();
  assert(reports.includes("Build API"), "report has timed entry");
  assert(reports.includes("Manual review"), "report has manual entry");
  await cdp.screenshot("docs/screenshots/reports.png");
  console.log("PASS reports rendering");

  const today = await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('get_app_status', { timezone: 'America/Chicago' }).then(s => s.todayDate)`);
  const report = await invoke("get_report", {
    filter: {
      dateFrom: today,
      dateTo: today,
      timezone: "America/Chicago",
    },
  });
  assert(report.totalSeconds > 3600, "report total includes both entries");
  assert(
    report.totalSeconds ===
      report.daily.reduce((sum, day) => sum + day.seconds, 0),
    "report total equals daily allocation",
  );
  console.log("PASS report math via IPC", report.totalSeconds, "seconds");

  const backup = await invoke("save_backup", { destination: backupPath.replaceAll("\\\\", "\\") });
  assert(backup.counts.entries >= 2, "backup counted entries");
  const preview = await invoke("preview_restore", { source: backupPath.replaceAll("\\\\", "\\") });
  assert(preview.counts.entries === backup.counts.entries, "preview counts match backup");
  console.log("PASS backup + preview", preview.counts.entries, "entries");

  const exportResult = await invoke("export_report_csv", {
    filter: {
      dateFrom: today,
      dateTo: today,
      timezone: "America/Chicago",
    },
    destination: csvPath.replaceAll("\\\\", "\\"),
  });
  assert(exportResult.rowCount > 0, "csv exported rows");
  assert(exportResult.totalSeconds === report.totalSeconds, "csv total matches report");
  const csv = readFileSync(csvPath, "utf8");
  assert(csv.startsWith("Entry ID,Description,Project,Client,Tags,Billable"), "csv header");
  assert(csv.split("\r\n").filter(Boolean).length === exportResult.rowCount + 1, "csv row count");
  console.log("PASS CSV export", exportResult.rowCount, "rows");

  // Destructive change then restore through the same IPC used by the UI.
  const entries = await invoke("list_entries", {
    filter: { timezone: "America/Chicago", limit: 50 },
  });
  const manual = entries.find((entry) => entry.description === "Manual review");
  assert(manual, "manual entry exists before delete");
  await invoke("delete_entry", { id: manual.id });
  let afterDelete = await invoke("list_entries", {
    filter: { timezone: "America/Chicago", limit: 50, includeDeleted: true },
  });
  assert(
    afterDelete.filter((entry) => !entry.deletedAtUtc).length === entries.length - 1,
    "entry soft-deleted",
  );
  const restored = await invoke("restore_backup", { source: backupPath.replaceAll("\\\\", "\\") });
  assert(restored.counts.entries === backup.counts.entries, "restored entry count");
  afterDelete = await invoke("list_entries", {
    filter: { timezone: "America/Chicago", limit: 50 },
  });
  assert(
    afterDelete.some((entry) => entry.description === "Manual review"),
    "restore recovered deleted entry",
  );
  const restoredReport = await invoke("get_report", {
    filter: {
      dateFrom: today,
      dateTo: today,
      timezone: "America/Chicago",
    },
  });
  assert(
    restoredReport.totalSeconds === report.totalSeconds,
    "restored report matches pre-backup totals",
  );
  console.log("PASS restore via IPC");

  await cdp.click("Settings");
  await cdp.waitFor("document.body.innerText.includes('Start of week')", { label: "settings" });
  await cdp.screenshot("docs/screenshots/settings-general.png");
  console.log("PASS settings rendering");

  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('History')");
  await cdp.screenshot("docs/screenshots/tracker-final.png");
  console.log("UI feature checks passed");
} finally {
  cdp.close();
}
