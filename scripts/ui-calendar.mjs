import { mkdirSync } from "node:fs";
import { assert, connect } from "./cdp-lib.mjs";

mkdirSync("docs/screenshots", { recursive: true });
const cdp = await connect();
const dialog = "document.querySelector('[role=dialog]')";

try {
  await cdp.waitFor("document.body.innerText.includes('TempoDesk')", {
    label: "app shell",
    timeout: 15000,
  });

  const onboardingVisible = await cdp.evaluate(
    "!!document.querySelector('[role=dialog]') && document.body.innerText.includes('Welcome to TempoDesk')",
  );
  if (onboardingVisible) {
    await cdp.click("Get started", dialog);
    await cdp.click("Skip project", dialog);
    await cdp.click("Start tracking", dialog);
    await cdp.waitFor("!document.querySelector('[role=dialog]')", {
      label: "onboarding closed",
    });
  }

  await cdp.click("Calendar");
  await cdp.waitFor("document.body.innerText.includes('Drag across empty time')", {
    label: "calendar page",
  });
  assert(await cdp.evaluate("document.querySelectorAll('.calendar-day-column').length === 7"), "week has seven day columns");
  console.log("PASS weekly calendar renders");

  const points = await cdp.evaluate(`(() => {
    const column = document.querySelector('.calendar-day-column.today');
    if (!column) return null;
    const rect = column.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      startY: rect.top + 14 * 60,
      endY: rect.top + 15.5 * 60,
    };
  })()`);
  assert(points, "today column exists");

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: points.x,
    y: points.startY,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: points.x,
    y: points.endY,
    button: "left",
    buttons: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: points.x,
    y: points.endY,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });

  await cdp.waitFor("document.body.innerText.includes('Add manual entry')", {
    label: "drag create dialog",
  });
  const times = await cdp.evaluate(`(() => {
    const inputs = [...document.querySelectorAll('[role=dialog] input[type=time]')];
    return inputs.map((input) => input.value.slice(0, 5));
  })()`);
  assert(times[0] === "14:00" && times[1] === "15:30", `drag selected 14:00–15:30, got ${times.join("–")}`);
  await cdp.type("[role=dialog] input[data-autofocus]", "Calendar planning");
  await cdp.click("Add entry", dialog);
  await cdp.waitFor("!document.querySelector('[role=dialog]')", { label: "entry saved" });
  await cdp.waitFor("document.body.innerText.includes('Calendar planning')", { label: "calendar block" });
  console.log("PASS drag-to-create saves the selected interval");

  await cdp.evaluate(`(() => {
    const block = [...document.querySelectorAll('.calendar-entry')]
      .find((item) => item.textContent.includes('Calendar planning'));
    block?.click();
  })()`);
  await cdp.waitFor("document.body.innerText.includes('Edit time entry')", { label: "edit dialog" });
  await cdp.type("[role=dialog] input[data-autofocus]", "Calendar planning updated");
  await cdp.click("Save changes", dialog);
  await cdp.waitFor("!document.querySelector('[role=dialog]')", { label: "edit saved" });
  await cdp.waitFor("document.body.innerText.includes('Calendar planning updated')", { label: "updated block" });
  console.log("PASS calendar block opens the existing entry editor");

  await cdp.click("Day");
  await cdp.waitFor("document.querySelectorAll('.calendar-day-column').length === 1", { label: "day view" });
  await cdp.click("Week");
  await cdp.waitFor("document.querySelectorAll('.calendar-day-column').length === 7", { label: "week view" });
  console.log("PASS day/week switching");

  await cdp.screenshot("docs/screenshots/calendar.png");
  console.log("Calendar UI verification passed");
} finally {
  cdp.close();
}
