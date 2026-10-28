import { connect } from "./cdp-lib.mjs";
const cdp = await connect();
await cdp.evaluate("setTimeout(() => window.__TAURI_INTERNALS__.invoke('quit_app', { stopTimer: false }), 50); true");
console.log("quit requested");
await new Promise((r) => setTimeout(r, 400));
cdp.close();
