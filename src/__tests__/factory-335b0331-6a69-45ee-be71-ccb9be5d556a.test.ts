import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";

vi.mock("../app/AppProvider", () => ({
  useAppData: () => ({ ready: false, timezone: "UTC", status: null }),
}));
vi.mock("../features/sharing/SharingProvider", () => ({ SharingBanner: () => null }));
vi.mock("../features/entries/EntryDialog", () => ({ EntryDialog: () => null }));
vi.mock("../features/settings/QuitDialog", () => ({ QuitDialog: () => null }));
vi.mock("../features/settings/ShortcutsDialog", () => ({ ShortcutsDialog: () => null }));

describe("TempoDesk app logo", () => {
  it("renders a scalable clock with connected hands and an elapsed-time arc beside the app name", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement(App));
    const brand = container.querySelector(".brand");
    const logo = brand?.querySelector("svg.brand-mark");

    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("viewBox", "0 0 32 32");
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(logo).toHaveAttribute("focusable", "false");
    expect(logo?.querySelector("circle")).toHaveAttribute("r", "10");
    expect(logo?.querySelector('path[stroke="#5eead4"]')).toHaveAttribute("d", "M16 6 A10 10 0 0 1 26 16");
    expect(logo?.querySelector('path[stroke="#ffffff"]')).toHaveAttribute("d", "M16 10 V16 L21 19");
    expect(brand?.querySelector(".brand-name")).toHaveTextContent("TempoDesk");
  });
});
