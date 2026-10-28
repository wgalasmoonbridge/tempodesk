import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (command, args) =>
  cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
try {
  await cdp.waitFor("typeof window.__TAURI_INTERNALS__?.invoke === 'function'", { label: "Tauri IPC" });
  await invoke("update_settings", { patch: { idleTrackingEnabled: true, idleThresholdMinutes: 1 } });
  await cdp.click("Time Tracker");
  await cdp.waitFor("!!document.querySelector('#timer-description')");
  const running = await cdp.evaluate("document.body.innerText.includes('Tracking')");
  if (!running) {
    await cdp.type("#timer-description", "Idle review test");
    await cdp.click("Start");
    await cdp.waitFor("document.body.innerText.includes('Tracking')");
  }
  let found = false;
  for (let i = 0; i < 40; i += 1) {
    if (await cdp.evaluate("document.body.innerText.includes('Idle time needs your review')")) {
      found = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert(found, "idle review banner appeared");
  await cdp.screenshot("docs/screenshots/idle-review.png");
  await cdp.click("Remove idle gap");
  await cdp.waitFor("document.body.innerText.includes('Idle gap removed')", { label: "idle toast" });
  await cdp.waitFor("document.body.innerText.includes('Tracking')", { label: "timer still running" });
  const entries = await invoke("list_entries", { filter: { timezone: "America/Chicago", limit: 50 } });
  const idleAdjusted = entries.filter((entry) => entry.source === "idle_adjustment");
  assert(idleAdjusted.length >= 1, "idle-adjusted segment saved");
  assert(entries.some((entry) => entry.running), "new running segment exists");
  await invoke("update_settings", { patch: { idleTrackingEnabled: false } });
  // Leave a clean state: stop the test timer and clear any queued episode review.
  await invoke("stop_timer");
  const pending = await invoke("get_pending_idle_reviews");
  for (const review of pending) {
    await invoke("resolve_idle_review", { reviewId: review.id, action: "keep" });
  }
  console.log("PASS idle detection + explicit review");
} finally {
  cdp.close();
}
