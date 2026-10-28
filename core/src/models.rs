use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub id: String,
    pub name: String,
    pub archived_at_utc: Option<i64>,
    pub created_at_utc: i64,
    pub updated_at_utc: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub default_billable: bool,
    pub archived_at_utc: Option<i64>,
    pub created_at_utc: i64,
    pub updated_at_utc: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub archived_at_utc: Option<i64>,
    pub created_at_utc: i64,
    pub updated_at_utc: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagRef {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: String,
    pub description: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub start_at_utc: i64,
    pub end_at_utc: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub is_billable: bool,
    pub source: String,
    pub tags: Vec<TagRef>,
    pub running: bool,
    pub deleted_at_utc: Option<i64>,
    pub created_at_utc: i64,
    pub updated_at_utc: i64,
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTimerInput {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
    #[serde(default)]
    pub is_billable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualEntryInput {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
    #[serde(default)]
    pub is_billable: Option<bool>,
    pub start_at_utc: i64,
    pub end_at_utc: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryUpdateInput {
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub is_billable: bool,
    pub start_at_utc: i64,
    /// Must be null for a running entry. Must be set for a completed entry.
    #[serde(default)]
    pub end_at_utc: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub default_billable: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryFilter {
    /// Inclusive local start date (YYYY-MM-DD) interpreted in `timezone`.
    #[serde(default)]
    pub date_from: Option<String>,
    /// Inclusive local end date (YYYY-MM-DD) interpreted in `timezone`.
    #[serde(default)]
    pub date_to: Option<String>,
    /// Raw UTC bounds; used instead of dateFrom/dateTo when present.
    #[serde(default)]
    pub from_utc: Option<i64>,
    #[serde(default)]
    pub to_utc: Option<i64>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
    #[serde(default)]
    pub billable: Option<bool>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub include_deleted: Option<bool>,
    #[serde(default)]
    pub include_running: Option<bool>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
    /// "start_desc" (default) or "start_asc"
    #[serde(default)]
    pub sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportFilter {
    pub date_from: String,
    pub date_to: String,
    pub timezone: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub tag_id: Option<String>,
    #[serde(default)]
    pub billable: Option<bool>,
    #[serde(default)]
    pub search: Option<String>,
}

// ---------------------------------------------------------------------------
// Views / results
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInfo {
    pub entry: TimeEntry,
    pub last_seen_at_utc: i64,
    pub estimated_seconds: i64,
    /// "unclean_shutdown" | "running_at_launch"
    pub reason: String,
    pub can_stop_at_last_seen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub active_entry: Option<TimeEntry>,
    pub today_seconds: i64,
    pub today_date: String,
    pub server_now_utc: i64,
    pub pending_recovery: Option<RecoveryInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlapInfo {
    pub id: String,
    pub description: String,
    pub start_at_utc: i64,
    pub end_at_utc: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedEntry {
    pub entry: TimeEntry,
    pub overlaps: Vec<OverlapInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkSkip {
    pub id: String,
    /// "not_found" | "already_deleted" | "running" | "not_deleted" | "invalid"
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkDeleteResult {
    pub deleted_ids: Vec<String>,
    pub deleted_count: usize,
    pub skipped: Vec<BulkSkip>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkRestoreResult {
    pub restored_ids: Vec<String>,
    pub restored_count: usize,
    pub skipped: Vec<BulkSkip>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimesheetDay {
    pub date: String,
    pub total_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimesheetRow {
    pub key: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub description: String,
    pub cells: Vec<Vec<TimeEntry>>,
    pub cell_seconds: Vec<i64>,
    pub total_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timesheet {
    pub week_start: String,
    pub week_end: String,
    pub days: Vec<TimesheetDay>,
    pub rows: Vec<TimesheetRow>,
    pub total_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyTotal {
    pub date: String,
    pub seconds: i64,
    pub billable_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupTotal {
    pub id: Option<String>,
    pub name: String,
    pub color: Option<String>,
    pub seconds: i64,
    pub billable_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportEntry {
    #[serde(flatten)]
    pub entry: TimeEntry,
    /// Seconds of this entry that fall inside the report range.
    pub in_range_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportResult {
    pub date_from: String,
    pub date_to: String,
    pub timezone: String,
    pub total_seconds: i64,
    pub billable_seconds: i64,
    pub non_billable_seconds: i64,
    pub entry_count: i64,
    pub daily: Vec<DailyTotal>,
    pub by_project: Vec<GroupTotal>,
    pub by_client: Vec<GroupTotal>,
    pub entries: Vec<ReportEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub row_count: i64,
    pub total_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleReview {
    pub id: String,
    pub kind: String,
    pub timer_entry_id: Option<String>,
    pub idle_started_at_utc: i64,
    pub activity_resumed_at_utc: Option<i64>,
    pub status: String,
    pub created_at_utc: i64,
    pub entry_description: Option<String>,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub start_of_week: String,
    pub timezone: String,
    pub time_format: String,
    pub close_to_tray: bool,
    pub launch_at_login: bool,
    pub idle_tracking_enabled: bool,
    pub idle_threshold_minutes: u32,
    pub shortcuts_enabled: bool,
    pub open_shortcut: String,
    pub toggle_shortcut: String,
    pub onboarding_complete: bool,
    pub tray_explained: bool,
    pub ai_summaries_enabled: bool,
    pub ai_provider: String,
    pub ai_model: String,
    pub ai_consent: bool,
    pub ai_include_descriptions: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            start_of_week: "monday".into(),
            timezone: "system".into(),
            time_format: "auto".into(),
            close_to_tray: true,
            launch_at_login: false,
            idle_tracking_enabled: false,
            idle_threshold_minutes: 5,
            shortcuts_enabled: true,
            open_shortcut: "CommandOrControl+Shift+T".into(),
            toggle_shortcut: "CommandOrControl+Shift+Y".into(),
            onboarding_complete: false,
            tray_explained: false,
            ai_summaries_enabled: false,
            ai_provider: "gemini".into(),
            ai_model: "gemini-2.5-flash".into(),
            ai_consent: false,
            ai_include_descriptions: true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub start_of_week: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub time_format: Option<String>,
    #[serde(default)]
    pub close_to_tray: Option<bool>,
    #[serde(default)]
    pub launch_at_login: Option<bool>,
    #[serde(default)]
    pub idle_tracking_enabled: Option<bool>,
    #[serde(default)]
    pub idle_threshold_minutes: Option<u32>,
    #[serde(default)]
    pub shortcuts_enabled: Option<bool>,
    #[serde(default)]
    pub open_shortcut: Option<String>,
    #[serde(default)]
    pub toggle_shortcut: Option<String>,
    #[serde(default)]
    pub onboarding_complete: Option<bool>,
    #[serde(default)]
    pub tray_explained: Option<bool>,
    #[serde(default)]
    pub ai_summaries_enabled: Option<bool>,
    #[serde(default)]
    pub ai_provider: Option<String>,
    #[serde(default)]
    pub ai_model: Option<String>,
    #[serde(default)]
    pub ai_consent: Option<bool>,
    #[serde(default)]
    pub ai_include_descriptions: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdateResult {
    pub settings: AppSettings,
    pub warnings: Vec<String>,
}

// ---------------------------------------------------------------------------
// AI summaries
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub enabled: bool,
    pub provider: String,
    pub model: String,
    pub consent: bool,
    pub include_descriptions: bool,
    pub key_configured: bool,
    pub key_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTestResult {
    pub ok: bool,
    pub message: String,
    pub model: String,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResult {
    pub text: String,
    /// "local" | "ai"
    pub mode: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub generated_at_utc: i64,
    pub range_label: String,
    pub total_seconds: i64,
    pub warning: Option<String>,
}

// ---------------------------------------------------------------------------
// Platform / diagnostics
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub platform: String,
    pub app_version: String,
    pub data_dir: String,
    pub db_path: String,
    /// "production" | "development" | "test"
    pub data_profile: String,
    pub idle_available: bool,
    pub idle_unavailable_reason: Option<String>,
    pub tray_available: bool,
    pub open_shortcut_default: String,
    pub toggle_shortcut_default: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub open_ok: bool,
    pub toggle_ok: bool,
    pub errors: Vec<String>,
}

// ---------------------------------------------------------------------------
// Backup / restore
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCounts {
    pub clients: usize,
    pub projects: usize,
    pub tags: usize,
    pub entries: usize,
    pub settings: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub counts: BackupCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    pub source: String,
    pub created_at_utc: i64,
    pub app_version: String,
    pub counts: BackupCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub counts: BackupCounts,
    pub safety_backup_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntryTag {
    pub entry_id: String,
    pub tag_id: String,
}

/// Versioned, human-inspectable backup document. Timestamps stay UTC milliseconds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupDocument {
    pub format: String,
    pub version: u32,
    pub created_at_utc: i64,
    pub app_version: String,
    pub clients: Vec<Client>,
    pub projects: Vec<Project>,
    pub tags: Vec<BackupTag>,
    pub entries: Vec<BackupEntry>,
    pub entry_tags: Vec<BackupEntryTag>,
    pub settings: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub archived_at_utc: Option<i64>,
    pub deleted_at_utc: Option<i64>,
    pub created_at_utc: i64,
    pub updated_at_utc: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    pub description: String,
    pub project_id: Option<String>,
    pub start_at_utc: i64,
    pub end_at_utc: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub is_billable: bool,
    pub source: String,
    pub deleted_at_utc: Option<i64>,
    pub created_at_utc: i64,
    pub updated_at_utc: i64,
}

pub const BACKUP_FORMAT: &str = "tempodesk-backup";
pub const BACKUP_VERSION: u32 = 1;
