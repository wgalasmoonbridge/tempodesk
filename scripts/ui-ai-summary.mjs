// Tests AI settings/key storage and local day/week/month summaries without any network request.
import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const invoke = (c, a) => cdp.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(c)}, ${JSON.stringify(a)})`);
const dialog = "document.querySelector('[role=dialog]')";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeKey = "AIzaFAKE_TEST_KEY_1234567890";

try {
  await cdp.waitFor("!!document.querySelector('.app')", { label: "app" });
  await cdp.waitFor("typeof window.__TAURI_INTERNALS__?.invoke === 'function'");
  // Idempotent onboarding dismissal. Doing this eagerly avoids a race where the welcome modal
  // appears just after the first render and then covers later summary dialogs.
  await invoke("update_settings", { patch: { onboardingComplete: true } });
  await wait(500);
  if (await cdp.evaluate("!!document.querySelector('[role=dialog]')")) {
    const text = await cdp.evaluate("document.querySelector('[role=dialog]')?.innerText ?? ''");
    if (text.includes("Welcome to TempoDesk")) {
      await cdp.click("Skip setup", dialog);
    }
  }
  await cdp.waitFor("!document.querySelector('[role=dialog]')", { label: "onboarding closed" });

  const status = await invoke("get_app_status", { timezone: "America/Chicago" });
  if (status.activeEntry) await invoke("stop_timer");

  const suffix = String(Date.now()).slice(-6);
  const project = await invoke("save_project", {
    input: { name: `AI Summary Project ${suffix}`, color: "#0d9488", clientId: null, defaultBillable: false },
  });
  const base = Math.floor(Date.now() / 1000) * 1000 - 3 * 3_600_000;
  for (const [index, minutes] of [45, 30].entries()) {
    const start = base + index * 3_600_000;
    await invoke("create_manual_entry", {
      input: {
        description: `AI summary fixture ${index + 1}`,
        projectId: project.id,
        tagIds: [],
        isBillable: false,
        startAtUtc: start,
        endAtUtc: start + minutes * 60_000,
      },
    });
  }

  // --- Settings: provider, consent, key storage ---
  await cdp.click("Settings");
  await cdp.click("AI summaries");
  await cdp.waitFor("document.body.innerText.includes('Gemini API key')");

  const preAi = await invoke("get_settings");
  if (!preAi.aiSummariesEnabled) {
    await cdp.clickAria("Enable AI summaries");
    await wait(500);
  }
  const consentChecked = await cdp.evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('I understand'));
    return label?.querySelector('input')?.checked ?? false;
  })()`);
  if (!consentChecked) {
    await cdp.evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('I understand'));
      label?.querySelector('input')?.click();
      return true;
    })()`);
    await wait(500);
  }
  const settingsBeforeKey = await invoke("get_settings");
  assert(settingsBeforeKey.aiSummariesEnabled && settingsBeforeKey.aiConsent, "AI enabled and consent recorded");

  await cdp.type('[aria-label="Gemini API key"]', fakeKey);
  await cdp.click("Save key");
  await cdp.waitFor("document.body.innerText.includes('Configured')", { label: "key configured" });
  const aiStatus = await invoke("get_ai_status");
  assert(aiStatus.keyConfigured === true, "keyring reports configured key");
  assert(!JSON.stringify(aiStatus).includes(fakeKey), "API key is never returned by IPC");
  const settingsWithKey = await invoke("get_settings");
  assert(!JSON.stringify(settingsWithKey).includes(fakeKey), "API key is not in non-secret settings");
  await cdp.evaluate("[...document.querySelectorAll('.toast-close')].forEach((button) => button.click()); true");
  await cdp.screenshot("docs/screenshots/ai-settings.png");
  await cdp.evaluate("document.querySelector('.content').scrollTop = 520; true");
  await new Promise((resolve) => setTimeout(resolve, 400));
  await cdp.screenshot("docs/screenshots/ai-key-configured.png");
  await cdp.evaluate("document.querySelector('.content').scrollTop = 0; true");

  await cdp.click("Remove key");
  await cdp.waitFor("document.body.innerText.includes('Not configured')", { label: "key removed" });
  const afterRemove = await invoke("get_ai_status");
  assert(afterRemove.keyConfigured === false, "key removed from OS credential store");
  const today = (await invoke("get_app_status", { timezone: "America/Chicago" })).todayDate;
  const gateArgs = {
    filter: { dateFrom: today, dateTo: today, timezone: "America/Chicago" },
    useAi: true,
  };
  const gating = await cdp.evaluate(`(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('generate_summary', ${JSON.stringify(gateArgs)});
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error };
    }
  })()`);
  assert(!gating.ok, "AI generation is blocked without a key (no network call)");
  assert(
    JSON.stringify(gating.error).toLowerCase().includes("api key"),
    "AI gating explains missing key",
  );
  console.log("PASS AI settings + OS credential store round trip + missing-key gate");

  // --- Reports: local summary for the current week ---
  await cdp.click("Reports");
  await cdp.waitFor("document.body.innerText.includes('Detailed entries')", { label: "reports" });
  await wait(700);
  await cdp.click("Generate summary");
  await cdp.waitFor("!!document.querySelector('.summary-text')", { label: "local summary" });
  const reportSummary = await cdp.evaluate("document.querySelector('.summary-text')?.innerText ?? ''");
  assert(reportSummary.includes("Summary for"), "local report summary generated");
  assert(reportSummary.includes("AI Summary Project"), "summary includes project");
  assert((await cdp.text()).includes("Local · offline"), "summary labeled local/offline");
  await cdp.evaluate("[...document.querySelectorAll('.toast-close')].forEach((button) => button.click()); true");
  await cdp.screenshot("docs/screenshots/ai-summary-local.png");
  console.log("PASS local weekly summary in Reports");

  // --- Timesheet: summary dialog for the selected week ---
  await cdp.click("Timesheet");
  await cdp.waitFor("document.body.innerText.includes('Daily totals')");
  await cdp.click("Summarize week");
  await cdp.waitFor("document.body.innerText.includes('Weekly summary')", { label: "timesheet summary dialog" });
  await cdp.click("Generate summary", dialog);
  await cdp.waitFor("!!document.querySelector('[role=dialog] .summary-text')", { label: "week summary" });
  const weekSummary = await cdp.evaluate("document.querySelector('[role=dialog] .summary-text')?.innerText ?? ''");
  assert(weekSummary.includes("Summary for"), "weekly summary generated");
  await cdp.click("Close", dialog);
  console.log("PASS local weekly summary from Timesheet");

  // --- Tracker: today summary dialog ---
  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('History')");
  await cdp.click("Summarize today");
  await cdp.waitFor("document.body.innerText.includes(\"Today's summary\")", { label: "today summary dialog" });
  await cdp.click("Generate summary", dialog);
  await cdp.waitFor("!!document.querySelector('[role=dialog] .summary-text')", { label: "today summary" });
  const todaySummary = await cdp.evaluate("document.querySelector('[role=dialog] .summary-text')?.innerText ?? ''");
  assert(todaySummary.includes("Summary for"), "today summary generated");
  await cdp.click("Close", dialog);
  console.log("PASS local daily summary from Tracker");

  await cdp.evaluate("setTimeout(() => window.__TAURI_INTERNALS__.invoke('quit_app', { stopTimer: false }), 50); true");
  console.log("AI/local summary checks passed");
} finally {
  cdp.close();
}
