import { execFileSync } from "node:child_process";
import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (c, a) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await invoke("update_settings", { patch: { closeToTray: false } });
  const handle = execFileSync("powershell", ["-NoProfile", "-Command",
    "(Get-Process tempodesk | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1).MainWindowHandle.ToInt64()"], { encoding: "utf8" }).trim();
  execFileSync("powershell", ["-NoProfile", "-Command", `
    Add-Type @'
using System; using System.Runtime.InteropServices;
public class PM { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l); }
'@
    [PM]::PostMessage([IntPtr]${handle}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  `]);
  await wait(1200);
  await cdp.waitFor("document.body.innerText.includes('Quit TempoDesk?')", { label: "quit dialog after window close" });
  assert((await cdp.text()).includes("close"), "dialog explains close policy");
  await cdp.screenshot("docs/screenshots/quit-dialog.png");
  await cdp.click("Cancel");
  await cdp.waitFor("!document.body.innerText.includes('Quit TempoDesk?')");
  await invoke("update_settings", { patch: { closeToTray: true } });
  console.log("PASS close-to-tray off shows quit confirmation");
} finally {
  cdp.close();
}
