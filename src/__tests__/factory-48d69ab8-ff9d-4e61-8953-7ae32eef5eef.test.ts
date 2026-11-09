import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { version } from "../../package.json";
import { App } from "../app/App";

vi.mock("../app/AppProvider", () => ({
  useAppData: () => ({
    ready: false,
    settings: { onboardingComplete: true },
    timezone: "UTC",
    idleReviews: [],
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../features/sharing/SharingProvider", () => ({ SharingBanner: () => null }));
vi.mock("../features/entries/EntryDialog", () => ({ EntryDialog: () => null }));
vi.mock("../features/settings/QuitDialog", () => ({ QuitDialog: () => null }));
vi.mock("../features/settings/ShortcutsDialog", () => ({ ShortcutsDialog: () => null }));

it("displays the current app version in the persistent application header", () => {
  render(createElement(App));

  const header = screen.getByRole("banner");
  expect(within(header).getByText("TempoDesk")).toBeVisible();
  expect(within(header).getByText(`Version ${version}`)).toBeVisible();
});
