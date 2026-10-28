import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
await cdp.waitFor("!!document.querySelector('.content')", { label: "app" });
await cdp.click("Reports");
await cdp.waitFor("document.body.innerText.includes('Detailed entries')", { label: "reports", timeout: 12000 });
await new Promise(r=>setTimeout(r,800));
const metrics = await cdp.evaluate(`(() => {
  const c = document.querySelector('.content');
  const app = document.querySelector('.app');
  const before = c.scrollTop;
  c.scrollTop = 250;
  return {
    viewport: [innerWidth, innerHeight],
    app: { clientH: app.clientHeight, scrollH: app.scrollHeight },
    content: { clientH: c.clientHeight, scrollH: c.scrollHeight, before, after: c.scrollTop, max: c.scrollHeight - c.clientHeight },
  };
})()`);
console.log(metrics);
assert(metrics.app.scrollH === metrics.app.clientH, "app is constrained to viewport");
assert(metrics.content.scrollH > metrics.content.clientH, "content is taller than viewport");
assert(metrics.content.after > 0, "content scrolls");
await cdp.screenshot("docs/screenshots/scroll-fixed.png");
await cdp.evaluate("setTimeout(() => window.__TAURI_INTERNALS__.invoke('quit_app', { stopTimer: false }), 50); true");
console.log("PASS installed app vertical scrolling");
cdp.close();
