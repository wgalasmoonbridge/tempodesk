import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const dialog = "document.querySelector('[role=dialog]')";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('Manual review')");

  await cdp.clickAria("Edit “Manual review”");
  await cdp.waitFor("document.body.innerText.includes('Edit time entry')");
  await cdp.type('[role=dialog] input[data-autofocus]', "Manual review edited");
  await cdp.click("Save changes", dialog);
  await cdp.waitFor("document.body.innerText.includes('Manual review edited')");
  console.log("PASS edit entry");

  await cdp.clickAria("Delete “Manual review edited”");
  await cdp.waitFor("document.body.innerText.includes('Delete this time entry?')");
  await cdp.click("Delete entry", dialog);
  await cdp.waitFor("document.body.innerText.includes('Entry deleted')");
  await wait(400);
  assert(!(await cdp.evaluate("document.body.innerText.includes('Manual review edited')")), "entry removed from history");
  await cdp.click("Undo");
  await cdp.waitFor("document.body.innerText.includes('Manual review edited')");
  console.log("PASS delete + undo");

  await cdp.click("Manual entry");
  await cdp.waitFor("document.body.innerText.includes('Add manual entry')");
  await cdp.type('[role=dialog] input[data-autofocus]', "Overnight test");
  await cdp.typeAt('[role=dialog] input[type=date]', 0, "2026-10-27");
  await cdp.typeAt('[role=dialog] input[type=time]', 0, "23:30");
  await cdp.typeAt('[role=dialog] input[type=time]', 1, "00:30");
  await cdp.click("Add entry", dialog);
  await cdp.waitFor("document.body.innerText.includes('Ends next day')", { label: "overnight prompt" });
  await cdp.evaluate(`(() => {
    const dialog = document.querySelector('[role=dialog]');
    const label = [...dialog.querySelectorAll('label')].find((l) => l.textContent.includes('Ends next day'));
    label.querySelector('input').click();
    return true;
  })()`);
  await wait(200);
  await cdp.click("Add entry", dialog);
  await cdp.waitFor("document.body.innerText.includes('Overnight test')", { label: "overnight entry saved" });
  const entries = await cdp.evaluate("window.__TAURI_INTERNALS__.invoke('list_entries', { filter: { timezone: 'America/Chicago', limit: 50 } })");
  const overnight = entries.find((entry) => entry.description === "Overnight test");
  assert(overnight && overnight.durationSeconds === 3600, "overnight entry is one hour");
  console.log("PASS overnight validation and save");

  await cdp.click("Settings");
  await cdp.waitFor("document.body.innerText.includes('Appearance')");
  await cdp.click("Appearance");
  await cdp.waitFor("document.body.innerText.includes('Theme')");
  await cdp.click("Dark");
  await wait(400);
  assert((await cdp.evaluate("document.documentElement.dataset.theme")) === "dark", "dark theme applied");
  await cdp.screenshot("docs/screenshots/dark-settings.png");
  await cdp.click("Light");
  await wait(300);
  assert((await cdp.evaluate("document.documentElement.dataset.theme")) === "light", "light theme applied");
  await cdp.click("System");
  console.log("PASS theme override");
} finally {
  cdp.close();
}
