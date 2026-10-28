import { execFileSync, spawn } from "node:child_process";
import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (c,a)=>cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
const wait = (ms)=>new Promise(r=>setTimeout(r,ms));
try {
  const status0 = await invoke("get_app_status",{timezone:"America/Chicago"});
  if (status0.activeEntry) await invoke("stop_timer");
  await cdp.click("Time Tracker");
  await cdp.waitFor("!!document.querySelector('#timer-description')");
  await cdp.type("#timer-description","Hidden timer test");
  await cdp.click("Start");
  await cdp.waitFor("document.body.innerText.includes('Tracking')");
  const started = await invoke("get_app_status",{timezone:"America/Chicago"});
  assert(started.activeEntry, "timer active before hide");
  const handle = execFileSync("powershell",["-NoProfile","-Command","(Get-Process tempodesk | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1).MainWindowHandle.ToInt64()"],{encoding:"utf8"}).trim();
  execFileSync("powershell",["-NoProfile","-Command",`
Add-Type @'
using System; using System.Runtime.InteropServices;
public class HideP { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); }
'@
[HideP]::PostMessage([IntPtr]${handle}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Start-Sleep -Seconds 1
Write-Output ('visible=' + [HideP]::IsWindowVisible([IntPtr]${handle}))
`],{encoding:"utf8"});
  await wait(5000);
  const during = await invoke("get_app_status",{timezone:"America/Chicago"});
  assert(during.activeEntry?.id === started.activeEntry.id, "timer still active while hidden");
  const second = spawn(process.cwd() + "/src-tauri/target/debug/tempodesk.exe", [], { detached: true, stdio: "ignore" });
  second.unref();
  await wait(3000);
  const after = await invoke("get_app_status",{timezone:"America/Chicago"});
  assert(after.activeEntry?.id === started.activeEntry.id, "same timer after restore");
  const elapsedBefore = (started.serverNowUtc - started.activeEntry.startAtUtc)/1000;
  const elapsedAfter = (after.serverNowUtc - after.activeEntry.startAtUtc)/1000;
  assert(elapsedAfter > elapsedBefore + 4, "elapsed increased while hidden");
  await invoke("stop_timer");
  console.log("PASS timer continues while window hidden, elapsed increases, single instance restores window");
} finally { cdp.close(); }
