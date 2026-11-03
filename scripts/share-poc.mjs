// Standalone generated-data demonstration. No path to an installed TempoDesk database is accepted.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const localOnly = args.includes("--local-only");
const verify = args.includes("--verify");
const ttlIndex = args.indexOf("--ttl-seconds");
const ttl = ttlIndex < 0 ? 3600 : Number(args[ttlIndex + 1]);
if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) throw new Error("Demo duration must be 60–3,600 seconds");
const executable = join(workspace, "sharing-poc", "target", "debug", process.platform === "win32" ? "tempodesk-sharing-poc.exe" : "tempodesk-sharing-poc");
if (!existsSync(executable)) throw new Error("Build the prototype first: npm run share:poc:build");
const runDir = join(workspace, ".test-data", `sharing-${Date.now()}`);
mkdirSync(runDir, {recursive:true});
let server;
let tunnel;
let edge;
let cleaning = false;
let publicOrigin;
let ready;
let sequence = 0;
const pending = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withTimeout = (promise, ms, message) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(message)), ms);})]).finally(() => clearTimeout(timer));
};
const assert = (value, message) => { if (!value) throw new Error(message); };

function control(action) {
  const id = ++sequence;
  return withTimeout(new Promise((resolve, reject) => {
    pending.set(id, {resolve,reject});
    server.stdin.write(`${JSON.stringify({id,action})}\n`);
  }), 5000, `Control timed out: ${action}`);
}

function shareUrl() {
  const local = new URL(ready.url);
  return publicOrigin ? `${publicOrigin}${local.pathname}` : ready.url;
}

function saveState(extra = {}) {
  writeFileSync(join(runDir,"state.json"), JSON.stringify({demo:true,launcherPid:process.pid,serverPid:server?.pid,tunnelPid:tunnel?.pid,
    localUrl:ready?.url,publicUrl:publicOrigin ? shareUrl() : null,expiresAtUtc:ready?.expiresAtUtc,...extra},null,2));
}

