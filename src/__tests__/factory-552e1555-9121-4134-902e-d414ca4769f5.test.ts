import { createElement } from "react";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TagsPage } from "../features/tags/TagsPage";

const styles = readFileSync("src/styles/app.css", "utf8");

vi.mock("../app/AppProvider", () => ({
  useAppData: () => ({ dataVersion: 0, refreshMeta: vi.fn() }),
}));
vi.mock("../components/Toast", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));
vi.mock("../lib/ipc", () => ({
  api: { listTags: vi.fn().mockResolvedValue([]) },
  normalizeError: (error: Error) => ({ message: error.message }),
}));

let stylesheet: HTMLStyleElement;

beforeEach(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = styles;
  document.head.append(stylesheet);
});

afterEach(() => {
  cleanup();
  stylesheet.remove();
});

it("uses purple #7C3AED for Create tag in the empty state and creation form", async () => {
  render(createElement(TagsPage));
  const createTag = await screen.findByRole("button", { name: "Create tag" });
  expect(getComputedStyle(createTag).backgroundColor).toBe("rgb(124, 58, 237)");
  expect(getComputedStyle(createTag).color).toBe("rgb(255, 255, 255)");

  fireEvent.click(createTag);
  const submit = within(screen.getByRole("dialog", { name: "New tag" }))
    .getByRole("button", { name: "Create tag" });
  expect(getComputedStyle(submit).backgroundColor).toBe("rgb(124, 58, 237)");
  expect(getComputedStyle(submit).color).toBe("rgb(255, 255, 255)");
});
