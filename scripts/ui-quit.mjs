import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (c, a) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
try {
  const status = await invoke("get_app_status", { timezone: "America/Chicago" });
  if (status.activeEntry) await invoke("stop_timer");
  await cdp.type("#timer-description", "Quit stop test");
  await cdp.click("Start");
  await cdp.waitFor("document.body.innerText.includes('Tracking')");
  await new Promise((r) => setTimeout(r, 1500));
  await invoke("quit_app", { stopTimer: true });
  console.log("quit requested with stop");
} finally {
  cdp.close();
}
