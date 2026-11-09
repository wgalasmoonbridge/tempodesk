import { createElement } from "react";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Button } from "../components/Button";

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const styles = readFileSync("src/styles/app.css", "utf8");

it.each(["light", "dark"])("uses green primary button backgrounds in the %s theme, including hover", (theme) => {
  render(createElement(Button, { variant: "primary" }, "Save"));
  expect(screen.getByRole("button", { name: "Save" })).toHaveClass("btn-primary");

  const sheet = document.createElement("style");
  sheet.textContent = tokens;
  document.head.append(sheet);
  try {
    const rules = Array.from(sheet.sheet!.cssRules) as CSSStyleRule[];
    const root = rules.find((rule) => rule.selectorText === ":root")!.style;
    const dark = rules.find((rule) => rule.selectorText === '[data-theme="dark"]')!.style;
    const resolve = (value: string): string => value.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
      resolve((theme === "dark" && dark.getPropertyValue(name)) || root.getPropertyValue(name)),
    ).trim();

    for (const selector of [".btn-primary", ".btn-primary:hover"]) {
      const block = styles.split(`${selector} {`)[1]?.split("}")[0];
      expect(block).toBeDefined();
      const background = resolve(block!.match(/background:\s*([^;]+);/)![1]!);
      // Check the requested color family without prescribing a particular green shade.
      expect(background).toMatch(/^#[\da-f]{6}$/i);
      const red = parseInt(background.slice(1, 3), 16);
      const green = parseInt(background.slice(3, 5), 16);
      const blue = parseInt(background.slice(5, 7), 16);
      expect(green).toBeGreaterThan(red);
      expect(green).toBeGreaterThan(blue);
    }
  } finally {
    sheet.remove();
  }
});
