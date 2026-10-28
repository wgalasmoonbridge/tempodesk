import { useEffect, useState } from "react";
import {
  Bell,
  BellRing,
  Check,
  FolderKanban,
  LockKeyhole,
  Plus,
  Timer,
  WifiOff,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Switch } from "../../components/Switch";
import { ColorSwatches } from "../../components/ColorSwatches";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import { formatShortcut } from "../../lib/time";
import { validateName } from "../../lib/validators";

type Step = 0 | 1 | 2;

export function Onboarding() {
  const { platform, settings, updateSettings, refreshMeta } = useAppData();
  const { pushToast } = useToast();
  const [step, setStep] = useState<Step>(0);
  const [projectName, setProjectName] = useState("");
  const [projectColor, setProjectColor] = useState("#4f46e5");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [idleEnabled, setIdleEnabled] = useState(false);
  const [idleThreshold, setIdleThreshold] = useState(5);
  const [notificationsGranted, setNotificationsGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
        setNotificationsGranted(await isPermissionGranted());
      } catch {
        setNotificationsGranted(null);
      }
    })();
  }, []);

  const requestNotifications = async () => {
    try {
      const { requestPermission } = await import("@tauri-apps/plugin-notification");
      const result = await requestPermission();
      setNotificationsGranted(result === "granted");
      pushToast({
        title: result === "granted" ? "Notifications enabled" : "Notifications not enabled",
        message:
          result === "granted"
            ? "Idle reviews and reminders can appear as native notifications."
            : "TempoDesk will use in-app banners instead. You can change this in OS settings.",
        tone: result === "granted" ? "success" : "warning",
      });
    } catch (error) {
      pushToast({
        title: "Could not request notification permission",
        message: normalizeError(error).message,
        tone: "error",
      });
    }
  };

  const finish = async (skipped: boolean) => {
    setFinishing(true);
    try {
      const result = await updateSettings({
        onboardingComplete: true,
        trayExplained: true,
        ...(skipped
          ? {}
          : {
              closeToTray,
              launchAtLogin,
              idleTrackingEnabled: idleEnabled,
              idleThresholdMinutes: idleThreshold,
            }),
      });
      for (const warning of result.warnings) {
        pushToast({ title: "Preference saved with a warning", message: warning, tone: "warning" });
      }
      pushToast({
        title: "You're all set",
        message: "Start a timer from the main window or the tray. Everything stays local.",
        tone: "success",
      });
    } catch (error) {
      pushToast({
        title: "Could not save onboarding preferences",
        message: normalizeError(error).message,
        tone: "error",
      });
    } finally {
      setFinishing(false);
    }
  };

  const skipAll = async () => {
    await finish(true);
    pushToast({
      title: "TempoDesk stays in the tray",
      message:
        "Closing the window hides it while the process keeps running. Change this in Settings → Tray & startup.",
      tone: "info",
      duration: 9000,
    });
  };

  const createProject = async () => {
    const error = validateName(projectName, "Project", 120);
    if (error) {
      setProjectError(error);
      return;
    }
    setCreating(true);
    try {
      await api.saveProject({
        name: projectName.trim(),
        color: projectColor,
        clientId: null,
        defaultBillable: false,
      });
      await refreshMeta();
      pushToast({ title: "Project created", message: projectName.trim(), tone: "success" });
      setProjectName("");
      setStep(2);
    } catch (err) {
      setProjectError(normalizeError(err).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => void skipAll()}
      title="Welcome to TempoDesk"
      description="Private, local-first time tracking — no account and no cloud."
      wide
      dismissible={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => void skipAll()} disabled={finishing}>
            Skip setup
          </Button>
          <span className="spacer" />
          {step > 0 ? (
            <Button onClick={() => setStep((step - 1) as Step)} disabled={finishing}>
              Back
            </Button>
          ) : null}
          {step === 0 ? (
            <Button variant="primary" onClick={() => setStep(1)} data-autofocus>
              Get started
            </Button>
          ) : null}
          {step === 1 ? (
            <>
              <Button onClick={() => setStep(2)} disabled={creating}>
                Skip project
              </Button>
              <Button
                variant="primary"
                onClick={() => void createProject()}
                disabled={creating}
                icon={<Plus size={14} aria-hidden="true" />}
              >
                {creating ? "Creating…" : "Create project"}
              </Button>
            </>
          ) : null}
          {step === 2 ? (
            <Button
              variant="primary"
              onClick={() => void finish(false)}
              disabled={finishing}
              data-autofocus
            >
              {finishing ? "Saving…" : "Start tracking"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="onboarding-steps" aria-hidden="true">
        <span className={step >= 0 ? "active" : ""} />
        <span className={step >= 1 ? "active" : ""} />
        <span className={step >= 2 ? "active" : ""} />
      </div>

      {step === 0 ? (
        <div>
          <div className="welcome-hero">
            <div className="welcome-mark" aria-hidden="true" />
            <div>
              <h2 style={{ fontSize: 18 }}>Fast, quiet time tracking for your desktop</h2>
              <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
                TempoDesk lives in the tray, tracks one session at a time, and keeps every record
                in a local SQLite database.
              </p>
            </div>
          </div>
          <div className="feature-list">
            <div className="feature-item">
              <Timer size={15} aria-hidden="true" />
              <span>One timer with atomic task switching, resume, and crash recovery.</span>
            </div>
            <div className="feature-item">
              <FolderKanban size={15} aria-hidden="true" />
              <span>Projects, clients, tags, billable flags, timesheets, and CSV reports.</span>
            </div>
            <div className="feature-item">
              <WifiOff size={15} aria-hidden="true" />
              <span>No account, no network calls, no telemetry — works completely offline.</span>
            </div>
            <div className="feature-item">
              <LockKeyhole size={15} aria-hidden="true" />
              <span>
                Idle detection is off by default. No screenshots, keystrokes, or app monitoring.
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div>
          <h2 style={{ fontSize: 16 }}>Create your first project (optional)</h2>
          <p style={{ color: "var(--muted)", fontSize: 12.5 }}>
            Projects keep reports readable. You can start without one and add projects later.
          </p>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <div className="span-2">
              <Field label="Project name" error={projectError}>
                {(props) => (
                  <input
                    {...props}
                    className={`input${projectError ? " invalid" : ""}`}
                    data-autofocus
                    value={projectName}
                    maxLength={120}
                    placeholder="e.g. Client website"
                    onChange={(event) => {
                      setProjectName(event.target.value);
                      setProjectError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createProject();
                      }
                    }}
                  />
                )}
              </Field>
            </div>
            <div className="span-2 field">
              <span className="field-label">Color</span>
              <ColorSwatches value={projectColor} onChange={setProjectColor} />
            </div>
          </div>
          <p className="field-hint" style={{ marginTop: 10 }}>
            No sample time entries are created. Your history starts empty and accurate.
          </p>
        </div>
      ) : null}

      {step === 2 ? (
        <div>
          <h2 style={{ fontSize: 16 }}>Desktop preferences</h2>
          <p style={{ color: "var(--muted)", fontSize: 12.5 }}>
            Optional and changeable at any time in Settings.
          </p>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="setting-row">
              <div className="setting-main">
                <div className="setting-title">Close window to tray</div>
                <div className="setting-desc">
                  Closing the window hides TempoDesk while a timer keeps running. Quit explicitly
                  from the tray or menu.
                </div>
              </div>
              <Switch
                checked={closeToTray}
                onChange={setCloseToTray}
                label="Close window to tray"
              />
            </div>
            <div className="setting-row">
              <div className="setting-main">
                <div className="setting-title">Launch at login</div>
                <div className="setting-desc">Off by default. Starts hidden with the tray.</div>
              </div>
              <Switch
                checked={launchAtLogin}
                onChange={setLaunchAtLogin}
                label="Launch at login"
              />
            </div>
            <div className="setting-row">
              <div className="setting-main">
                <div className="setting-title">Idle detection</div>
                <div className="setting-desc">
                  Off by default. When enabled, TempoDesk asks how to handle time when no input
                  was detected. It never deletes time silently.
                  {platform && !platform.idleAvailable
                    ? ` Unavailable: ${platform.idleUnavailableReason ?? "OS API unavailable"}.`
                    : ""}
                </div>
              </div>
              <div className="setting-control">
                <select
                  className="select"
                  style={{ minWidth: 90 }}
                  value={idleThreshold}
                  disabled={!idleEnabled}
                  aria-label="Idle threshold in minutes"
                  onChange={(event) => setIdleThreshold(Number(event.target.value))}
                >
                  {[1, 2, 5, 10, 15, 20, 30, 45, 60].map((value) => (
                    <option key={value} value={value}>
                      {value} min
                    </option>
                  ))}
                </select>
                <Switch
                  checked={idleEnabled}
                  onChange={setIdleEnabled}
                  label="Enable idle detection"
                  disabled={Boolean(platform && !platform.idleAvailable)}
                />
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-main">
                <div className="setting-title">Native notifications</div>
                <div className="setting-desc">
                  Used for idle review reminders. If denied, in-app banners still work.
                </div>
              </div>
              <div className="setting-control">
                {notificationsGranted ? (
                  <span className="badge badge-teal">
                    <Check size={11} aria-hidden="true" /> Granted
                  </span>
                ) : (
                  <Button
                    size="sm"
                    icon={<Bell size={13} aria-hidden="true" />}
                    onClick={() => void requestNotifications()}
                  >
                    Allow notifications
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="card card-pad" style={{ marginTop: 12 }}>
            <div className="setting-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <BellRing size={14} aria-hidden="true" /> Your global shortcuts
            </div>
            <p className="field-hint" style={{ marginTop: 5 }}>
              Open/hide: <span className="kbd">{formatShortcut(settings.openShortcut)}</span> ·
              Start/stop: <span className="kbd">{formatShortcut(settings.toggleShortcut)}</span>.
              Conflicts are reported in Settings and never crash the app.
            </p>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