async function cloudflared() {
  if (process.env.CLOUDFLARED_PATH) return resolve(process.env.CLOUDFLARED_PATH);
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Set CLOUDFLARED_PATH to a verified cloudflared executable, or use --local-only");
  const response = await fetch("https://api.github.com/repos/cloudflare/cloudflared/releases/latest", {headers:{"User-Agent":"TempoDesk-sharing-poc"},signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Cannot obtain cloudflared release metadata (${response.status})`);
  const release = await response.json();
  assert(/^v?\d{4}\.\d+\.\d+$/.test(release.tag_name),"Unexpected cloudflared release tag");
  const asset = release.assets.find((asset) => asset.name === "cloudflared-windows-amd64.exe");
  const digest = asset?.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
  assert(digest,"Official release did not supply an asset checksum; refusing an unchecked binary");
  const binary = join(workspace,".test-data","tools",`cloudflared-${release.tag_name}.exe`);
  const check = (bytes) => createHash("sha256").update(bytes).digest("hex") === digest;
  if (!existsSync(binary) || !check(readFileSync(binary))) {
    const url = new URL(asset.browser_download_url);
    assert(url.hostname === "github.com" && url.pathname.startsWith("/cloudflare/cloudflared/releases/download/"),"Unexpected download source");
    const download = await fetch(url,{signal:AbortSignal.timeout(180000)});
    if (!download.ok) throw new Error(`Cannot download cloudflared (${download.status})`);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert(check(bytes),"cloudflared checksum mismatch");
    mkdirSync(join(workspace,".test-data","tools"),{recursive:true});
    writeFileSync(binary,bytes);
  }
  console.log(`Verified official cloudflared ${release.tag_name} (SHA-256 checked).`);
  return binary;
}

async function start() {
  const serverArgs = ["--ttl-seconds",String(ttl)];
  if (args.includes("--include-descriptions")) serverArgs.push("--include-descriptions");
  if (args.includes("--include-billable")) serverArgs.push("--include-billable");
  server = spawn(executable,serverArgs,{cwd:workspace,stdio:["pipe","pipe","pipe"],windowsHide:true});
  server.stderr.on("data",(bytes) => writeFileSync(join(runDir,"server.log"),bytes,{flag:"a"}));
  const started = new Promise((resolve,reject) => {
    server.once("error",reject);
    server.once("exit",(code) => {reject(new Error(`Demo server exited (${code})`)); if (!cleaning) void cleanup();});
    createInterface({input:server.stdout}).on("line",(line) => {
      let event;
      try {event = JSON.parse(line);} catch {return;}
      if (event.event === "ready") {ready = event;resolve(event);}
      if (event.event === "control") { const callback = pending.get(event.id); if (callback) {pending.delete(event.id); event.ok ? callback.resolve(event) : callback.reject(new Error("Owner command failed"));} }
    });
  });
  await withTimeout(started,15000,"Demo server did not start");
  assert(ready.demo === true && new URL(ready.origin).hostname === "127.0.0.1","Demo must bind to loopback");
  if (!localOnly) {
    const binary = await cloudflared();
    publicOrigin = await withTimeout(new Promise((resolve,reject) => {
      tunnel = spawn(binary,["tunnel","--url",ready.origin,"--no-autoupdate","--protocol","http2","--metrics","127.0.0.1:0"],{cwd:runDir,stdio:["ignore","pipe","pipe"],windowsHide:true});
      tunnel.once("error",reject);
      tunnel.once("exit",(code) => {if (!cleaning) { reject(new Error(`Tunnel exited (${code})`)); console.error("The temporary tunnel stopped; the shared link is offline."); }});
      const line = (bytes) => {
        const output = bytes.toString();
        writeFileSync(join(runDir,"tunnel.log"),output,{flag:"a"});
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) resolve(match[0]);
      };
      tunnel.stdout.on("data",line);tunnel.stderr.on("data",line);
    }),60000,"Cloudflare did not issue a temporary URL");
  }
  saveState();
  console.log(localOnly ? "Checking local report readiness…" : "Waiting for the temporary tunnel and DNS to become reachable…");
  await available(shareUrl());
  console.log("Generated demo records only. No installed-app database is opened.");
  console.log(`Share link: ${shareUrl()}`);
  console.log(`Expires: ${new Date(ready.expiresAtUtc).toISOString()}`);
  console.log(`Run state: ${join(runDir,"state.json")}`);
}

async function fetchReport(url, expected = 200) {
  const response = await fetch(`${url}data.json`,{signal:AbortSignal.timeout(15000)});
  assert(response.status === expected,`Expected HTTP ${expected}, received ${response.status}`);
  const body = await response.text();
  assert(!body.includes("PRIVATE_BETA_CANARY_7492"),"A different client's record leaked");
  return expected === 200 ? JSON.parse(body) : null;
}

async function available(url) {
  let error;
  const deadline = Date.now() + 180000;
  let nextNotice = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {return await fetchReport(url);} catch (failure) {
      error = failure;
      if (Date.now() >= nextNotice) {
        console.log(`Still waiting for the demo link (${failure.cause?.code ?? failure.message}).`);
        nextNotice = Date.now() + 30000;
      }
      await wait(2000);
    }
  }
  throw error;
}

async function verifySharing() {
  const url = shareUrl();
  console.log("Checking public report availability…");
  const before = await available(url);
  assert(before.demo === true && before.entryCount === 4,"Unexpected demo scope");
  const baseline = await control("status");
  console.log("Checking viewer, fixed scope, and read-only requests…");
  const view = await fetch(url,{signal:AbortSignal.timeout(15000)});
  assert(view.ok && (await view.text()).includes("Generated demo records only"),"Browser page unavailable");
  assert(view.headers.get("cache-control").includes("no-store"),"Shared responses must not be cached");
  for (const suffix of ["data.json?projectId=other","data.json?dateFrom=2000-01-01"]) {
    const response = await fetch(url + suffix,{signal:AbortSignal.timeout(15000)});
    assert(response.status === 400,"A visitor could change report filters");
    await response.body?.cancel();
  }
  const write = await fetch(`${url}data.json`,{method:"POST",body:"modify",signal:AbortSignal.timeout(15000)});
  assert(write.status === 405,"Public writes must be rejected");
  await write.body?.cancel();
  assert((await control("status")).fingerprint === baseline.fingerprint,"HTTP reads changed stored entries");
  console.log("Checking source interruption and live updates…");
  await control("pause");await fetchReport(url,503);
  await control("resume");await fetchReport(url);
  await control("add");
  const after = await fetchReport(url);
  assert(after.entryCount === before.entryCount + 1 && after.totalSeconds >= before.totalSeconds + 60,"Live changes did not reach the shared report");
  console.log("PASS live HTTPS report, fixed scope, field minimization, read-only HTTP, and source reconnect.");
  const rotated = await control("rotate");ready.url = rotated.url;
  await fetchReport(url,404);await fetchReport(shareUrl());
  await control("revoke");await fetchReport(shareUrl(),410);
  ready.url = (await control("new-link")).url;
  await control("expire");await fetchReport(shareUrl(),410);
  ready.url = (await control("new-link")).url;
  saveState({verified:true});
  console.log("PASS token rotation, immediate revocation, and expiry through the share URL.");
  await verifyBrowser();
  console.log(`Verified demo link: ${shareUrl()}`);
}

async function verifyBrowser() {
  const edgePaths = [process.env.EDGE_PATH, join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)","Microsoft","Edge","Application","msedge.exe"),join(process.env.ProgramFiles ?? "C:\\Program Files","Microsoft","Edge","Application","msedge.exe")];
  const browser = edgePaths.find((path) => path && existsSync(path));
  assert(browser,"Microsoft Edge was not found for browser verification");
  // An isolated headless browser profile cannot attach to the installed TempoDesk WebView.
  edge = spawn(browser,["--headless=new","--disable-gpu","--no-first-run","--remote-debugging-port=0",`--user-data-dir=${join(runDir,"browser")}`,shareUrl()],{stdio:["ignore","ignore","pipe"],windowsHide:true});
  let browserError;
  edge.once("error",(error) => {browserError = error;});
  edge.stderr.on("data",(bytes) => writeFileSync(join(runDir,"browser.log"),bytes,{flag:"a"}));
  let port;
  for (let attempt = 0;attempt < 100;attempt++) {
    if (browserError) throw browserError;
    const file = join(runDir,"browser","DevToolsActivePort");
    if (existsSync(file)) {port = Number(readFileSync(file,"utf8").split(/\r?\n/)[0]);break;}
    await wait(200);
  }
  assert(port,"Headless browser did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((target) => target.type === "page" && target.url.startsWith(publicOrigin ?? ready.origin));
  assert(target,"Report browser tab was not found");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  let id = 0;
  const calls = new Map();
  socket.addEventListener("message",(message) => {const value = JSON.parse(message.data);const call = calls.get(value.id);if (call) {calls.delete(value.id);value.error ? call.reject(new Error(value.error.message)) : call.resolve(value.result);}});
  const send = (method,params = {}) => withTimeout(new Promise((resolve,reject) => {const next = ++id;calls.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}));}),15000,`Browser request timed out: ${method}`);
  const evaluate = async (expression) => {const result = await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if (result.exceptionDetails) throw new Error("Browser evaluation failed");return result.result.value;};
  const until = async (expression) => {for (let attempt = 0;attempt < 100;attempt++) {if (await evaluate(expression)) return;await wait(200);}throw new Error("Browser did not reach the expected report state");};
  try {
    await until("document.getElementById('connection-label')?.textContent === 'Live'");
    assert(!(await evaluate("document.body.innerText.includes('PRIVATE_BETA_CANARY_7492')")),"Browser leaked an unshared client");
    await evaluate("document.getElementById('timesheet-tab').click()");
    assert(await evaluate("!document.getElementById('timesheet-view').hidden"),"Timesheet tab failed");
    await evaluate("document.getElementById('report-tab').click()");
    await control("pause");
    await until("document.getElementById('connection-label').textContent.includes('Offline')");
    assert(await evaluate("!document.getElementById('content').hidden"),"Offline viewer discarded its last report");
    await control("resume");
    await until("document.getElementById('connection-label').textContent === 'Live'");
    const image = await send("Page.captureScreenshot",{format:"png"});
    writeFileSync(join(runDir,"report-desktop.png"),Buffer.from(image.data,"base64"));
    await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
    const mobile = await send("Page.captureScreenshot",{format:"png"});
    writeFileSync(join(runDir,"report-mobile.png"),Buffer.from(mobile.data,"base64"));
    assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"),"Report overflows on mobile");
    await control("revoke");
    await until("document.getElementById('content').hidden && document.getElementById('connection-label').textContent === 'Stopped'");
    ready.url = (await control("new-link")).url;
    saveState({verified:true,browserVerified:true});
    console.log("PASS actual browser: overview/timesheet, disconnect/reconnect, revocation, and 390px layout.");
  } finally {socket.close();if (edge && !edge.killed) edge.kill();edge = null;}
}

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  if (edge && !edge.killed) edge.kill();
  if (tunnel && !tunnel.killed) tunnel.kill();
  if (server && server.exitCode === null) {try {await control("quit");} catch {server.kill();}}
  if (ready) saveState({stopped:true});
}

process.once("SIGINT",() => {void cleanup().then(() => process.exit(0));});
process.once("SIGTERM",() => {void cleanup().then(() => process.exit(0));});
try {
  await start();
  if (verify) await verifySharing();
  console.log("Owner controls: add, pause, resume, rotate, revoke, new-link, status, quit. Demo stops automatically after expiry.");
  const input = createInterface({input:process.stdin});
  input.on("line",async (line) => {
    const action = line.trim();
    if (!["add","pause","resume","rotate","revoke","new-link","status","quit"].includes(action)) return;
    try {
      const response = await control(action);
      if (response.url) {ready.url = response.url;saveState();console.log(`Share link: ${shareUrl()}`);}
      else console.log(`${action}: OK`);
      if (action === "quit") {input.close();await cleanup();}
    } catch (error) {console.error(error.message);}
  });
} catch (error) {
  console.error(`Sharing proof of concept: ${error.message}${error.cause ? ` (${error.cause.code ?? "network"}: ${error.cause.message})` : ""}`);
  await cleanup();
  process.exitCode = 1;
}
