import { useEffect, useMemo, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  Accessibility,
  Archive,
  Bell,
  BellRing,
  Check,
  Database,
  Download,
  HardDrive,
  Info,
  Keyboard,
  KeyRound,
  Laptop,
  Loader2,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sparkles,
  Sun,
  Timer,
  Upload,
  WifiOff,
} from "lucide-react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Switch } from "../../components/Switch";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import type {
  AiTestResult,
  BackupPreview,
  SettingsPatch,
  ThemeSetting,
} from "../../lib/types";
import { formatShortcut } from "../../lib/time";
import { AutoBackupPanel } from "./AutoBackupPanel";

type Section =
  | "general"
  | "appearance"
  | "desktop"
  | "shortcuts"
  | "idle"
  | "reminders"
  | "ai"
  | "data"
  | "privacy"
  | "about";

const SECTIONS: { id: Section; label: string; icon: typeof Timer }[] = [
  { id: "general", label: "General", icon: Timer },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "desktop", label: "Tray & startup", icon: Laptop },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "idle", label: "Idle detection", icon: Bell },
  { id: "reminders", label: "Reminders", icon: BellRing },
  { id: "ai", label: "AI summaries", icon: Sparkles },
  { id: "data", label: "Data & backup", icon: Database },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
  { id: "about", label: "About", icon: Info },
];

