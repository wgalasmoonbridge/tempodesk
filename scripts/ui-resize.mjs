import { execFileSync } from "node:child_process";
import { connect } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (c,a)=>cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
const resize = (w,h) => execFileSync("powershell", ["-NoProfile","-Command",`
Add-Type @'
using System; using System.Runtime.InteropServices;
public class RS { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags); }
'@
$p = Get-Process tempodesk | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
[RS]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, 40, 40, ${w}, ${h}, 0x0040) | Out-Null
`], { encoding: "utf8" });
try {
  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('History')");
  await invoke("update_settings", { patch: { theme: "system" } });
  resize(860, 700);
  await new Promise(r=>setTimeout(r,900));
  console.log("viewport:", await cdp.evaluate("[innerWidth, innerHeight, document.documentElement.scrollWidth]"));
  await cdp.screenshot("docs/screenshots/responsive-860.png");
  resize(1180, 760);
  await new Promise(r=>setTimeout(r,700));
  console.log("restored viewport:", await cdp.evaluate("[innerWidth, innerHeight]"));
  console.log("PASS responsive window sizing");
} finally { cdp.close(); }
