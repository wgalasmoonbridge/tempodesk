import { connect, assert } from "./cdp-lib.mjs";
const cdp = await connect();
const dialog = "document.querySelector('[role=dialog]')";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await cdp.click("Clients");
  await cdp.waitFor("document.body.innerText.includes('New client')");
  await cdp.click("New client");
  await cdp.waitFor("document.body.innerText.includes('New client') && !!document.querySelector('[role=dialog]')");
  await cdp.type('[role=dialog] input', "Acme Studio");
  await cdp.click("Create client", dialog);
  await cdp.waitFor("document.body.innerText.includes('Acme Studio')");
  console.log("PASS create client");

  await cdp.click("Projects");
  await cdp.waitFor("document.body.innerText.includes('Project Alpha')");
  await cdp.clickAria("Edit Project Alpha");
  await cdp.waitFor("!!document.querySelector('[role=dialog]')");
  const clientValue = await cdp.evaluate(`(() => {
    const select = document.querySelector('[role=dialog] select');
    const option = [...select.options].find((o) => o.textContent.includes('Acme Studio'));
    return option?.value ?? null;
  })()`);
  assert(clientValue, "client option available in project dialog");
  await cdp.select('[role=dialog] select', clientValue);
  await cdp.click("Save changes", dialog);
  await cdp.waitFor("document.body.innerText.includes('Acme Studio')");
  console.log("PASS link project to client");

  await cdp.click("Tags");
  await cdp.waitFor("document.body.innerText.includes('New tag')");
  await cdp.click("New tag");
  await cdp.waitFor("!!document.querySelector('[role=dialog]')");
  await cdp.type('[role=dialog] input', "Focus");
  await cdp.click("Create tag", dialog);
  await cdp.waitFor("document.body.innerText.includes('Focus')");
  console.log("PASS create tag");

  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('Build API')");
  await cdp.clickAria("Edit “Build API”");
  await cdp.waitFor("document.body.innerText.includes('Edit time entry')");
  await cdp.click("Focus", dialog);
  await cdp.click("Save changes", dialog);
  await cdp.waitFor("document.body.innerText.includes('Focus')");
  console.log("PASS attach tag");

  await cdp.click("Tags");
  await cdp.waitFor("document.body.innerText.includes('Focus')");
  await cdp.clickAria("Edit Focus");
  await cdp.waitFor("!!document.querySelector('[role=dialog]')");
  await cdp.type('[role=dialog] input', "Deep Work");
  await cdp.click("Save changes", dialog);
  await cdp.waitFor("document.body.innerText.includes('Deep Work')");
  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('Deep Work')", { label: "renamed tag in history" });
  console.log("PASS tag rename reflected in history");

  await cdp.click("Tags");
  await cdp.waitFor("document.body.innerText.includes('Deep Work')");
  await cdp.clickAria("Archive Deep Work");
  await cdp.waitFor("document.body.innerText.includes('Tag archived')");
  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('Deep Work')", { label: "archived tag still in history" });
  const tagOptions = await cdp.evaluate("[...document.querySelectorAll('.tag-picker button')].map(b=>b.textContent.trim())");
  assert(!tagOptions.includes("Deep Work"), "archived tag hidden from selector");
  console.log("PASS archived tag hidden from selectors, kept in history");

  await cdp.click("Tags");
  await cdp.waitFor("document.body.innerText.includes('Show archived')");
  await cdp.evaluate("[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Show archived')).querySelector('input').click()");
  await cdp.waitFor("document.body.innerText.includes('Deep Work')");
  await cdp.clickAria("Delete Deep Work");
  await cdp.waitFor("document.body.innerText.includes('Delete this tag?')");
  await cdp.click("Delete tag", dialog);
  await cdp.waitFor("document.body.innerText.includes('Tag deleted')");
  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('Deep Work')", { label: "deleted tag still in history" });
  console.log("PASS deleted tag name preserved in history");

  await cdp.click("Reports");
  await cdp.waitFor("document.body.innerText.includes('Detailed entries')");
  await cdp.waitFor("document.body.innerText.includes('Deep Work')", { label: "tag in report after deletion" });
  console.log("PASS deleted tag preserved in reports");

  await cdp.click("Projects");
  await cdp.waitFor("document.body.innerText.includes('Project Alpha')");
  await cdp.clickAria("Archive Project Alpha");
  await cdp.waitFor("document.body.innerText.includes('Project archived')");
  await cdp.click("Time Tracker");
  await cdp.waitFor("document.body.innerText.includes('Project Alpha')", { label: "archived project in history" });
  const projectOptions = await cdp.evaluate("[...document.querySelectorAll('#timer-project option')].map(o=>o.textContent)");
  assert(!projectOptions.some((text) => text.includes("Project Alpha")), "archived project hidden from new entries");
  console.log("PASS archived project hidden from selectors, kept in history");

  await cdp.click("Projects");
  await cdp.waitFor("document.body.innerText.includes('Show archived')");
  await cdp.evaluate("[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Show archived')).querySelector('input').click()");
  await cdp.waitFor("document.body.innerText.includes('Project Alpha')");
  await cdp.clickAria("Unarchive Project Alpha");
  await cdp.waitFor("document.body.innerText.includes('Project unarchived')");
  console.log("PASS unarchive project");
} finally {
  cdp.close();
}
