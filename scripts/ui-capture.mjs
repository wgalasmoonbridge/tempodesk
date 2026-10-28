import { connect } from "./cdp-lib.mjs";
const cdp = await connect();
const shots = [
  ["Time Tracker", "tracker-final.png", "Time Tracker"],
  ["Timesheet", "timesheet.png", "Timesheet"],
  ["Reports", "reports.png", "Detailed entries"],
  ["Projects", "projects.png", "New project"],
  ["Clients", "clients.png", "New client"],
  ["Tags", "tags.png", "New tag"],
  ["Settings", "settings-general.png", "Start of week"],
];
for (const [nav, file, wait] of shots) {
  await cdp.click(nav);
  await cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(wait)})`, { label: nav });
  await new Promise((r) => setTimeout(r, 500));
  await cdp.screenshot(`docs/screenshots/${file}`);
  console.log("captured", file);
}
await cdp.click("Time Tracker");
await cdp.waitFor("document.body.innerText.includes('History')");
const errors = await cdp.evaluate("[...document.querySelectorAll('[role=alert]')].map(n=>n.innerText)");
console.log("visible errors:", errors);
const toasts = await cdp.evaluate("[...document.querySelectorAll('.toast')].map(n=>n.innerText)");
console.log("toast count:", toasts.length);
cdp.close();
