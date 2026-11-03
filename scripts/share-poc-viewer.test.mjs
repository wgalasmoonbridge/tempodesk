import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync("sharing/web/index.html", "utf8");
const script = readFileSync("sharing/web/viewer.js", "utf8");
const sample = {
  demo: true, title: "Demo report", dateFrom: "2026-11-01", dateTo: "2026-11-02", timezone: "Asia/Manila",
  generatedAtUtc: 1793577600000, expiresAtUtc: Date.now() + 3600000, totalSeconds: 3600, entryCount: 1,
  days: [{date:"2026-11-01",seconds:3600},{date:"2026-11-02",seconds:0}],
  rows: [{project:"Website",description:"Design",daySeconds:[3600,0],totalSeconds:3600}],
  entries: [{project:"Website",description:"Design",startAtUtc:1793491200000,endAtUtc:1793494800000,seconds:3600,running:false}],
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const response = (body, status = 200) => ({ok:status >= 200 && status < 300, status, json:async () => structuredClone(body)});

function browser(fetch) {
  const dom = new JSDOM(html, {url:`https://demo.example/s/${"a".repeat(64)}/`, runScripts:"outside-only", pretendToBeVisual:true});
  let tick;
  dom.window.fetch = fetch;
  dom.window.AbortSignal = globalThis.AbortSignal;
  dom.window.setInterval = (callback) => { tick = callback; return 1; };
  dom.window.eval(script);
  return {dom, tick:async () => { tick(); await flush(); }};
}

test("shared values render as text and both views use the same report", async () => {
  const malicious = '<img src=x onerror="alert(1)">';
  const report = structuredClone(sample);
  report.title = malicious;
  report.entries[0].description = malicious;
  report.rows[0].description = malicious;
  const requests = [];
  const {dom} = browser(async (url, options) => { requests.push({url:String(url),options}); return response(report); });
  try {
    await flush();
    assert.equal(dom.window.document.querySelector("img"), null);
    assert.equal(dom.window.document.getElementById("title").textContent, malicious);
    assert.match(dom.window.document.getElementById("entries").textContent, /<img/);
    assert.match(dom.window.document.getElementById("total").textContent, /1h 00m/);
    dom.window.document.getElementById("timesheet-tab").click();
    assert.equal(dom.window.document.getElementById("timesheet-view").hidden, false);
    assert.equal(dom.window.document.getElementById("report-view").hidden, true);
    assert.match(dom.window.document.getElementById("week-body").textContent, /<img/);
    assert.equal(requests[0].url, `https://demo.example/s/${"a".repeat(64)}/data.json`);
    assert.equal(requests[0].options.credentials, "omit");
    assert.equal(requests[0].options.cache, "no-store");
    assert.equal(dom.window.localStorage.length, 0);
  } finally { dom.window.close(); }
});

test("source interruption preserves the last view and reconnect updates it", async () => {
  let phase = "online";
  const {dom,tick} = browser(async () => {
    if (phase === "offline") throw new Error("Disconnected");
    return response({...sample,totalSeconds:phase === "updated" ? 3660 : 3600});
  });
  try {
    await flush();
    assert.equal(dom.window.document.getElementById("connection-label").textContent, "Live");
    phase = "offline"; await tick();
    assert.match(dom.window.document.getElementById("connection-label").textContent, /Offline/);
    assert.equal(dom.window.document.getElementById("content").hidden, false);
    assert.match(dom.window.document.getElementById("notice").textContent, /last received report/);
    phase = "updated"; await tick();
    assert.equal(dom.window.document.getElementById("connection-label").textContent, "Live");
    assert.match(dom.window.document.getElementById("total").textContent, /1h 01m/);
  } finally { dom.window.close(); }
});

test("revoked links clear the report and stop polling", async () => {
  let revoked = false;
  let calls = 0;
  const {dom,tick} = browser(async () => { calls++; return revoked ? response({message:"The owner stopped sharing."},410) : response(sample); });
  try {
    await flush();
    revoked = true; await tick();
    assert.equal(dom.window.document.getElementById("content").hidden, true);
    assert.equal(dom.window.document.getElementById("entries").childElementCount, 0);
    assert.equal(dom.window.document.getElementById("title").textContent, "Share unavailable");
    assert.equal(dom.window.document.getElementById("total").textContent, "—");
    const before = calls; await tick();
    assert.equal(calls, before);
  } finally { dom.window.close(); }
});

test("a received report expires locally even when its source goes offline", async () => {
  let calls = 0;
  const {dom,tick} = browser(async () => {calls++;return response({...sample,demo:false});});
  try {
    await flush();
    assert.equal(dom.window.document.getElementById("demo-banner").hidden,true);
    dom.window.Date.now = () => sample.expiresAtUtc + 1;
    await tick();
    assert.equal(dom.window.document.getElementById("content").hidden,true);
    assert.equal(dom.window.document.getElementById("connection-label").textContent,"Stopped");
    assert.equal(calls,1);
  } finally {dom.window.close();}
});
