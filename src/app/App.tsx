import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  CircleHelp,
  Command,
  FolderKanban,
  Plus,
  Search,
  Settings,
  Tags,
  Timer,
  Building2,
  X,
} from "lucide-react";
import { useAppData } from "./AppProvider";
import { NavigationContext } from "./navigation";
import type { Route } from "./navigation";
import { Button, IconButton } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { TrackerPage } from "../features/timer/TrackerPage";
import { TimesheetPage } from "../features/timesheet/TimesheetPage";
import { CalendarPage } from "../features/calendar/CalendarPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { ClientsPage } from "../features/clients/ClientsPage";
import { TagsPage } from "../features/tags/TagsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { EntryDialog } from "../features/entries/EntryDialog";
import { Onboarding } from "../features/onboarding/Onboarding";
import { RecoveryModal } from "../features/timer/RecoveryModal";
import { QuitDialog } from "../features/settings/QuitDialog";
import { ShortcutsDialog } from "../features/settings/ShortcutsDialog";
import { formatDateLong, todayKey } from "../lib/time";
import { SharingBanner } from "../features/sharing/SharingProvider";

const NAV_ITEMS: { route: Route; label: string; icon: typeof Timer; group: string }[] = [
  { route: "tracker", label: "Time Tracker", icon: Timer, group: "Track" },
  { route: "timesheet", label: "Timesheet", icon: CalendarDays, group: "Track" },
  { route: "calendar", label: "Calendar", icon: CalendarRange, group: "Track" },
  { route: "reports", label: "Reports", icon: BarChart3, group: "Track" },
  { route: "projects", label: "Projects", icon: FolderKanban, group: "Organize" },
  { route: "clients", label: "Clients", icon: Building2, group: "Organize" },
  { route: "tags", label: "Tags", icon: Tags, group: "Organize" },
];

const PAGE_TITLES: Record<Route, string> = {
  tracker: "Time Tracker",
  timesheet: "Timesheet",
  calendar: "Calendar",
  reports: "Reports",
  projects: "Projects",
  clients: "Clients",
  tags: "Tags",
  settings: "Settings",
};

