import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (c,a)=>cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
try {
  const status = await invoke("get_app_status",{timezone:"America/Chicago"});
  console.log("active:", status.activeEntry?.description, "elapsed:", Math.round((status.serverNowUtc-status.activeEntry.startAtUtc)/1000));
  assert(status.activeEntry?.description === "Hidden timer test", "timer survived hidden period");
  assert((status.serverNowUtc-status.activeEntry.startAtUtc)/1000 > 10, "elapsed accumulated while hidden");
  await invoke("stop_timer");
  console.log("PASS hidden timer + restore");
} finally { cdp.close(); }
