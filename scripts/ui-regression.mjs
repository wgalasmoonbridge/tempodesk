import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const dialog = "document.querySelector('[role=dialog]')";
const invoke = (c,a)=>cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
try {
  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('Build API')");
  await cdp.clickAria("Edit “Build API”");
  await cdp.waitFor("document.body.innerText.includes('Edit time entry')");
  await cdp.type('[role=dialog] input[data-autofocus]', "Build API tagged");
  await cdp.click("Save changes", dialog);
  await cdp.waitFor("!document.querySelector('[role=dialog]')", { label: "edit dialog closed" });
  await cdp.waitFor("document.body.innerText.includes('Build API tagged')");
  const entries = await invoke("list_entries",{filter:{timezone:"America/Chicago",limit:50}});
  const entry = entries.find((e)=>e.description==="Build API tagged");
  assert(entry, "edited entry exists");
  assert(entry.tags.length === 1 && entry.tags[0].name === "Deep Work", "soft-deleted tag association preserved");
  console.log("PASS editing after tag deletion keeps historical tag");

  await cdp.type("#timer-description","Regression timer");
  await cdp.click("Start");
  await cdp.waitFor("document.body.innerText.includes('Tracking')");
  await new Promise(r=>setTimeout(r,1200));
  await cdp.click("Stop");
  await cdp.waitFor("document.body.innerText.includes('Timer stopped')", { label: "stop toast" });
  const after = await invoke("get_app_status",{timezone:"America/Chicago"});
  assert(!after.activeEntry, "timer stopped cleanly");
  assert(!(await cdp.evaluate("document.body.innerText.includes('Could not stop')")), "no stop error");
  console.log("PASS start/stop regression");
} finally { cdp.close(); }