export function App() {
  const {
    ready,
    loadError,
    settings,
    timezone,
    status,
    idleReviews,
    refreshAll,
  } = useAppData();

  const [route, setRoute] = useState<Route>("tracker");
  const [search, setSearch] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDefaults, setManualDefaults] = useState<{
    date?: string;
    projectId?: string;
    description?: string;
  }>({});
  const [quitOpen, setQuitOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const navigate = (next: Route) => {
    setRoute(next);
    document.querySelector(".content")?.scrollTo({ top: 0 });
  };

  const requestNewEntry = (defaults?: {
    date?: string;
    projectId?: string;
    description?: string;
  }) => {
    setManualDefaults(defaults ?? {});
    setManualOpen(true);
  };

  useEffect(() => {
    let disposed = false;
    const unsubs: (() => void)[] = [];
    const add = async (event: string, handler: (payload: unknown) => void) => {
      try {
        const unlisten = await listen(event, (message) => handler(message.payload));
        if (disposed) unlisten();
        else unsubs.push(unlisten);
      } catch {
        /* ignore outside Tauri */
      }
    };
    void add("navigate", (payload) => {
      if (typeof payload === "string" && payload in PAGE_TITLES) {
        setRoute(payload as Route);
      }
    });
    void add("new-entry", () => {
      setRoute("tracker");
      requestNewEntry();
    });
    void add("focus-search", () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
    void add("quit-requested", () => setQuitOpen(true));
    void add("show-shortcuts", () => setShortcutsOpen(true));
    return () => {
      disposed = true;
      for (const unlisten of unsubs) unlisten();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        requestNewEntry();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === ",") {
        event.preventDefault();
        navigate("settings");
      } else if (event.key === "/" && event.shiftKey) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const groups = Array.from(new Set(NAV_ITEMS.map((item) => item.group)));
  const today = todayKey(timezone);
  const active = status?.activeEntry ?? null;

  return (
    <NavigationContext.Provider
      value={{ route, navigate, search, setSearch, requestNewEntry, focusSearch: () => searchRef.current?.focus() }}
    >
      <div className="app">
        <aside className="sidebar" aria-label="Main navigation">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true" />
            <div className="brand-text">
              <div className="brand-name">TempoDesk</div>
              <div className="brand-sub">Local time tracking</div>
            </div>
          </div>

          {groups.map((group) => (
            <div key={group}>
              <div className="nav-group-label">{group}</div>
              <nav>
                {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.route}
                      type="button"
                      className="nav-item"
                      aria-label={item.label}
                      title={item.label}
                      aria-current={route === item.route ? "page" : undefined}
                      onClick={() => navigate(item.route)}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}

          <div className="nav-group-label">Application</div>
          <button
            type="button"
            className="nav-item"
            aria-label="Settings"
            title="Settings"
            aria-current={route === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            <Settings size={16} aria-hidden="true" />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="nav-item"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            <CircleHelp size={16} aria-hidden="true" />
            <span>Shortcuts</span>
          </button>

          <div
            className="sidebar-footer"
            title={active ? "Timer running" : "Local data, no sync"}
            aria-label={active ? "Timer running" : "Local data, no sync"}
          >
            <span className={`status-dot${active ? " busy" : ""}`} aria-hidden="true" />
            <span>{active ? "Timer running" : "Local data · no sync"}</span>
          </div>
        </aside>

        <main className="main">
          <header className="header">
            <div className="header-title" aria-hidden="true">
              TempoDesk
            </div>
            <div className="header-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={search}
                placeholder="Search descriptions"
                aria-label="Search time entries by description"
                onChange={(event) => {
                  setSearch(event.target.value);
                  if (route !== "tracker" && event.target.value) setRoute("tracker");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setRoute("tracker");
                }}
              />
              {search ? (
                <IconButton
                  label="Clear search"
                  className="search-clear"
                  icon={<X size={13} aria-hidden="true" />}
                  onClick={() => setSearch("")}
                />
              ) : null}
            </div>
            <div className="header-today">
              <CalendarDays size={14} aria-hidden="true" />
              {formatDateLong(today)}
            </div>
            <Button
              size="sm"
              icon={<Plus size={14} aria-hidden="true" />}
              onClick={() => requestNewEntry()}
            >
              Manual entry
            </Button>
            <IconButton
              label="Settings"
              icon={<Settings size={16} aria-hidden="true" />}
              onClick={() => navigate("settings")}
            />
          </header>

          <div className="content">
            <SharingBanner />
            {!ready ? (
              <div className="page">
                <EmptyState
                  icon={<Timer size={28} aria-hidden="true" />}
                  title="Opening your local workspace"
                  description="Loading the SQLite database and settings."
                />
              </div>
            ) : loadError ? (
              <div className="page">
                <div className="card card-pad">
                  <EmptyState
                    icon={<Command size={26} aria-hidden="true" />}
                    title="TempoDesk could not start"
                    description={loadError}
                    action={
                      <Button onClick={() => void refreshAll()} variant="primary">
                        Retry
                      </Button>
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="page">
                {idleReviews.length > 0 && route !== "settings" && route !== "tracker" ? (
                  <div className="banner warning" role="status">
                    <div className="banner-icon">
                      <Timer size={17} aria-hidden="true" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <h3>Idle time needs your review</h3>
                      <p>
                        TempoDesk detected {idleReviews.length} paused{" "}
                        {idleReviews.length === 1 ? "interval" : "intervals"}. Open the tracker to
                        keep the time, remove the idle gap, or end the session at idle start.
                      </p>
                      <div className="banner-actions">
                        <Button size="sm" onClick={() => navigate("tracker")}>
                          Review now
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {route === "tracker" ? <TrackerPage /> : null}
                {route === "timesheet" ? <TimesheetPage /> : null}
                {route === "calendar" ? <CalendarPage /> : null}
                {route === "reports" ? <ReportsPage /> : null}
                {route === "projects" ? <ProjectsPage /> : null}
                {route === "clients" ? <ClientsPage /> : null}
                {route === "tags" ? <TagsPage /> : null}
                {route === "settings" ? <SettingsPage onOpenShortcuts={() => setShortcutsOpen(true)} /> : null}

              </div>
            )}
          </div>
        </main>
      </div>

      <EntryDialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        defaultDate={manualDefaults.date}
        defaultProjectId={manualDefaults.projectId}
        defaultDescription={manualDefaults.description}
      />

      <QuitDialog open={quitOpen} onClose={() => setQuitOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {ready && !loadError && !settings.onboardingComplete ? <Onboarding /> : null}
      {ready && !loadError ? <RecoveryModal /> : null}
    </NavigationContext.Provider>
  );
}
