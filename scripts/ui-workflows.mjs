// End-to-end verification against an isolated test profile only.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { connect, assert } from "./cdp-lib.mjs";

const cdp = await connect();
const invoke = (command, args = {}) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
const dialog = "document.querySelector('[role=dialog]')";
const suffix = String(Date.now()).slice(-7);

try {
  assert(cdp.platformInfo.dataProfile === "test", "workflow verification requires a test profile");
  await invoke("update_settings", { patch: { onboardingComplete: true } });
  await cdp.waitFor("!document.querySelector('[role=dialog]')", { label: "onboarding dismissed" });
  if ((await invoke("get_app_status", { timezone: "UTC" })).activeEntry) await invoke("stop_timer");
  const project = await invoke("save_project", { input: { name: `Workflow project ${suffix}`, color: "#4f46e5", defaultBillable: true } });
  const tag = await invoke("save_tag", { input: { name: `Focus ${suffix}` } });
  await cdp.click("Time Tracker");
  await cdp.click("New template");
  await cdp.type('[aria-label="Template name"]', `Coding ${suffix}`, dialog);
  await cdp.type('[aria-label="Template description"]', `Build workflow ${suffix}`, dialog);
  await cdp.select('[aria-label="Template project"]', project.id, dialog);
  await cdp.click(tag.name, dialog);
  await cdp.click("Save template", dialog);
  await cdp.waitFor(`!![...document.querySelectorAll('.template-item button')].find(el => el.textContent.trim() === ${JSON.stringify(`Coding ${suffix}`)})`, { label: "saved template" });
  let template = (await invoke("list_templates")).find((item) => item.name === `Coding ${suffix}`);
  assert(template.projectId === project.id && template.isBillable && template.tagIds.includes(tag.id), "template metadata saved");
  await cdp.click(template.name);
  await cdp.waitFor("!!document.querySelector('.running-card, .timer-card .running-timer')", { label: "template timer" });
  const active = (await invoke("get_app_status", { timezone: "UTC" })).activeEntry;
  assert(active.description === template.description && active.projectId === project.id && active.tags[0].id === tag.id, "template starts real timer with metadata");
  await cdp.click(template.name);
  await cdp.waitFor("document.body.innerText.includes('Switch to saved task?')");
  await cdp.click("Switch task", dialog);
  await cdp.waitFor("!document.querySelector('[role=dialog]')");
  assert((await invoke("get_app_status", { timezone: "UTC" })).activeEntry.id !== active.id, "confirmed switch starts a new session");
  await cdp.click("Stop");
  await cdp.clickAria(`Edit template ${template.name}`);
  await cdp.type('[aria-label="Template name"]', `Development ${suffix}`, dialog);
  await cdp.click("Save template", dialog);
  await cdp.waitFor(`document.querySelector('.template-panel').innerText.includes(${JSON.stringify(`Development ${suffix}`)})`);
  template = (await invoke("list_templates")).find((item) => item.id === template.id);
  assert(template.name === `Development ${suffix}`, "template edits persisted");
  console.log("PASS templates: create, start, switch confirmation, edit");

  const now = Math.floor(Date.now() / 1000) * 1000;
  const fixtures = [];
  for (let index = 0; index < 2; index += 1) fixtures.push((await invoke("create_manual_entry", { input: {
    description: `Workflow bulk ${index} ${suffix}`, projectId: null, tagIds: [], isBillable: false,
    startAtUtc: now - (index + 2) * 3600000, endAtUtc: now - (index + 2) * 3600000 + 600000,
  } })).entry);
  await cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(fixtures[0].description)})`);
  await cdp.click("Select");
  for (const entry of fixtures) await cdp.clickAria(`Select ${entry.description}`);
  await cdp.click("Edit selected");
  await cdp.select('[aria-label="Bulk project"]', project.id, dialog);
  await cdp.select('[aria-label="Bulk billable status"]', "yes", dialog);
  await cdp.select('[aria-label="Bulk tag operation"]', "add", dialog);
  await cdp.click(tag.name, dialog);
  await cdp.screenshot("docs/screenshots/bulk-edit.png");
  await cdp.click("Apply changes", dialog);
  await cdp.waitFor("document.body.innerText.includes('2 entries updated')");
  let entries = await invoke("list_entries", { filter: { limit: 100 } });
  for (const fixture of fixtures) {
    const saved = entries.find((item) => item.id === fixture.id);
    assert(saved.isBillable && saved.projectId === project.id && saved.tags[0].id === tag.id, "bulk edit applies selected metadata");
    assert(saved.startAtUtc === fixture.startAtUtc && saved.endAtUtc === fixture.endAtUtc, "bulk edit preserves interval");
  }
  await cdp.click("Undo");
  await cdp.waitFor("document.body.innerText.includes('2 entries reverted')");
  entries = await invoke("list_entries", { filter: { limit: 100 } });
  assert(fixtures.every((fixture) => { const restored = entries.find((item) => item.id === fixture.id); return !restored.isBillable && restored.projectId === null && restored.tags.length === 0; }), "bulk undo restores original values");
  console.log("PASS bulk metadata editing and undo");

  await cdp.click("Settings");
  await cdp.click("Data & backup");
  await cdp.clickAria("Automatic local backups");
  await cdp.waitFor("document.querySelector('[aria-label=\"Automatic local backups\"]').getAttribute('aria-checked') === 'true'");
  await cdp.waitFor("document.querySelector('.auto-backup-panel').innerText.includes('tempodesk-auto-')");
  let backupStatus = await invoke("get_auto_backup_status");
  assert(existsSync(backupStatus.lastBackupPath), "automatic backup exists");
  const document = JSON.parse(readFileSync(backupStatus.lastBackupPath, "utf8"));
  assert(document.version === 2 && document.templates.some((item) => item.id === template.id), "backup contains saved task template");
  await cdp.select('[aria-label="Automatic backup retention"]', "1");
  await cdp.waitFor("!document.querySelector('[aria-label=\"Automatic backup retention\"]').disabled");
  await cdp.click("Back up now");
  await cdp.waitFor("document.body.innerText.includes('Automatic backup saved')");
  backupStatus = await invoke("get_auto_backup_status");
  assert(readdirSync(backupStatus.directory).filter((name) => name.startsWith("tempodesk-auto-") && name.endsWith(".json")).length === 1, "retention keeps configured count");
  await cdp.screenshot("docs/screenshots/automatic-backups.png");
  await invoke("update_settings", { patch: { autoBackupEnabled: false } });
  // Restore from a real auto backup and verify template survival and scheduling remains off.
  await invoke("delete_template", { id: template.id });
  await invoke("restore_backup", { source: backupStatus.lastBackupPath });
  assert((await invoke("list_templates")).some((item) => item.id === template.id), "restore recovers saved task template");
  assert(!(await invoke("get_settings")).autoBackupEnabled, "restore disables device-specific scheduling");
  console.log("PASS automatic backups: enable, write, retention, template restore");

  // 1,005 actual entries exercise pagination and remove the old 1,000-entry total cap.
  const commands = Array.from({ length: 1005 }, (_, index) => ({
    description: `Pagination ${suffix} ${index}`, projectId: null, tagIds: [], isBillable: false,
    startAtUtc: now - 1000000, endAtUtc: now - 940000,
  }));
  await cdp.evaluate(`(async () => { for (const input of ${JSON.stringify(commands)}) await window.__TAURI_INTERNALS__.invoke('create_manual_entry', { input }); return true; })()`);
  await cdp.click("Time Tracker");
  await cdp.select("#history-range", "all");
  const page = await invoke("list_entry_page", { filter: { search: `Pagination ${suffix}`, limit: 100, offset: 1000 } });
  assert(page.totalCount === 1005 && page.totalSeconds === 60300 && page.entries.length === 5, "complete totals and last page beyond 1,000 entries");
  await cdp.waitFor("document.querySelector('.history-pagination').innerText.includes('Showing 1–100')");
  const before = await cdp.evaluate("[...document.querySelectorAll('.entry-title')].map(el => el.textContent)");
  await cdp.click("Next page");
  await cdp.waitFor("document.querySelector('.history-pagination').innerText.includes('Showing 101–200')");
  const after = await cdp.evaluate("[...document.querySelectorAll('.entry-title')].map(el => el.textContent)");
  assert(JSON.stringify(before) !== JSON.stringify(after), "next page displays different entries");
  await cdp.click("Previous page");
  await cdp.waitFor("document.querySelector('.history-pagination').innerText.includes('Showing 1–100')");
  await cdp.screenshot("docs/screenshots/templates-history.png");
  console.log("PASS history pagination and complete filtered totals");
  await cdp.clickAria(`Delete template ${template.name}`);
  await cdp.click("Delete template", dialog);
  await cdp.waitFor(`!document.querySelector('.template-panel').innerText.includes(${JSON.stringify(template.name)})`);
  assert(!(await invoke("list_templates")).some((item) => item.id === template.id), "template deletion persists");
  console.log("All workflow UI checks passed");
} finally { cdp.close(); }