function supportedTimeZones(): string[] {
  try {
    const intl = Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    };
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function SettingsPage({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  const {
    settings,
    platform,
    shortcutStatus,
    aiStatus,
    updateSettings,
    refreshAiStatus,
    refreshAll,
    timezone,
  } = useAppData();
  const { pushToast } = useToast();
  const [section, setSection] = useState<Section>("general");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [restoreSource, setRestoreSource] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [aiKeyBusy, setAiKeyBusy] = useState(false);
  const [aiTestBusy, setAiTestBusy] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<AiTestResult | null>(null);
  const [aiKeyMessage, setAiKeyMessage] = useState<string | null>(null);
  const [aiModelInput, setAiModelInput] = useState(settings.aiModel);

  const [openShortcut, setOpenShortcut] = useState(settings.openShortcut);
  const [toggleShortcut, setToggleShortcut] = useState(settings.toggleShortcut);
  const [shortcutErrors, setShortcutErrors] = useState<string[]>([]);
  const [idleThreshold, setIdleThreshold] = useState(settings.idleThresholdMinutes);
  const [reminderMinutes, setReminderMinutes] = useState(settings.trackingReminderMinutes);

  useEffect(() => {
    setOpenShortcut(settings.openShortcut);
    setToggleShortcut(settings.toggleShortcut);
    setIdleThreshold(settings.idleThresholdMinutes);
    setReminderMinutes(settings.trackingReminderMinutes);
  }, [
    settings.openShortcut,
    settings.toggleShortcut,
    settings.idleThresholdMinutes,
    settings.trackingReminderMinutes,
  ]);

  useEffect(() => {
    setAiModelInput(settings.aiModel);
  }, [settings.aiModel]);

  const zones = useMemo(() => {
    const list = supportedTimeZones();
    if (settings.timezone !== "system" && !list.includes(settings.timezone)) {
      return [settings.timezone, ...list];
    }
    return list;
  }, [settings.timezone]);

  const save = async (patch: SettingsPatch, success?: string) => {
    setSaving(true);
    try {
      const result = await updateSettings(patch);
      const shortcutRelated =
        patch.shortcutsEnabled !== undefined ||
        patch.openShortcut !== undefined ||
        patch.toggleShortcut !== undefined;
      if (result.warnings.length > 0 && shortcutRelated) {
        pushToast({
          title: "Setting saved with a warning",
          message: result.warnings.join(" "),
          tone: "warning",
          duration: 9000,
        });
      } else if (success) {
        pushToast({ title: success, tone: "success" });
      }
      return result;
    } catch (error) {
      pushToast({
        title: "Could not save the setting",
        message: normalizeError(error).message,
        tone: "error",
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveShortcuts = async () => {
    setShortcutErrors([]);
    const result = await save(
      { openShortcut: openShortcut.trim(), toggleShortcut: toggleShortcut.trim() },
      "Shortcuts saved",
    );
    if (result) {
      const errors = [
        ...result.warnings,
        ...(result.settings.shortcutsEnabled
          ? []
          : ["Global shortcuts are disabled."]),
      ];
      setShortcutErrors(errors);
      if (result.settings.shortcutsEnabled) {
        const status = await api.getShortcutStatus().catch(() => null);
        if (status) setShortcutErrors(status.errors);
      }
    }
  };

  const saveAiKey = async () => {
    if (!aiKeyInput.trim() || aiKeyBusy) return;
    setAiKeyBusy(true);
    setAiKeyMessage(null);
    setAiTestResult(null);
    try {
      await api.setAiApiKey(aiKeyInput.trim());
      setAiKeyInput("");
      await refreshAiStatus();
      setAiKeyMessage("API key saved in the OS credential store.");
      pushToast({ title: "Gemini API key saved", tone: "success" });
    } catch (error) {
      const message = normalizeError(error).message;
      setAiKeyMessage(message);
      pushToast({ title: "Could not save the API key", message, tone: "error" });
    } finally {
      setAiKeyBusy(false);
    }
  };

  const removeAiKey = async () => {
    setAiKeyBusy(true);
    setAiKeyMessage(null);
    setAiTestResult(null);
    try {
      await api.deleteAiApiKey();
      await refreshAiStatus();
      setAiKeyMessage("API key removed from the OS credential store.");
      pushToast({ title: "Gemini API key removed", tone: "success" });
    } catch (error) {
      const message = normalizeError(error).message;
      setAiKeyMessage(message);
      pushToast({ title: "Could not remove the API key", message, tone: "error" });
    } finally {
      setAiKeyBusy(false);
    }
  };

  const testAi = async () => {
    setAiTestBusy(true);
    setAiTestResult(null);
    setAiKeyMessage(null);
    try {
      const result = await api.testAiConnection();
      setAiTestResult(result);
      pushToast({ title: result.message, tone: "success" });
    } catch (error) {
      const message = normalizeError(error).message;
      setAiKeyMessage(message);
      pushToast({ title: "Gemini connection failed", message, tone: "error" });
    } finally {
      setAiTestBusy(false);
    }
  };

  const saveAiModel = async () => {
    const model = aiModelInput.trim();
    if (!model) {
      pushToast({ title: "Enter a Gemini model name", tone: "warning" });
      return;
    }
    await save({ aiModel: model }, "AI model updated");
  };

  const backup = async () => {
    setBackupBusy(true);
    try {
      const destination = await saveDialog({
        title: "Save TempoDesk backup",
        defaultPath: `tempodesk-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "TempoDesk backup", extensions: ["json"] }],
      });
      if (!destination) return;
      const result = await api.saveBackup(destination);
      pushToast({
        title: "Backup created",
        message: `${result.counts.entries} entries, ${result.counts.projects} projects, ${result.counts.clients} clients, ${result.counts.tags} tags → ${result.path}`,
        tone: "success",
        duration: 9000,
      });
    } catch (error) {
      pushToast({
        title: "Backup failed",
        message: normalizeError(error).message,
        tone: "error",
      });
    } finally {
      setBackupBusy(false);
    }
  };

  const chooseRestore = async () => {
    try {
      const source = await openDialog({
        title: "Choose a TempoDesk backup",
        multiple: false,
        filters: [{ name: "TempoDesk backup", extensions: ["json"] }],
      });
      if (!source || Array.isArray(source)) return;
      const result = await api.previewRestore(source);
      setRestoreSource(source);
      setPreview(result);
    } catch (error) {
      pushToast({
        title: "Could not read the backup",
        message: normalizeError(error).message,
        tone: "error",
      });
    }
  };

  const confirmRestore = async () => {
    if (!restoreSource) return;
    setRestoring(true);
    try {
      const result = await api.restoreBackup(restoreSource);
      pushToast({
        title: "Backup restored",
        message: `${result.counts.entries} entries restored. A safety backup of the previous data was saved to ${result.safetyBackupPath}`,
        tone: "success",
        duration: 11000,
      });
      setPreview(null);
      setRestoreSource(null);
      await refreshAll();
    } catch (error) {
      pushToast({
        title: "Restore failed",
        message: normalizeError(error).message,
        tone: "error",
      });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="page-sub">Preferences are stored locally in the app database.</div>
        </div>
        <div className="page-header-actions">
          <Button
            icon={<Keyboard size={14} aria-hidden="true" />}
            onClick={onOpenShortcuts}
          >
            Keyboard shortcuts
          </Button>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={section === item.id ? "true" : undefined}
                onClick={() => setSection(item.id)}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icon size={14} aria-hidden="true" />
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        <div>
          {section === "general" ? (
            <div className="settings-section">
              <h2>General</h2>
              <p>Time display and calendar conventions.</p>
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Start of week</div>
                    <div className="setting-desc">Used by the timesheet and weekly reports.</div>
                  </div>
                  <div className="setting-control">
                    <select
                      className="select"
                      value={settings.startOfWeek}
                      aria-label="Start of week"
                      disabled={saving}
                      onChange={(event) =>
                        void save(
                          { startOfWeek: event.target.value as "monday" | "sunday" },
                          "Start of week updated",
                        )
                      }
                    >
                      <option value="monday">Monday</option>
                      <option value="sunday">Sunday</option>
                    </select>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Time format</div>
                    <div className="setting-desc">
                      Automatic follows your OS locale. Durations stay HH:MM / HH:MM:SS.
                    </div>
                  </div>
                  <div className="setting-control">
                    <select
                      className="select"
                      value={settings.timeFormat}
                      aria-label="Time format"
                      disabled={saving}
                      onChange={(event) =>
                        void save(
                          {
                            timeFormat: event.target.value as
                              | "auto"
                              | "12h"
                              | "24h",
                          },
                          "Time format updated",
                        )
                      }
                    >
                      <option value="auto">Automatic (OS locale)</option>
                      <option value="12h">12-hour</option>
                      <option value="24h">24-hour</option>
                    </select>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Time zone</div>
                    <div className="setting-desc">
                      Day boundaries and reports use this zone. Currently{" "}
                      <strong>{timezone}</strong>.
                    </div>
                  </div>
                  <div className="setting-control">
                    <select
                      className="select"
                      value={settings.timezone}
                      aria-label="Time zone"
                      disabled={saving}
                      onChange={(event) =>
                        void save({ timezone: event.target.value }, "Time zone updated")
                      }
                    >
                      <option value="system">System default ({timezone})</option>
                      {zones.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <p className="field-hint">
                Timestamps are stored in UTC as integer milliseconds and allocated to local days at
                local midnight, including DST transitions.
              </p>
            </div>
          ) : null}

          {section === "appearance" ? (
            <div className="settings-section">
              <h2>Appearance</h2>
              <p>TempoDesk uses the native window frame and OS-aware colors.</p>
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Theme</div>
                    <div className="setting-desc">
                      System follows light/dark changes immediately.
                    </div>
                  </div>
                  <div className="setting-control">
                    <SegmentedControl<ThemeSetting>
                      label="Theme"
                      value={settings.theme}
                      onChange={(value) => void save({ theme: value }, "Theme updated")}
                      options={[
                        { value: "system", label: "System" },
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" },
                      ]}
                    />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">System appearance</div>
                    <div className="setting-desc">
                      {settings.theme === "system"
                        ? "TempoDesk is mirroring the OS light/dark preference."
                        : "Manual override is active. Choose System to follow the OS."}
                    </div>
                  </div>
                  <div className="setting-control">
                    <span className="badge">
                      {settings.theme === "system" ? (
                        <>
                          <Monitor size={11} aria-hidden="true" /> Following OS
                        </>
                      ) : settings.theme === "dark" ? (
                        <>
                          <Moon size={11} aria-hidden="true" /> Dark
                        </>
                      ) : (
                        <>
                          <Sun size={11} aria-hidden="true" /> Light
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <div className="card card-pad">
                <div className="setting-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Accessibility size={14} aria-hidden="true" /> Accessibility
                </div>
                <p className="field-hint" style={{ marginTop: 5 }}>
                  Reduced-motion preferences are respected, focus rings are always visible, and
                  all actions are reachable by keyboard. Font scaling follows the OS.
                </p>
              </div>
            </div>
          ) : null}

          {section === "desktop" ? (
            <div className="settings-section">
              <h2>Tray & startup</h2>
              <p>Native desktop behavior when the window is hidden or the app starts.</p>
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">System tray / menu bar</div>
                    <div className="setting-desc">
                      {platform?.trayAvailable
                        ? "Available. The tray shows live status, start/stop, recent entries, and quit."
                        : "The tray could not be created on this system. All window controls still work."}
                    </div>
                  </div>
                  <div className="setting-control">
                    <span className={`badge ${platform?.trayAvailable ? "badge-teal" : ""}`}>
                      {platform?.trayAvailable ? "Active" : "Unavailable"}
                    </span>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Close window to tray</div>
                    <div className="setting-desc">
                      When on, closing the window hides it and the timer keeps running. Turn off to
                      show the quit confirmation when closing.
                    </div>
                  </div>
                  <div className="setting-control">
                    <Switch
                      checked={settings.closeToTray}
                      label="Close window to tray"
                      disabled={saving}
                      onChange={(value) =>
                        void save({ closeToTray: value }, "Tray preference updated")
                      }
                    />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Launch at login</div>
                    <div className="setting-desc">
                      Starts with the OS and stays in the tray. Off by default.
                    </div>
                  </div>
                  <div className="setting-control">
                    <Switch
                      checked={settings.launchAtLogin}
                      label="Launch at login"
                      disabled={saving}
                      onChange={(value) =>
                        void save({ launchAtLogin: value }, "Startup preference updated")
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="banner info">
                <div className="banner-icon">
                  <Laptop size={16} aria-hidden="true" />
                </div>
                <div>
                  <h3>Explicit quit</h3>
                  <p>
                    Use the tray or menu Quit action to exit. If a timer is running, TempoDesk asks
                    whether to stop and save it or keep it for the next launch.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {section === "shortcuts" ? (
            <div className="settings-section">
              <h2>Global shortcuts</h2>
              <p>
                Work while another app is focused. Registration failures are reported here and
                never block the timer.
              </p>
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Enable global shortcuts</div>
                    <div className="setting-desc">
                      In-app shortcuts (⌘/Ctrl+N, F, comma) always remain available.
                    </div>
                  </div>
                  <div className="setting-control">
                    <Switch
                      checked={settings.shortcutsEnabled}
                      label="Enable global shortcuts"
                      disabled={saving}
                      onChange={(value) =>
                        void save({ shortcutsEnabled: value }, "Shortcut preference updated")
                      }
                    />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Open / hide TempoDesk</div>
                    <div className="setting-desc">Suggested: CommandOrControl+Shift+T</div>
                  </div>
                  <div className="setting-control">
                    <input
                      className="input"
                      value={openShortcut}
                      aria-label="Open or hide shortcut"
                      spellCheck={false}
                      onChange={(event) => setOpenShortcut(event.target.value)}
                    />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Start / stop timer</div>
                    <div className="setting-desc">Suggested: CommandOrControl+Shift+Y</div>
                  </div>
                  <div className="setting-control">
                    <input
                      className="input"
                      value={toggleShortcut}
                      aria-label="Start or stop timer shortcut"
                      spellCheck={false}
                      onChange={(event) => setToggleShortcut(event.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="primary"
                  onClick={() => void saveShortcuts()}
                  disabled={saving}
                >
                  Save shortcuts
                </Button>
                <Button
                  onClick={() => {
                    setOpenShortcut(platform?.openShortcutDefault ?? "CommandOrControl+Shift+T");
                    setToggleShortcut(platform?.toggleShortcutDefault ?? "CommandOrControl+Shift+Y");
                  }}
                >
                  Reset fields
                </Button>
                <Button onClick={onOpenShortcuts}>All shortcuts</Button>
              </div>

              {shortcutStatus?.errors.length ? (
                <div className="banner warning" role="alert">
                  <div className="banner-icon">
                    <Keyboard size={16} aria-hidden="true" />
                  </div>
                  <div>
                    <h3>Some shortcuts are not registered</h3>
                    {shortcutStatus.errors.map((error) => (
                      <p key={error}>{error}</p>
                    ))}
                    <p>The timer still works from the window and tray.</p>
                  </div>
                </div>
              ) : null}
              {shortcutErrors.length > 0 ? (
                <div className="banner warning" role="alert">
                  <div className="banner-icon">
                    <Keyboard size={16} aria-hidden="true" />
                  </div>
                  <div>
                    {shortcutErrors.map((error) => (
                      <p key={error}>{error}</p>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="field-hint">
                Current: open/hide{" "}
                <span className="kbd">{formatShortcut(settings.openShortcut)}</span>, timer{" "}
                <span className="kbd">{formatShortcut(settings.toggleShortcut)}</span>. The OS may
                reserve some combinations; pick another if registration fails.
              </p>
            </div>
          ) : null}

          {section === "idle" ? (
            <div className="settings-section">
              <h2>Idle detection</h2>
              <p>
                Opt-in, off by default, and local-only. TempoDesk asks before changing recorded
                time.
              </p>
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Enable idle detection</div>
                    <div className="setting-desc">
                      {platform?.idleAvailable
                        ? "Uses the OS aggregate idle timer. No keystrokes, window titles, screenshots, or app names are read."
                        : platform?.idleUnavailableReason ??
                          "The OS idle API is not available; the timer continues normally."}
                    </div>
                  </div>
                  <div className="setting-control">
                    <Switch
                      checked={settings.idleTrackingEnabled}
                      label="Enable idle detection"
                      disabled={saving || Boolean(platform && !platform.idleAvailable)}
                      onChange={(value) =>
                        void save({ idleTrackingEnabled: value }, "Idle preference updated")
                      }
                    />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Idle threshold</div>
                    <div className="setting-desc">
                      Ask for review after this many minutes without input (1–60). One review per
                      idle episode.
                    </div>
                  </div>
                  <div className="setting-control">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={60}
                      value={idleThreshold}
                      aria-label="Idle threshold in minutes"
                      disabled={!settings.idleTrackingEnabled || saving}
                      onChange={(event) => setIdleThreshold(Number(event.target.value))}
                      onBlur={() => {
                        if (
                          idleThreshold >= 1 &&
                          idleThreshold <= 60 &&
                          idleThreshold !== settings.idleThresholdMinutes
                        ) {
                          void save(
                            { idleThresholdMinutes: idleThreshold },
                            "Idle threshold updated",
                          );
                        }
                      }}
                    />
                    <span className="field-hint">minutes</span>
                  </div>
                </div>
              </div>
              <div className="card card-pad">
                <div className="setting-title">How reviews work</div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--text-soft)" }}>
                  <li>
                    <strong>Keep the time</strong> leaves the full session intact.
                  </li>
                  <li>
                    <strong>Remove idle gap</strong> ends the session at idle start and starts a
                    new one when you return, preserving both segments.
                  </li>
                  <li>
                    <strong>End at idle start</strong> stops the session when the idle interval
                    began.
                  </li>
                </ul>
                <p className="field-hint" style={{ marginTop: 8 }}>
                  There is no auto-deletion setting. Pending reviews stay visible until you choose.
                  Sleep and clock gaps are also queued for review.
                </p>
              </div>
            </div>
          ) : null}

          {section === "reminders" ? (
            <div className="settings-section">
              <h2>Tracking reminders</h2>
              <p>
                A gentle nudge when you haven't started a timer for a while. Off by default and
                fully local.
              </p>
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Remind me when I'm not tracking</div>
                    <div className="setting-desc">
                      One notification per episode, so it never spams. Starting a timer re-arms the
                      reminder.
                    </div>
                  </div>
                  <div className="setting-control">
                    <Switch
                      checked={settings.trackingReminderEnabled}
                      label="Remind me when I'm not tracking"
                      disabled={saving}
                      onChange={(value) =>
                        void save(
                          { trackingReminderEnabled: value },
                          value ? "Tracking reminders enabled" : "Tracking reminders disabled",
                        )
                      }
                    />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Remind after</div>
                    <div className="setting-desc">
                      How long without a running timer before the notification (5–480 minutes).
                    </div>
                  </div>
                  <div className="setting-control">
                    <input
                      className="input"
                      type="number"
                      min={5}
                      max={480}
                      value={reminderMinutes}
                      aria-label="Tracking reminder delay in minutes"
                      disabled={!settings.trackingReminderEnabled || saving}
                      onChange={(event) => setReminderMinutes(Number(event.target.value))}
                      onBlur={() => {
                        if (
                          reminderMinutes >= 5 &&
                          reminderMinutes <= 480 &&
                          reminderMinutes !== settings.trackingReminderMinutes
                        ) {
                          void save(
                            { trackingReminderMinutes: reminderMinutes },
                            "Reminder delay updated",
                          );
                        }
                      }}
                    />
                    <span className="field-hint">minutes</span>
                  </div>
                </div>
              </div>
              <p className="field-hint">
                Reminders appear as a native notification with an in-app toast as fallback. They
                only depend on the local timer state, never on account or network.
              </p>
            </div>
          ) : null}

          {section === "ai" ? (
            <div className="settings-section">
              <h2>AI summaries</h2>
              <p>
                Optional high-level summaries for a day, week, or month. Local summaries work fully
                offline; AI summaries use your own Google Gemini API key.
              </p>
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Enable AI summaries</div>
                    <div className="setting-desc">
                      Off by default. Local summaries remain available without enabling this.
                    </div>
                  </div>
                  <div className="setting-control">
                    <Switch
                      checked={settings.aiSummariesEnabled}
                      label="Enable AI summaries"
                      disabled={saving}
                      onChange={(value) =>
                        void save({ aiSummariesEnabled: value }, "AI preference updated")
                      }
                    />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Provider</div>
                    <div className="setting-desc">
                      Gemini is the supported provider in this version. The endpoint is fixed to
                      Google’s Generative Language API.
                    </div>
                  </div>
                  <div className="setting-control">
                    <select
                      className="select"
                      aria-label="AI provider"
                      value={settings.aiProvider}
                      disabled
                    >
                      <option value="gemini">Google Gemini</option>
                    </select>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Model</div>
                    <div className="setting-desc">
                      Example: gemini-2.5-flash. Use a model enabled for your API key.
                    </div>
                  </div>
                  <div className="setting-control">
                    <input
                      className="input"
                      aria-label="Gemini model"
                      value={aiModelInput}
                      spellCheck={false}
                      onChange={(event) => setAiModelInput(event.target.value)}
                    />
                    <Button size="sm" onClick={() => void saveAiModel()} disabled={saving}>
                      Save
                    </Button>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Include task descriptions in AI requests</div>
                    <div className="setting-desc">
                      When off, only dates, totals, projects, clients, and tags are sent. Local
                      summaries always use your local descriptions.
                    </div>
                  </div>
                  <div className="setting-control">
                    <Switch
                      checked={settings.aiIncludeDescriptions}
                      label="Include task descriptions in AI requests"
                      disabled={saving}
                      onChange={(value) =>
                        void save(
                          { aiIncludeDescriptions: value },
                          "AI description preference updated",
                        )
                      }
                    />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <label className="check" style={{ alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={settings.aiConsent}
                        disabled={saving}
                        onChange={(event) =>
                          void save(
                            { aiConsent: event.target.checked },
                            event.target.checked ? "AI data-sharing notice accepted" : "AI consent withdrawn",
                          )
                        }
                      />
                      <span>
                        I understand that when I click <strong>Generate AI summary</strong>,
                        TempoDesk sends the selected range’s aggregated timesheet data
                        {settings.aiIncludeDescriptions ? ", including task descriptions," : ""}{" "}
                        to Google Gemini. No data is sent in the background.
                      </span>
                    </label>
                  </div>
                  <div className="setting-control">
                    <span
                      className={`badge ${settings.aiConsent ? "badge-teal" : "badge-danger"}`}
                    >
                      {settings.aiConsent ? "Consent recorded" : "Consent required"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">
                      Gemini API key{" "}
                      <span
                        className={`badge ${
                          aiStatus?.keyConfigured ? "badge-teal" : "badge-danger"
                        }`}
                      >
                        <KeyRound size={11} aria-hidden="true" />{" "}
                        {aiStatus?.keyConfigured ? "Configured" : "Not configured"}
                      </span>
                    </div>
                    <div className="setting-desc">
                      Stored in the OS credential store (Windows Credential Manager / macOS
                      Keychain). It is never returned by the app API, shown in logs, or included in
                      backups.
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9 }}>
                      <input
                        type="password"
                        className="input"
                        style={{ width: 280 }}
                        aria-label="Gemini API key"
                        placeholder={
                          aiStatus?.keyConfigured
                            ? "•••••••• configured — paste a new key to replace"
                            : "Paste your Gemini API key"
                        }
                        value={aiKeyInput}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => setAiKeyInput(event.target.value)}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void saveAiKey()}
                        disabled={aiKeyBusy || !aiKeyInput.trim()}
                      >
                        {aiKeyBusy ? "Saving…" : "Save key"}
                      </Button>
                      {aiStatus?.keyConfigured ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => void testAi()}
                            disabled={aiTestBusy}
                            icon={
                              aiTestBusy ? (
                                <Loader2 size={13} aria-hidden="true" className="spin" />
                              ) : undefined
                            }
                          >
                            {aiTestBusy ? "Testing…" : "Test connection"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void removeAiKey()}
                            disabled={aiKeyBusy}
                          >
                            Remove key
                          </Button>
                        </>
                      ) : null}
                    </div>
                    {aiStatus?.keyError ? (
                      <div className="dialog-error" role="alert" style={{ marginTop: 10 }}>
                        <span>{aiStatus.keyError}</span>
                      </div>
                    ) : null}
                    {aiKeyMessage ? (
                      <div
                        className="banner info"
                        role="status"
                        style={{ marginTop: 10, padding: "8px 10px" }}
                      >
                        <p style={{ margin: 0 }}>{aiKeyMessage}</p>
                      </div>
                    ) : null}
                    {aiTestResult ? (
                      <div className="banner info" role="status" style={{ marginTop: 10 }}>
                        <div>
                          <h3>{aiTestResult.message}</h3>
                          <p>
                            {aiTestResult.model} · {aiTestResult.latencyMs} ms
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="banner info">
                <div className="banner-icon">
                  <ShieldCheck size={16} aria-hidden="true" />
                </div>
                <div>
                  <h3>Network and privacy</h3>
                  <p>
                    AI summaries are the only network feature. A request is made only when you
                    click Generate, never in the background. Create a Gemini key in Google AI
                    Studio (aistudio.google.com/app/apikey). Without a key, daily/weekly/monthly
                    summaries still work locally and fully offline.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {section === "data" ? (
            <div className="settings-section">
              <h2>Data & backup</h2>
              <p>
                Everything is stored in a local SQLite database with WAL journaling and foreign
                keys.
              </p>
              <AutoBackupPanel />
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Backup all data</div>
                    <div className="setting-desc">
                      Versioned JSON with clients, projects, tags, entries, task templates, and settings.
                      Choose the destination with a native save dialog.
                    </div>
                  </div>
                  <div className="setting-control">
                    <Button
                      icon={<Download size={14} aria-hidden="true" />}
                      onClick={() => void backup()}
                      disabled={backupBusy}
                    >
                      {backupBusy ? "Saving…" : "Back up"}
                    </Button>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Restore from backup</div>
                    <div className="setting-desc">
                      Validates the file, previews counts, then restores transactionally. A safety
                      backup is created first.
                    </div>
                  </div>
                  <div className="setting-control">
                    <Button
                      icon={<Upload size={14} aria-hidden="true" />}
                      onClick={() => void chooseRestore()}
                    >
                      Restore…
                    </Button>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Database location</div>
                    <div className="setting-desc mono">{platform?.dbPath ?? "…"}</div>
                  </div>
                  <div className="setting-control">
                    <span className="badge">
                      <HardDrive size={11} aria-hidden="true" /> Local
                    </span>
                  </div>
                </div>
              </div>
              <div className="banner warning">
                <div className="banner-icon">
                  <Archive size={16} aria-hidden="true" />
                </div>
                <div>
                  <h3>Backups contain sensitive work names</h3>
                  <p>
                    Descriptions, project names, and client names are plain text in the backup.
                    Store the file somewhere private. Backups are never uploaded.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {section === "privacy" ? (
            <div className="settings-section">
              <h2>Privacy</h2>
              <p>Privacy by default is a product requirement, not a setting.</p>
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">No background network calls</div>
                    <div className="setting-desc">
                      TempoDesk makes no network requests unless you explicitly generate an AI
                      summary. There is no account, cloud sync, analytics, or telemetry.
                    </div>
                  </div>
                  <div className="setting-control">
                    <WifiOff size={16} aria-hidden="true" />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">No surveillance features</div>
                    <div className="setting-desc">
                      No screenshots, keystrokes, URLs, document titles, app-activity tracking, or
                      GPS. Idle detection is opt-in and reads only the aggregate idle timer.
                    </div>
                  </div>
                  <div className="setting-control">
                    <LockKeyhole size={16} aria-hidden="true" />
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Local database</div>
                    <div className="setting-desc">
                      The database lives in your OS app-data directory with user-level file
                      permissions. The frontend has no arbitrary SQL or shell access.
                    </div>
                  </div>
                  <div className="setting-control">
                    <ShieldCheck size={16} aria-hidden="true" />
                  </div>
                </div>
              </div>
              <p className="field-hint">
                To remove all data, delete the database file shown above while TempoDesk is
                closed. Create a backup first if you may need the data.
              </p>
            </div>
          ) : null}

          {section === "about" ? (
            <div className="settings-section">
              <h2>About TempoDesk</h2>
              <p>An original, local-first desktop time tracker.</p>
              <div className="card">
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Version</div>
                    <div className="setting-desc">TempoDesk {platform?.appVersion ?? "0.2.0"}</div>
                  </div>
                  <div className="setting-control">
                    <span className="badge">MVP</span>
                  </div>
                </div>
                {platform && platform.dataProfile !== "production" ? (
                  <div className="setting-row">
                    <div className="setting-main">
                      <div className="setting-title">Data profile</div>
                      <div className="setting-desc">
                        This is a {platform.dataProfile} build. It uses a separate data directory
                        and cannot read or modify the installed app's data.
                      </div>
                    </div>
                    <div className="setting-control">
                      <span className="badge badge-accent">{platform.dataProfile}</span>
                    </div>
                  </div>
                ) : null}
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Platform</div>
                    <div className="setting-desc">
                      {platform?.platform ?? "unknown"} · native titlebar, tray, notifications,
                      global shortcuts
                    </div>
                  </div>
                  <div className="setting-control">
                    <span className="badge">
                      <Monitor size={11} aria-hidden="true" /> Desktop
                    </span>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Built with</div>
                    <div className="setting-desc">
                      Tauri 2 · React · TypeScript · Rust · SQLite. Business logic and persistence
                      stay in Rust behind typed IPC.
                    </div>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-main">
                    <div className="setting-title">Data directory</div>
                    <div className="setting-desc mono">{platform?.dataDir ?? "…"}</div>
                  </div>
                </div>
              </div>
              <div className="banner info">
                <div className="banner-icon">
                  <Check size={16} aria-hidden="true" />
                </div>
                <div>
                  <h3>Offline-first definition of done</h3>
                  <p>
                    Timer, manual entries, organization, timesheets, reports, CSV, backup, and
                    restore all work with no network connection.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(preview)}
        title="Restore this backup?"
        description="This replaces all current clients, projects, tags, entries, task templates, and settings. A safety backup is created first. Automatic backups are turned off after restore so you can choose a folder for this device."
        confirmLabel={restoring ? "Restoring…" : "Restore backup"}
        busy={restoring}
        onCancel={() => {
          setPreview(null);
          setRestoreSource(null);
        }}
        onConfirm={() => void confirmRestore()}
      >
        {preview ? (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 8,
                marginBottom: 12,
                fontSize: 12.5,
              }}
            >
              <span>Entries: <strong>{preview.counts.entries}</strong></span>
              <span>Projects: <strong>{preview.counts.projects}</strong></span>
              <span>Clients: <strong>{preview.counts.clients}</strong></span>
              <span>Tags: <strong>{preview.counts.tags}</strong></span>
              <span>Templates: <strong>{preview.counts.templates}</strong></span>
              <span>Settings: <strong>{preview.counts.settings}</strong></span>
              <span>
                Created:{" "}
                <strong>
                  {new Date(preview.createdAtUtc).toLocaleDateString()}
                </strong>
              </span>
            </div>
            <p className="mono" style={{ margin: 0, color: "var(--muted)" }}>
              {preview.source}
            </p>
            <p className="field-hint" style={{ marginTop: 8 }}>
              Backup app version {preview.appVersion}. If any entry or relationship fails
              validation, nothing is changed.
            </p>
          </div>
        ) : null}
      </ConfirmDialog>

    </>
  );
}
