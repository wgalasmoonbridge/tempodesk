import { connect } from "./cdp-lib.mjs";
const cdp = await connect();
const running = await cdp.evaluate("document.body.innerText.includes('Tracking')");
if (!running) {
  await cdp.type("#timer-description", "Crash recovery test");
  await cdp.click("Start");
  await cdp.waitFor("document.body.innerText.includes('Tracking')");
}
console.log("timer running; waiting 20s for heartbeat");
await new Promise((r) => setTimeout(r, 20000));
cdp.close();
