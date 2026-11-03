import { invoke } from "@tauri-apps/api/core";
import type {
  AutoBackupStatus,
  BulkEditPatch,
  BulkEditResult,
  EntryPage,
  TaskTemplate,
  TemplateInput,
  AiStatus,
  AiTestResult,
  AppSettings,
  AppStatus,
  BackupPreview,
  BackupResult,
  BulkDeleteResult,
  BulkRestoreResult,
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
  ShareInput,
  SharingStatus,
  SharedReportPreview,
  RestoreResult,
  SettingsPatch,
  SettingsUpdateResult,
  ShortcutStatus,
  StartTimerInput,
  SummaryResult,
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
  listEntryPage: (filter: EntryFilter) => call<EntryPage>("list_entry_page", { filter }),
  bulkEditEntries: (ids: string[], patch: BulkEditPatch) => call<BulkEditResult>("bulk_edit_entries", { ids, patch }),
  undoBulkEdit: (token: string) => call<number>("undo_bulk_edit", { token }),
  listTemplates: () => call<TaskTemplate[]>("list_templates"),
  saveTemplate: (input: TemplateInput) => call<TaskTemplate>("save_template", { input }),
  deleteTemplate: (id: string) => call<void>("delete_template", { id }),
  startTemplate: (id: string, switchActive = false) => call<TimeEntry>("start_template", { id, switchActive }),
  getAutoBackupStatus: () => call<AutoBackupStatus>("get_auto_backup_status"),
  runAutoBackup: () => call<AutoBackupStatus>("run_auto_backup"),
  createManualEntry: (input: ManualEntryInput) =>
    call<CreatedEntry>("create_manual_entry", { input }),
  duplicateEntry: (entryId: string) =>
    call<CreatedEntry>("duplicate_entry", { entryId }),
  updateEntry: (id: string, input: EntryUpdateInput) =>
    call<CreatedEntry>("update_entry", { id, input }),
  deleteEntry: (id: string) => call<void>("delete_entry", { id }),
  restoreEntry: (id: string) => call<TimeEntry>("restore_entry", { id }),
  deleteEntries: (ids: string[]) =>
    call<BulkDeleteResult>("delete_entries", { ids }),
  restoreEntries: (ids: string[]) =>
    call<BulkRestoreResult>("restore_entries", { ids }),

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
  previewSharing: (input: ShareInput) => call<SharedReportPreview>("preview_sharing", { input }),
  startSharing: (input: ShareInput) => call<SharingStatus>("start_sharing", { input }),
  getSharingStatus: () => call<SharingStatus>("get_sharing_status"),
  stopSharing: () => call<SharingStatus>("stop_sharing"),
  rotateSharingLink: () => call<SharingStatus>("rotate_sharing_link"),
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

  getAiStatus: () => call<AiStatus>("get_ai_status"),
  setAiApiKey: (apiKey: string) => call<AiStatus>("set_ai_api_key", { apiKey }),
  deleteAiApiKey: () => call<AiStatus>("delete_ai_api_key"),
  testAiConnection: () => call<AiTestResult>("test_ai_connection"),
  generateSummary: (filter: ReportFilter, useAi: boolean) =>
    call<SummaryResult>("generate_summary", { filter, useAi }),

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
