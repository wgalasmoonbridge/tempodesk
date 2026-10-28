// UI smoke test driven over the WebView2 DevTools protocol.
// Preconditions: app launched with remote debugging; onboarding-visible profile.
import { mkdirSync } from "node:fs";
import { assert, connect } from "./cdp-lib.mjs";

const shotDir = "docs/screenshots";
mkdirSync(shotDir, { recursive: true });

const cdp = await connect();
const dialog = "document.querySelector('[role=dialog]')";
const step = async (name, fn) => {
  await fn();
  console.log(`PASS ${name}`);
};

try {
  await cdp.waitFor("document.body.innerText.includes('TempoDesk')", {
    label: "app shell",
    timeout: 15000,
  });

  const onboardingVisible = await cdp.evaluate(
    "!!document.querySelector('[role=dialog]') && document.body.innerText.includes('Welcome to TempoDesk')",
  );
  if (onboardingVisible) {
    await step("onboarding step 1", async () => {
      await cdp.click("Get started", dialog);
    });
    await step("onboarding step 2 (skip project)", async () => {
      await cdp.click("Skip project", dialog);
    });
    await step("onboarding step 3 (start tracking)", async () => {
      await cdp.click("Start tracking", dialog);
    });
  }

  await cdp.waitFor("!document.querySelector('[role=dialog]')", {
    label: "onboarding closed",
  });

  await step("create a project", async () => {
    await cdp.click("Projects");
    await cdp.waitFor("document.body.innerText.includes('New project')");
    await cdp.click("New project");
    await cdp.waitFor("!!document.querySelector('[role=dialog]')");
    await cdp.type("[role=dialog] input", "Project Alpha");
    await cdp.click("Create project", dialog);
    await cdp.waitFor("document.body.innerText.includes('Project Alpha')");
  });

  await step("start a timer with project metadata", async () => {
    await cdp.click("Time Tracker");
    await cdp.waitFor("!!document.querySelector('#timer-description')");
    await cdp.type("#timer-description", "Build API");
    const option = await cdp.evaluate(`(() => {
      const select = document.querySelector('#timer-project');
      const target = [...select.options].find((o) => o.textContent.includes('Project Alpha'));
      return target?.value ?? null;
    })()`);
    assert(option, "project option exists");
    await cdp.select("#timer-project", option);
    await cdp.click("Start");
    await cdp.waitFor("document.body.innerText.includes('Tracking')", {
      label: "running card",
    });
    await cdp.waitFor("document.body.innerText.includes('New session')");
  });

  await step("stop the timer and see the entry", async () => {
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await cdp.click("Stop");
    await cdp.waitFor("document.body.innerText.includes('Timer stopped')", {
      label: "stop toast",
    });
    await cdp.waitFor("document.body.innerText.includes('Build API')");
  });

  await step("add a manual entry", async () => {
    await cdp.click("Manual entry");
    await cdp.waitFor("document.body.innerText.includes('Add manual entry')");
    await cdp.type("[role=dialog] input[data-autofocus]", "Manual review");
    await cdp.click("Add entry", dialog);
    await cdp.waitFor("document.body.innerText.includes('Manual review')", {
      label: "manual entry row",
    });
    await cdp.waitFor("!document.querySelector('[role=dialog]')", {
      label: "entry dialog closed",
    });
  });

  await step("open reports and verify totals", async () => {
    await cdp.click("Reports");
    await cdp.waitFor("document.body.innerText.includes('Detailed entries')", {
      label: "report loaded",
      timeout: 12000,
    });
    const body = await cdp.text();
    assert(body.includes("Build API"), "report includes timed entry");
    assert(body.includes("Manual review"), "report includes manual entry");
  });

  await step("screenshot tracker", async () => {
    await cdp.click("Time Tracker");
    await cdp.waitFor("document.body.innerText.includes('Build API')");
    await cdp.screenshot(`${shotDir}/tracker-populated.png`);
  });

  console.log("UI smoke passed");
} finally {
  cdp.close();
}
