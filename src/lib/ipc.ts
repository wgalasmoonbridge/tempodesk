import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  AppStatus,
  BackupPreview,
  BackupResult,
  Client,
  ClientInput,
  CreatedEntry,
  EntryFilter,
  EntryUpdateInput,
  ExportResult,
  IdleAction,
  IdleReview,
  ManualEntryInput,
  PlatformInfo,
  Project,
  ProjectInput,
  RecoveryAction,
  RecoveryInfo,
  ReportFilter,
  ReportResult,
  RestoreResult,
  SettingsPatch,
  SettingsUpdateResult,
  ShortcutStatus,
  StartTimerInput,
  Tag,
  TagInput,
  TimeEntry,
  Timesheet,
} from "./types";

function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export const api = {
  getAppStatus: (timezone: string) =>
    call<AppStatus>("get_app_status", { timezone }),
  getPlatformInfo: () => call<PlatformInfo>("get_platform_info"),
  getRecoveryInfo: () => call<RecoveryInfo | null>("get_recovery_info"),

  startTimer: (input: StartTimerInput) => call<TimeEntry>("start_timer", { input }),
  switchTimer: (input: StartTimerInput) =>
    call<TimeEntry>("switch_timer", { input }),
  stopTimer: () => call<TimeEntry>("stop_timer"),
  resumeEntry: (entryId: string, switchActive = true) =>
    call<TimeEntry>("resume_entry", { entryId, switchActive }),
  resolveRecovery: (action: RecoveryAction) =>
    call<TimeEntry | null>("resolve_recovery", { action }),

  listEntries: (filter: EntryFilter) =>
    call<TimeEntry[]>("list_entries", { filter }),
  createManualEntry: (input: ManualEntryInput) =>
    call<CreatedEntry>("create_manual_entry", { input }),
  updateEntry: (id: string, input: EntryUpdateInput) =>
    call<CreatedEntry>("update_entry", { id, input }),
  deleteEntry: (id: string) => call<void>("delete_entry", { id }),
  restoreEntry: (id: string) => call<TimeEntry>("restore_entry", { id }),

  listClients: (includeArchived = false) =>
    call<Client[]>("list_clients", { includeArchived }),
  saveClient: (input: ClientInput) => call<Client>("save_client", { input }),
  archiveClient: (id: string, archived: boolean) =>
    call<Client>("archive_client", { id, archived }),

  listProjects: (includeArchived = false) =>
    call<Project[]>("list_projects", { includeArchived }),
  saveProject: (input: ProjectInput) =>
    call<Project>("save_project", { input }),
  archiveProject: (id: string, archived: boolean) =>
    call<Project>("archive_project", { id, archived }),

  listTags: (includeArchived = false) =>
    call<Tag[]>("list_tags", { includeArchived }),
  saveTag: (input: TagInput) => call<Tag>("save_tag", { input }),
  archiveTag: (id: string, archived: boolean) =>
    call<Tag>("archive_tag", { id, archived }),
  deleteTag: (id: string) => call<void>("delete_tag", { id }),

  getTimesheet: (weekStart: string, timezone: string) =>
    call<Timesheet>("get_timesheet", { weekStart, timezone }),
  getReport: (filter: ReportFilter) => call<ReportResult>("get_report", { filter }),
  exportReportCsv: (filter: ReportFilter, destination: string) =>
    call<ExportResult>("export_report_csv", { filter, destination }),

  getPendingIdleReviews: () =>
    call<IdleReview[]>("get_pending_idle_reviews"),
  resolveIdleReview: (reviewId: string, action: IdleAction) =>
    call<IdleReview>("resolve_idle_review", { reviewId, action }),

  getSettings: () => call<AppSettings>("get_settings"),
  updateSettings: (patch: SettingsPatch) =>
    call<SettingsUpdateResult>("update_settings", { patch }),
  getShortcutStatus: () => call<ShortcutStatus>("get_shortcut_status"),

  saveBackup: (destination: string) =>
    call<BackupResult>("save_backup", { destination }),
  previewRestore: (source: string) =>
    call<BackupPreview>("preview_restore", { source }),
  restoreBackup: (source: string) =>
    call<RestoreResult>("restore_backup", { source }),

  quitApp: (stopTimer: boolean) => call<void>("quit_app", { stopTimer }),
};

export type ApiError = { code: string; message: string };

export function normalizeError(error: unknown): ApiError {
  if (typeof error === "string") {
    return { code: "error", message: error };
  }
  if (error && typeof error === "object") {
    const candidate = error as Partial<ApiError>;
    if (typeof candidate.message === "string") {
      return {
        code: typeof candidate.code === "string" ? candidate.code : "error",
        message: candidate.message,
      };
    }
  }
  return { code: "error", message: "Something went wrong. Please try again." };
}
