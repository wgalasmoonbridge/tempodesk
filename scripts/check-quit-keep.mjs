import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (c, a) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
try {
  const body = await cdp.text();
  assert(body.includes("Recover a timer from your last session"), "recovery prompt for kept timer");
  assert(body.includes("Quit keep test"), "kept timer metadata shown");
  const status = await invoke("get_app_status", { timezone: "America/Chicago" });
  assert(status.pendingRecovery?.reason === "running_at_launch", "reason is running_at_launch");
  await cdp.click("Continue timing");
  await cdp.waitFor("!document.body.innerText.includes('Recover a timer from your last session')");
  const after = await invoke("get_app_status", { timezone: "America/Chicago" });
  assert(after.activeEntry?.description === "Quit keep test", "timer continues after restart");
  await invoke("stop_timer");
  console.log("PASS keep-running quit recovers and continues the timer");
} finally {
  cdp.close();
}
