// Generated fixtures only. cdp-lib verifies the isolated native test profile before every action.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { connect, assert } from "./cdp-lib.mjs";

const cdp = await connect();
assert(cdp.platformInfo.dataProfile === "test", "sharing verification requires a test profile");
const testRoot = resolve(".test-data") + sep;
assert(resolve(cdp.platformInfo.dbPath).startsWith(testRoot), "test database must be within this workspace");
const runDir = join(cdp.platformInfo.dataDir,"sharing-check");
mkdirSync(runDir,{recursive:true});
const invoke = (command,args = {}) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`);
const dialog = "document.querySelector('[role=dialog]')";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve,ms));
const db = new DatabaseSync(cdp.platformInfo.dbPath,{readOnly:true});
const ledger = () => JSON.stringify(db.prepare("SELECT * FROM time_entries ORDER BY id").all());
let startedTimer = false;
let appQuit = false;

async function ready() {
  const deadline = Date.now() + 300000;
  let phase;
  let lastNotice = 0;
  while (Date.now() < deadline) {
    const status = await invoke("get_sharing_status");
    if (status.phase !== phase || Date.now() - lastNotice > 30000) {
      console.log(`Sharing: ${status.phase} — ${status.message}`);phase = status.phase;lastNotice = Date.now();
    }
    if (status.phase === "active") return status;
    if (["error","expired","stopped"].includes(status.phase)) throw new Error(`Sharing did not become active: ${status.message}`);
    await wait(500);
  }
  throw new Error("Timed out waiting for the app's public tunnel");
}

async function report(url, expected = 200) {
  const response = await fetch(new URL("data.json",url),{signal:AbortSignal.timeout(15000)});
  assert(response.status === expected,`expected HTTP ${expected}, got ${response.status}`);
  if (expected !== 200) {await response.body?.cancel();return null;}
  const json = await response.json();
  assert(!JSON.stringify(json).includes("PRIVATE_SHARING_CANARY"),"unapproved project leaked");
  return json;
}

async function inaccessible(url) {
  try {
    const response = await fetch(new URL("data.json",url),{signal:AbortSignal.timeout(10000)});
    const status = response.status;await response.body?.cancel();
    assert(status !== 200,"stopped or exited app still serves records");
  } catch (failure) {if (failure.message.startsWith("Assertion failed:")) throw failure;}
}

try {
  await invoke("update_settings",{patch:{onboardingComplete:true,timezone:"Asia/Manila"}});
  await cdp.waitFor("!document.querySelector('[role=dialog]')");
  if ((await invoke("get_app_status",{timezone:"Asia/Manila"})).activeEntry) await invoke("stop_timer");
  await invoke("stop_sharing");
  const suffix = String(Date.now()).slice(-6);
  const project = await invoke("save_project",{input:{name:`Generated sharing project ${suffix}`,defaultBillable:true}});
  const privateProject = await invoke("save_project",{input:{name:`PRIVATE_SHARING_CANARY ${suffix}`}});
  const now = Math.floor(Date.now()/1000)*1000;
  for (const [projectId,description] of [[project.id,"Generated description, hidden by default"],[privateProject.id,"PRIVATE_SHARING_CANARY"]]) {
    await invoke("create_manual_entry",{input:{description,projectId,tagIds:[],isBillable:true,startAtUtc:now-3600000,endAtUtc:now-3000000}});
  }
  const before = ledger();
  await cdp.click("Reports");
  await cdp.select('[aria-label="Project filter"]',project.id);
  await cdp.waitFor("[...document.querySelectorAll('button')].some(el => el.textContent.trim() === 'Share' && !el.disabled)");
  await cdp.click("Share");
  await cdp.waitFor("[...document.querySelectorAll('[role=dialog] button')].some(el => el.textContent.trim() === 'Create public link' && !el.disabled)");
  assert(await cdp.evaluate("![...document.querySelectorAll('[role=dialog] input[type=checkbox]')].some(el => el.checked)"),"private fields default to hidden");
  await cdp.screenshot(join(runDir,"owner-preview.png"));
  assert(ledger() === before,"preview changed saved time entries");
  console.log("PASS native preview, explicit create, frozen filters, and hidden private fields.");
  await cdp.click("Create public link",dialog);
  let status = await ready();
  const original = status.url;
  let shared = await report(original);
  assert(shared.demo === false && shared.entryCount === 1 && shared.totalSeconds === 600,"public report does not match native scope");
  assert(shared.entries.every((entry) => entry.description === undefined && entry.billable === undefined),"private fields leaked");
  for (const query of ["projectId=private","dateFrom=1900-01-01","includeDescriptions=true"]) {
    const url = new URL("data.json",original);url.search = query;
    const response = await fetch(url,{signal:AbortSignal.timeout(10000)});
    assert(response.status === 400,"visitor changed owner filters");await response.body?.cancel();
  }
  const write = await fetch(new URL("data.json",original),{method:"POST",body:"modify",signal:AbortSignal.timeout(10000)});
  assert(write.status === 405,"public write was accepted");await write.body?.cancel();
  assert(ledger() === before,"HTTP requests changed saved records");
  await invoke("create_manual_entry",{input:{description:"Generated additional minute",projectId:project.id,tagIds:[],isBillable:false,startAtUtc:now-1800000,endAtUtc:now-1740000}});
  await wait(1200);shared = await report(original);
  assert(shared.entryCount === 2 && shared.totalSeconds === 660,"committed native changes did not reach the browser report");
  await invoke("start_timer",{input:{description:"Generated live timer",projectId:project.id}});startedTimer = true;
  await wait(3200);shared = await report(original);
  assert(shared.entryCount === 3 && shared.totalSeconds >= 663,"running timer does not update shared totals");
  await invoke("stop_timer");startedTimer = false;
  console.log("PASS public HTTPS scope, read-only requests, unchanged records, and live native changes/timer.");
  await cdp.waitFor("!!document.querySelector('#sharing-url')");
  await cdp.click("Replace link",dialog);
  await cdp.waitFor(`document.querySelector('#sharing-url')?.value !== ${JSON.stringify(original)}`);
  status = await invoke("get_sharing_status");
  await report(original,404);await report(status.url);
  await cdp.screenshot(join(runDir,"owner-active.png"));
  await cdp.click("Close",dialog);
  await cdp.click("Timesheet");
  await cdp.waitFor("document.querySelector('.sharing-banner')?.innerText.includes('Live report sharing')");
  await cdp.click("Stop sharing","document.querySelector('.sharing-banner')");
  assert((await invoke("get_sharing_status")).phase === "stopped","stop failed");
  await inaccessible(status.url);
  console.log("PASS rotation invalidates previous URL; global Stop removes public access from another page.");

  const filter = status.scope.filter;
  await invoke("start_sharing",{input:{...status.scope,filter,title:"Generated startup cancellation check",consent:true}});
  await invoke("stop_sharing");await wait(1500);
  assert((await invoke("get_sharing_status")).phase === "stopped","cancelled startup resumed sharing");
  console.log("PASS startup cancellation leaves sharing off.");

  await invoke("start_sharing",{input:{...status.scope,filter,initialView:"timesheet",ttlSeconds:600,title:"Generated quit lifecycle check",consent:true}});
  const quitShare = await ready();
  assert(quitShare.url.endsWith("#timesheet"),"timesheet initial view was lost");
  await report(quitShare.url);
  appQuit = true;
  const quitPromise = invoke("quit_app",{stopTimer:false}).catch(() => {});
  await Promise.race([quitPromise,wait(2000)]);
  await inaccessible(quitShare.url);
  writeFileSync(join(runDir,"results.json"),JSON.stringify({profile:"test",version:cdp.platformInfo.appVersion,readOnly:true,liveNativeChanges:true,
    rotation:true,stop:true,startupCancellation:true,quitCleanup:true,scopeFixed:true,privateFieldsHidden:true},null,2));
  console.log("PASS quitting the native app removes public access. No production profile was used.");
} finally {
  try {if (!appQuit) {if (startedTimer) await invoke("stop_timer");await invoke("stop_sharing");}} catch { /* app may already have exited */ }
  db.close();cdp.close();
}
