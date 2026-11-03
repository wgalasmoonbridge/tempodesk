import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, normalizeError } from "../lib/ipc";
import type {
  AiStatus,
  AppSettings,
  AppStatus,
  Client,
  IdleReview,
  PlatformInfo,
  Project,
  SettingsPatch,
  SettingsUpdateResult,
  ShortcutStatus,
  Tag,
} from "../lib/types";
import { effectiveTimeZone } from "../lib/time";
import { useAppliedTheme } from "./theme";
import { useToast } from "../components/Toast";

const DEFAULT_SETTINGS: AppSettings = {
  autoBackupEnabled: false,
  autoBackupDirectory: "",
  autoBackupRetention: 14,
  theme: "system",
  startOfWeek: "monday",
  timezone: "system",
  timeFormat: "auto",
  closeToTray: true,
  launchAtLogin: false,
  idleTrackingEnabled: false,
  idleThresholdMinutes: 5,
  trackingReminderEnabled: false,
  trackingReminderMinutes: 30,
  shortcutsEnabled: true,
  openShortcut: "CommandOrControl+Shift+T",
  toggleShortcut: "CommandOrControl+Shift+Y",
  onboardingComplete: false,
  trayExplained: false,
  aiSummariesEnabled: false,
  aiProvider: "gemini",
  aiModel: "gemini-2.5-flash",
  aiConsent: false,
  aiIncludeDescriptions: true,
};

interface AppContextValue {
  ready: boolean;
  loadError: string | null;
  settings: AppSettings;
  platform: PlatformInfo | null;
  timezone: string;
  status: AppStatus | null;
  projects: Project[];
  clients: Client[];
  tags: Tag[];
  idleReviews: IdleReview[];
  shortcutStatus: ShortcutStatus | null;
  aiStatus: AiStatus | null;
  dataVersion: number;
  updateSettings: (patch: SettingsPatch) => Promise<SettingsUpdateResult>;
  refreshStatus: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshIdle: () => Promise<void>;
  refreshAiStatus: () => Promise<void>;
  refreshAll: () => Promise<void>;
  setStatus: (status: AppStatus) => void;
  bumpData: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { pushToast } = useToast();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [idleReviews, setIdleReviews] = useState<IdleReview[]>([]);
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const timezone = effectiveTimeZone(settings.timezone);
  useAppliedTheme(settings.theme);

  useEffect(() => {
    document.documentElement.dataset.platform = platform?.platform ?? "unknown";
  }, [platform]);

  const bumpData = useCallback(() => setDataVersion((value) => value + 1), []);

  const refreshStatus = useCallback(async () => {
    try {
      const tz = effectiveTimeZone(settingsRef.current.timezone);
      const next = await api.getAppStatus(tz);
      setStatus(next);
    } catch (error) {
      const normalized = normalizeError(error);
      if (!normalized.message.includes("not a function")) {
        setLoadError(normalized.message);
      }
    }
  }, []);

  const refreshMeta = useCallback(async () => {
    const [nextProjects, nextClients, nextTags] = await Promise.all([
      api.listProjects(false),
      api.listClients(false),
      api.listTags(false),
    ]);
    setProjects(nextProjects);
    setClients(nextClients);
    setTags(nextTags);
  }, []);

  const refreshIdle = useCallback(async () => {
    try {
      const reviews = await api.getPendingIdleReviews();
      setIdleReviews(reviews);
    } catch (error) {
      const normalized = normalizeError(error);
      pushToast({
        title: "Could not load idle reviews",
        message: normalized.message,
        tone: "error",
      });
    }
  }, [pushToast]);

