// Typed mirror of the Rust domain payloads (serde camelCase).

export type ThemeSetting = "system" | "light" | "dark";
export type StartOfWeek = "monday" | "sunday";
export type TimeFormat = "auto" | "12h" | "24h";
export type EntrySource = "timer" | "manual" | "idle_adjustment";

export interface Client {
  id: string;
  name: string;
  archivedAtUtc: number | null;
  createdAtUtc: number;
  updatedAtUtc: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  clientId: string | null;
  clientName: string | null;
  defaultBillable: boolean;
  archivedAtUtc: number | null;
  createdAtUtc: number;
  updatedAtUtc: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  archivedAtUtc: number | null;
  createdAtUtc: number;
  updatedAtUtc: number;
}

export interface TagRef {
  id: string;
  name: string;
  color: string | null;
}

export interface TimeEntry {
  id: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  clientId: string | null;
  clientName: string | null;
  startAtUtc: number;
  endAtUtc: number | null;
  durationSeconds: number | null;
  isBillable: boolean;
  source: EntrySource;
  tags: TagRef[];
  running: boolean;
  deletedAtUtc: number | null;
  createdAtUtc: number;
  updatedAtUtc: number;
}

export interface StartTimerInput {
  description?: string;
  projectId?: string | null;
  tagIds?: string[];
  isBillable?: boolean;
}

export interface ManualEntryInput {
  description?: string;
  projectId?: string | null;
  tagIds?: string[];
  isBillable?: boolean;
  startAtUtc: number;
  endAtUtc: number;
}

export interface EntryUpdateInput {
  description: string;
  projectId: string | null;
  tagIds: string[];
  isBillable: boolean;
  startAtUtc: number;
  endAtUtc: number | null;
}

export interface ProjectInput {
  id?: string | null;
  name: string;
  color?: string | null;
  clientId?: string | null;
  defaultBillable?: boolean | null;
}

export interface ClientInput {
  id?: string | null;
  name: string;
}

export interface TagInput {
  id?: string | null;
  name: string;
  color?: string | null;
}

export interface EntryFilter {
  dateFrom?: string | null;
  dateTo?: string | null;
  fromUtc?: number | null;
  toUtc?: number | null;
  timezone?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  tagIds?: string[] | null;
  billable?: boolean | null;
  search?: string | null;
  includeDeleted?: boolean;
  includeRunning?: boolean;
  limit?: number;
  offset?: number;
  sort?: "start_desc" | "start_asc";
}

export interface ReportFilter {
  dateFrom: string;
  dateTo: string;
  timezone: string;
  projectId?: string | null;
  clientId?: string | null;
  tagId?: string | null;
  billable?: boolean | null;
  search?: string | null;
}

export interface RecoveryInfo {
  entry: TimeEntry;
  lastSeenAtUtc: number;
  estimatedSeconds: number;
  reason: "unclean_shutdown" | "running_at_launch";
  canStopAtLastSeen: boolean;
}

export interface AppStatus {
  activeEntry: TimeEntry | null;
  todaySeconds: number;
  todayDate: string;
  serverNowUtc: number;
  pendingRecovery: RecoveryInfo | null;
}

export interface OverlapInfo {
  id: string;
  description: string;
  startAtUtc: number;
  endAtUtc: number;
}

export interface CreatedEntry {
  entry: TimeEntry;
  overlaps: OverlapInfo[];
}

export interface TimesheetDay {
  date: string;
  totalSeconds: number;
}

export interface TimesheetRow {
  key: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  description: string;
  cells: TimeEntry[][];
  cellSeconds: number[];
  totalSeconds: number;
}

export interface Timesheet {
  weekStart: string;
  weekEnd: string;
  days: TimesheetDay[];
  rows: TimesheetRow[];
  totalSeconds: number;
}

export interface DailyTotal {
  date: string;
  seconds: number;
  billableSeconds: number;
}

export interface GroupTotal {
  id: string | null;
  name: string;
  color: string | null;
  seconds: number;
  billableSeconds: number;
}

export interface ReportEntry extends TimeEntry {
  inRangeSeconds: number;
}

export interface ReportResult {
  dateFrom: string;
  dateTo: string;
  timezone: string;
  totalSeconds: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  entryCount: number;
  daily: DailyTotal[];
  byProject: GroupTotal[];
  byClient: GroupTotal[];
  entries: ReportEntry[];
}

export interface ExportResult {
  path: string;
  rowCount: number;
  totalSeconds: number;
}

export interface AppSettings {
  theme: ThemeSetting;
  startOfWeek: StartOfWeek;
  timezone: string;
  timeFormat: TimeFormat;
  closeToTray: boolean;
  launchAtLogin: boolean;
  idleTrackingEnabled: boolean;
  idleThresholdMinutes: number;
  shortcutsEnabled: boolean;
  openShortcut: string;
  toggleShortcut: string;
  onboardingComplete: boolean;
  trayExplained: boolean;
}

export interface SettingsPatch {
  theme?: ThemeSetting;
  startOfWeek?: StartOfWeek;
  timezone?: string;
  timeFormat?: TimeFormat;
  closeToTray?: boolean;
  launchAtLogin?: boolean;
  idleTrackingEnabled?: boolean;
  idleThresholdMinutes?: number;
  shortcutsEnabled?: boolean;
  openShortcut?: string;
  toggleShortcut?: string;
  onboardingComplete?: boolean;
  trayExplained?: boolean;
}

export interface SettingsUpdateResult {
  settings: AppSettings;
  warnings: string[];
}

export interface PlatformInfo {
  platform: string;
  appVersion: string;
  dataDir: string;
  dbPath: string;
  idleAvailable: boolean;
  idleUnavailableReason: string | null;
  trayAvailable: boolean;
  openShortcutDefault: string;
  toggleShortcutDefault: string;
}

export interface ShortcutStatus {
  openOk: boolean;
  toggleOk: boolean;
  errors: string[];
}

export interface IdleReview {
  id: string;
  kind: "idle" | "sleep";
  timerEntryId: string | null;
  idleStartedAtUtc: number;
  activityResumedAtUtc: number | null;
  status: string;
  createdAtUtc: number;
  entryDescription: string | null;
}

export interface BackupCounts {
  clients: number;
  projects: number;
  tags: number;
  entries: number;
  settings: number;
}

export interface BackupResult {
  path: string;
  counts: BackupCounts;
}

export interface BackupPreview {
  source: string;
  createdAtUtc: number;
  appVersion: string;
  counts: BackupCounts;
}

export interface RestoreResult {
  counts: BackupCounts;
  safetyBackupPath: string;
}

export type IdleAction = "keep" | "exclude" | "stop_at_idle";
export type RecoveryAction = "continue" | "stop_at_last_seen" | "stop_now";

export interface ApiErrorShape {
  code: string;
  message: string;
}
