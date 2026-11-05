import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";
import { MachineActivityPanel } from "../features/settings/MachineActivityPanel";
import { api } from "../lib/ipc";
import type { MachineActivityEvent, MachineActivityStatus } from "../lib/types";

const context = vi.hoisted(() => ({ enabled: false, retention: 30, timezone: "UTC", updateSettings: vi.fn() }));
vi.mock("../app/AppProvider", () => ({ useAppData: () => ({
  settings: { machineActivityEnabled: context.enabled, machineActivityRetentionDays: context.retention, timeFormat: "24h" },
  timezone: context.timezone, dataVersion: 0, updateSettings: context.updateSettings,
}) }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../lib/ipc", () => ({
  normalizeError: (error: Error) => ({ message: error.message }),
  api: { getMachineActivityStatus: vi.fn(), listMachineActivity: vi.fn(), exportMachineActivityCsv: vi.fn(), clearMachineActivity: vi.fn(), startTimer: vi.fn() },
}));

const status: MachineActivityStatus = { enabled: true, currentSession: {
  accountId: "uid:1000", userName: "Current user", domain: null, machineName: "Laptop", sessionId: "2",
  loginAtUtc: null, locked: null, active: true,
}, capabilities: [{ feature: "lock", status: "unsupported", detail: "No public screen-lock notifications on this OS." }],
lastObservedAtUtc: 10000, error: null };
const event: MachineActivityEvent = { id: "1", accountId: "uid:1000", userName: "Current user", domain: null,
  machineName: "Laptop", sessionId: "2", kind: "session_observed", eventAtUtc: 10000, observedAtUtc: 10000,
  source: "macos-workspace", timing: "observed" };

beforeEach(() => {
  vi.clearAllMocks();
  context.enabled = false; context.retention = 30; context.timezone = "UTC";
  context.updateSettings.mockResolvedValue({});
  vi.mocked(api.getMachineActivityStatus).mockResolvedValue(status);
  vi.mocked(api.listMachineActivity).mockResolvedValue({ events: [event], totalCount: 1 });
  vi.mocked(api.clearMachineActivity).mockResolvedValue(1);
  vi.mocked(api.exportMachineActivityCsv).mockResolvedValue({ path: "activity.csv", rowCount: 51, totalSeconds: 0 });
  vi.mocked(save).mockResolvedValue("C:/exports/activity.csv");
});

describe("machine activity consent and history", () => {
  it("does not enable logging without explicit confirmation or expose a stale current-session cache while off", async () => {
    render(<MachineActivityPanel />);
    await screen.findByText("Session observed");
    expect(screen.queryByText("Account identifier")).not.toBeInTheDocument();
    expect(context.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Log my machine activity" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(context.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(context.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Log my machine activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable logging" }));
    await waitFor(() => expect(context.updateSettings).toHaveBeenCalledWith({ machineActivityEnabled: true }));
    expect(api.startTimer).not.toHaveBeenCalled();
  });

  it("shows unsupported capabilities and unknown login times instead of inventing login or lock events", async () => {
    context.enabled = true;
    render(<MachineActivityPanel />);
    await screen.findByText("Account identifier");
    expect(screen.getByText("unsupported")).toBeInTheDocument();
    expect(screen.getByText("No public screen-lock notifications on this OS.")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown / unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Observation only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Log my machine activity" }));
    await waitFor(() => expect(context.updateSettings).toHaveBeenCalledWith({ machineActivityEnabled: false }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exports the full timezone-correct range even when viewing a later page", async () => {
    context.timezone = "America/New_York";
    vi.mocked(api.listMachineActivity).mockResolvedValue({ events: [event], totalCount: 51 });
    render(<MachineActivityPanel />);
    await screen.findByText("Session observed");
    fireEvent.change(screen.getByLabelText("Activity from date"), { target: { value: "2026-03-08" } });
    fireEvent.change(screen.getByLabelText("Activity through date"), { target: { value: "2026-03-08" } });
    const range = { fromUtc: Date.parse("2026-03-08T05:00:00Z"), toUtc: Date.parse("2026-03-09T04:00:00Z") };
    await waitFor(() => expect(api.listMachineActivity).toHaveBeenLastCalledWith({ ...range, limit: 50, offset: 0 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.listMachineActivity).toHaveBeenLastCalledWith({ ...range, limit: 50, offset: 50 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(api.exportMachineActivityCsv).toHaveBeenCalledWith(range, "C:/exports/activity.csv"));
  });

  it("requires confirmation before clearing all history and does not change consent or timers", async () => {
    render(<MachineActivityPanel />);
    await screen.findByText("Session observed");
    fireEvent.click(screen.getByRole("button", { name: "Clear all history" }));
    expect(api.clearMachineActivity).not.toHaveBeenCalled();
    vi.mocked(api.listMachineActivity).mockResolvedValue({ events: [], totalCount: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    await waitFor(() => expect(api.clearMachineActivity).toHaveBeenCalledOnce());
    await screen.findByText("No activity recorded in this range.");
    expect(context.updateSettings).not.toHaveBeenCalled();
    expect(api.startTimer).not.toHaveBeenCalled();
  });

  it("rejects reversed dates and reports failed writes without silently accepting consent", async () => {
    render(<MachineActivityPanel />);
    await screen.findByText("Session observed");
    fireEvent.change(screen.getByLabelText("Activity from date"), { target: { value: "2026-11-05" } });
    fireEvent.change(screen.getByLabelText("Activity through date"), { target: { value: "2026-11-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("through date");
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    context.updateSettings.mockRejectedValueOnce(new Error("Database unavailable"));
    fireEvent.click(screen.getByRole("switch", { name: "Log my machine activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable logging" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enable logging" })).toBeEnabled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("Database unavailable").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch", { name: "Log my machine activity" })).not.toBeChecked();
  });
});