  const refreshAiStatus = useCallback(async () => {
    try {
      setAiStatus(await api.getAiStatus());
    } catch {
      /* Diagnostic only; key errors are reported inside AiStatus when available. */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshMeta(), refreshIdle(), refreshAiStatus()]);
  }, [refreshStatus, refreshMeta, refreshIdle, refreshAiStatus]);

  const updateSettings = useCallback(
    async (patch: SettingsPatch) => {
      const result = await api.updateSettings(patch);
      setSettings(result.settings);
      bumpData();
      void refreshAiStatus();
      return result;
    },
    [bumpData, refreshAiStatus],
  );

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [info, loadedSettings] = await Promise.all([
          api.getPlatformInfo(),
          api.getSettings(),
        ]);
        if (cancelled) return;
        setPlatform(info);
        setSettings(loadedSettings);
        const tz = effectiveTimeZone(loadedSettings.timezone);
        const [nextStatus, nextProjects, nextClients, nextTags, reviews] =
          await Promise.all([
            api.getAppStatus(tz),
            api.listProjects(false),
            api.listClients(false),
            api.listTags(false),
            api.getPendingIdleReviews(),
          ]);
        if (cancelled) return;
        setStatus(nextStatus);
        setProjects(nextProjects);
        setClients(nextClients);
        setTags(nextTags);
        setIdleReviews(reviews);
        try {
          setShortcutStatus(await api.getShortcutStatus());
        } catch {
          /* shortcut status is diagnostic only */
        }
        try {
          setAiStatus(await api.getAiStatus());
        } catch {
          /* AI/keychain status is diagnostic only */
        }
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        setLoadError(normalizeError(error).message);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Typed backend events.
  useEffect(() => {
    let disposed = false;
    const unsubs: (() => void)[] = [];
    const add = async (
      event: string,
      handler: (payload: unknown) => void,
    ) => {
      try {
        const unlisten = await listen(event, (message) => handler(message.payload));
        if (disposed) unlisten();
        else unsubs.push(unlisten);
      } catch {
        /* non-Tauri test/browser environment */
      }
    };

    void add("timer-state-changed", () => {
      void refreshStatus();
      bumpData();
    });
    void add("entries-changed", () => {
      void refreshStatus();
      bumpData();
    });
    void add("data-changed", () => {
      void refreshStatus();
      void refreshMeta();
      bumpData();
    });
    void add("settings-changed", (payload) => {
      if (payload && typeof payload === "object") {
        setSettings(payload as AppSettings);
        bumpData();
        void refreshAiStatus();
      }
    });
    void add("idle-review-required", () => {
      void refreshIdle();
      void refreshStatus();
    });
    void add("tracking-reminder", () => {
      pushToast({
        title: "Track your time",
        message: "You haven't started a timer in a while. Start one to keep accurate records.",
        tone: "info",
      });
    });
    void add("shortcut-status", (payload) => {
      setShortcutStatus(payload as ShortcutStatus);
    });
    void add("window-focused", () => {
      void refreshStatus();
      void refreshIdle();
      void refreshAiStatus();
    });
    void add("app-error", (payload) => {
      if (payload && typeof payload === "object") {
        const info = payload as { message?: string };
        pushToast({
          title: "Action failed",
          message: info.message ?? "Please try again.",
          tone: "error",
        });
      }
    });

    return () => {
      disposed = true;
      for (const unlisten of unsubs) unlisten();
    };
  }, [refreshStatus, refreshMeta, refreshIdle, refreshAiStatus, bumpData, pushToast]);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      loadError,
      settings,
      platform,
      timezone,
      status,
      projects,
      clients,
      tags,
      idleReviews,
      shortcutStatus,
      aiStatus,
      dataVersion,
      updateSettings,
      refreshStatus,
      refreshMeta,
      refreshIdle,
      refreshAiStatus,
      refreshAll,
      setStatus,
      bumpData,
    }),
    [
      ready,
      loadError,
      settings,
      platform,
      timezone,
      status,
      projects,
      clients,
      tags,
      idleReviews,
      shortcutStatus,
      aiStatus,
      dataVersion,
      updateSettings,
      refreshStatus,
      refreshMeta,
      refreshIdle,
      refreshAiStatus,
      refreshAll,
      bumpData,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppData(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppData must be used inside AppProvider");
  return context;
}
