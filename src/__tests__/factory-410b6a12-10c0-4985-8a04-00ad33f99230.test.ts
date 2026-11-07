import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readPage = (filename: string) =>
  new DOMParser().parseFromString(
    readFileSync(resolve(process.cwd(), "site", filename), "utf8"),
    "text/html",
  );

describe("website Privacy page", () => {
  it("links to a dedicated page from the homepage navigation and footer", () => {
    const home = readPage("index.html");
    for (const selector of ["nav", "footer"]) {
      const link = Array.from(home.querySelectorAll(`${selector} a`)).find(
        (element) => element.textContent?.trim() === "Privacy",
      );
      expect(link?.getAttribute("href")).toBe("privacy.html");
    }
  });

  it("provides readable privacy information and a way back home", () => {
    const page = readPage("privacy.html");
    expect(page.title).toMatch(/Privacy.*TempoDesk/);
    expect(page.querySelector("main h1")?.textContent).toBe("Privacy");
    const text = page.querySelector("main")?.textContent?.replace(/\s+/g, " ");
    expect(text).toContain("SQLite");
    expect(text).toContain("Google Gemini");
    expect(text).toContain("Cloudflare");
    expect(text).toContain("Machine activity");
    expect(text).toContain("plain-text JSON");
    expect(page.querySelector('a[aria-label="TempoDesk home"]')?.getAttribute("href"))
      .toBe("index.html");
  });
});
