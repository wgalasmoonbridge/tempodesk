// Bulk selection + multi-delete + batch undo, driven over the real WebView2 page.
// Self-contained: completes onboarding if needed and creates three fixture entries.
import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (c, a) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
const dialog = "document.querySelector('[role=dialog]')";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await cdp.waitFor("!!document.querySelector('.app')", { label: "app" });

  if (await cdp.evaluate("!!document.querySelector('[role=dialog]') && document.body.innerText.includes('Welcome to TempoDesk')")) {
    await invoke("update_settings", { patch: { onboardingComplete: true } });
    await cdp.waitFor("!document.querySelector('[role=dialog]')", { label: "onboarding dismissed" });
  }

  const status = await invoke("get_app_status", { timezone: "America/Chicago" });
  if (status.activeEntry) await invoke("stop_timer");

  // Create three uniquely-named entries so the test does not depend on existing user data.
  const suffix = String(Date.now()).slice(-6);
  const base = Math.floor(Date.now() / 1000) * 1000 - 4 * 3_600_000;
  const names = ["A", "B", "C"].map((label) => `Bulk ${label} ${suffix}`);
  for (const [index, name] of names.entries()) {
    const start = base + index * 3_600_000;
    await invoke("create_manual_entry", {
      input: {
        description: name,
        projectId: null,
        tagIds: [],
        isBillable: false,
        startAtUtc: start,
        endAtUtc: start + 600_000,
      },
    });
  }

  await cdp.click("Time Tracker");
  await cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(names[0])})`, {
    label: "fixture entries",
  });
  await wait(500);
  const before = await invoke("list_entries", {
    filter: { timezone: "America/Chicago", limit: 100 },
  });
  const fixtures = names.map((name) => before.find((entry) => entry.description === name));
  assert(fixtures.every(Boolean), "all fixture entries exist");
  const [first, second, third] = fixtures;

  await cdp.click("Select");
  await cdp.waitFor("!!document.querySelector('.bulk-bar')", { label: "bulk bar" });
  await cdp.clickAria(`Select ${first.description}`);
  await cdp.clickAria(`Select ${second.description}`);
  await cdp.waitFor("document.body.innerText.includes('2 entries selected')", {
    label: "selection count",
  });
  await cdp.screenshot("docs/screenshots/bulk-select.png");

  await cdp.click("Delete selected");
  await cdp.waitFor("document.body.innerText.includes('Delete 2 selected entries?')", {
    label: "bulk confirm",
  });
  await cdp.screenshot("docs/screenshots/bulk-confirm.png");
  await cdp.click("Delete 2 entries", dialog);
  await cdp.waitFor("document.body.innerText.includes('2 entries deleted')", {
    label: "bulk delete toast",
  });

  const afterDelete = await invoke("list_entries", {
    filter: { timezone: "America/Chicago", limit: 100, includeDeleted: true },
  });
  const deletedA = afterDelete.find((item) => item.id === first.id);
  const deletedB = afterDelete.find((item) => item.id === second.id);
  const untouchedC = afterDelete.find((item) => item.id === third.id);
  assert(deletedA?.deletedAtUtc && deletedB?.deletedAtUtc, "only selected entries soft-deleted");
  assert(!untouchedC?.deletedAtUtc, "unselected fixture remains visible");
  assert(deletedA.deletedAtUtc === deletedB.deletedAtUtc, "batch shares one transaction timestamp");
  const visibleAfterDelete = await invoke("list_entries", {
    filter: { timezone: "America/Chicago", limit: 100 },
  });
  assert(
    visibleAfterDelete.some((entry) => entry.id === third.id),
    "third entry still visible after batch delete",
  );
  assert(
    !visibleAfterDelete.some((entry) => entry.id === first.id || entry.id === second.id),
    "deleted entries hidden from history",
  );

  await cdp.click("Undo");
  await cdp.waitFor("document.body.innerText.includes('2 entries restored')", {
    label: "bulk undo toast",
  });
  const afterUndo = await invoke("list_entries", {
    filter: { timezone: "America/Chicago", limit: 100 },
  });
  for (const id of [first.id, second.id]) {
    assert(afterUndo.some((entry) => entry.id === id), `entry ${id} restored`);
  }
  console.log("PASS bulk select, delete, and batch undo");

  // Running entries are never selectable/deletable.
  await cdp.type("#timer-description", "Bulk running guard");
  await cdp.click("Start");
  await cdp.waitFor("document.body.innerText.includes('Tracking')");
  await wait(800);
  const currentEntries = await invoke("list_entries", {
    filter: { timezone: "America/Chicago", limit: 100 },
  });
  const expectedCompleted = currentEntries.filter((entry) => !entry.running).length;
  await cdp.click("Select");
  await cdp.waitFor("!!document.querySelector('.entry-row.running .entry-select input')", {
    label: "running checkbox",
  });
  const runningCheckbox = await cdp.evaluate(`(() => {
    const row = document.querySelector('.entry-row.running');
    const input = row?.querySelector('.entry-select input');
    return input ? { disabled: input.disabled } : null;
  })()`);
  assert(runningCheckbox?.disabled === true, "running entry checkbox disabled");
  await cdp.click("Select all shown");
  await wait(200);
  const allSelectedIncludesRunning = await cdp.evaluate(`(() => {
    const row = document.querySelector('.entry-row.running .entry-select input');
    return row?.checked ?? false;
  })()`);
  assert(!allSelectedIncludesRunning, "select-all excludes the running entry");
  const selectedCountText = await cdp.evaluate("document.querySelector('.bulk-bar')?.innerText ?? ''");
  assert(
    selectedCountText.includes(`${expectedCompleted} ${expectedCompleted === 1 ? "entry" : "entries"} selected`),
    "select-all selected only completed entries",
  );
  await cdp.click("Cancel");
  await cdp.waitFor("!document.querySelector('.bulk-bar')");
  await cdp.click("Stop");
  await cdp.waitFor("document.body.innerText.includes('Timer stopped')");
  console.log("PASS running-entry bulk guard");

  await cdp.evaluate("setTimeout(() => window.__TAURI_INTERNALS__.invoke('quit_app', { stopTimer: false }), 50); true");
  console.log("Bulk delete checks passed");
} finally {
  cdp.close();
}
