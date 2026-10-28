use tauri::{AppHandle, Emitter, State};

use crate::domain::{idle, portability, reports, timer, timeutil};
use crate::error::Result;
use crate::models::{
    AppSettings, AppStatus, BackupPreview, BackupResult, Client, ClientInput, CreatedEntry,
    EntryFilter, EntryUpdateInput, ExportResult, IdleReview, ManualEntryInput, PlatformInfo,
    Project, ProjectInput, RecoveryInfo, ReportFilter, ReportResult, RestoreResult, SettingsPatch,
    SettingsUpdateResult, ShortcutStatus, StartTimerInput, Tag, TagInput, TimeEntry, Timesheet,
};
use crate::platform;
use crate::state::AppState;
use crate::storage::{
    repo_clients, repo_entries, repo_idle, repo_projects, repo_settings, repo_tags,
};

fn emit_changed(app: &AppHandle, event: &str) {
    let _ = app.emit(event, ());
    platform::tray::refresh(app);
}

fn resolve_range(filter: &EntryFilter) -> Result<(Option<i64>, Option<i64>)> {
    let tz = timeutil::resolve_tz(filter.timezone.as_deref());
    let from = match filter.from_utc {
        Some(value) => Some(value),
        None => filter
            .date_from
            .as_deref()
            .map(|raw| timeutil::parse_date(raw).map(|date| timeutil::day_start_ms(date, tz)))
            .transpose()?,
    };
    let to = match filter.to_utc {
        Some(value) => Some(value),
        None => filter
            .date_to
            .as_deref()
            .map(|raw| timeutil::parse_date(raw).map(|date| timeutil::day_end_ms(date, tz)))
            .transpose()?,
    };
    Ok((from, to))
}

/* ------------------------------- app status ------------------------------ */

#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>, timezone: Option<String>) -> Result<AppStatus> {
    let now = timeutil::now_ms();
    let tz = timeutil::resolve_tz(timezone.as_deref());
    let (active, today_seconds) = {
        let db = state.db()?;
        let active = repo_entries::get_active(&db)?;
        let today = timeutil::local_date(now, tz);
        let seconds = timer::seconds_for_local_day(&db, today, tz, now)?;
        (active, seconds)
    };
    let today = timeutil::local_date(now, tz);

    let mut pending = state.recovery_snapshot();
    if let Some(info) = &pending {
        let still_active = active
            .as_ref()
            .map(|entry| entry.id == info.entry.id)
            .unwrap_or(false);
        if !still_active {
            state.clear_recovery();
            pending = None;
        }
    }

    Ok(AppStatus {
        active_entry: active,
        today_seconds,
        today_date: timeutil::format_date(today),
        server_now_utc: now,
        pending_recovery: pending,
    })
}

#[tauri::command]
pub fn get_platform_info(state: State<'_, AppState>) -> Result<PlatformInfo> {
    Ok(PlatformInfo {
        platform: std::env::consts::OS.to_string(),
        app_version: state.app_version().to_string(),
        data_dir: state.data_dir().display().to_string(),
        db_path: state.db_path().display().to_string(),
        idle_available: platform::idle::is_available(),
        idle_unavailable_reason: platform::idle::unavailable_reason(),
        tray_available: state.tray_available(),
        open_shortcut_default: AppSettings::default().open_shortcut,
        toggle_shortcut_default: AppSettings::default().toggle_shortcut,
    })
}

/* --------------------------------- timer --------------------------------- */

#[tauri::command]
pub fn start_timer(
    app: AppHandle,
    state: State<'_, AppState>,
    input: StartTimerInput,
) -> Result<TimeEntry> {
    let now = timeutil::now_ms();
    let entry = {
        let mut db = state.db()?;
        timer::start(&mut db, &input, now)?
    };
    state.clear_recovery();
    emit_changed(&app, "timer-state-changed");
    Ok(entry)
}

#[tauri::command]
pub fn switch_timer(
    app: AppHandle,
    state: State<'_, AppState>,
    input: StartTimerInput,
) -> Result<TimeEntry> {
    let now = timeutil::now_ms();
    let entry = {
        let mut db = state.db()?;
        timer::switch(&mut db, &input, now)?
    };
    state.clear_recovery();
    emit_changed(&app, "timer-state-changed");
    Ok(entry)
}

#[tauri::command]
pub fn stop_timer(app: AppHandle, state: State<'_, AppState>) -> Result<TimeEntry> {
    let now = timeutil::now_ms();
    let entry = {
        let mut db = state.db()?;
        timer::stop(&mut db, now)?
    };
    state.clear_recovery();
    emit_changed(&app, "timer-state-changed");
    Ok(entry)
}

#[tauri::command]
pub fn resume_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    entry_id: String,
    switch_active: Option<bool>,
) -> Result<TimeEntry> {
    let now = timeutil::now_ms();
    let entry = {
        let mut db = state.db()?;
        timer::resume(&mut db, &entry_id, switch_active.unwrap_or(true), now)?
    };
    state.clear_recovery();
    emit_changed(&app, "timer-state-changed");
    Ok(entry)
}

#[tauri::command]
pub fn resolve_recovery(
    app: AppHandle,
    state: State<'_, AppState>,
    action: String,
) -> Result<Option<TimeEntry>> {
    let now = timeutil::now_ms();
    let result = {
        let mut db = state.db()?;
        timer::resolve_recovery(&mut db, &action, now)?
    };
    state.clear_recovery();
    emit_changed(&app, "timer-state-changed");
    Ok(result)
}

/* -------------------------------- entries -------------------------------- */

#[tauri::command]
pub fn list_entries(state: State<'_, AppState>, filter: EntryFilter) -> Result<Vec<TimeEntry>> {
    let now = timeutil::now_ms();
    let (from, to) = resolve_range(&filter)?;
    let db = state.db()?;
    repo_entries::list_entries(&db, &filter, from, to, now)
}

#[tauri::command]
pub fn create_manual_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ManualEntryInput,
) -> Result<CreatedEntry> {
    let now = timeutil::now_ms();
    let created = {
        let mut db = state.db()?;
        timer::create_manual(&mut db, &input, now)?
    };
    emit_changed(&app, "entries-changed");
    Ok(created)
}

#[tauri::command]
pub fn update_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    input: EntryUpdateInput,
) -> Result<CreatedEntry> {
    let now = timeutil::now_ms();
    let updated = {
        let mut db = state.db()?;
        timer::update(&mut db, &id, &input, now)?
    };
    emit_changed(&app, "entries-changed");
    Ok(updated)
}

#[tauri::command]
pub fn delete_entry(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    let now = timeutil::now_ms();
    {
        let db = state.db()?;
        timer::soft_delete(&db, &id, now)?;
    }
    emit_changed(&app, "entries-changed");
    Ok(())
}

#[tauri::command]
pub fn restore_entry(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<TimeEntry> {
    let now = timeutil::now_ms();
    let entry = {
        let db = state.db()?;
        timer::restore(&db, &id, now)?
    };
    emit_changed(&app, "entries-changed");
    Ok(entry)
}

/* ------------------------------ organization ----------------------------- */

#[tauri::command]
pub fn list_clients(
    state: State<'_, AppState>,
    include_archived: Option<bool>,
) -> Result<Vec<Client>> {
    let db = state.db()?;
    repo_clients::list(&db, include_archived.unwrap_or(false))
}

#[tauri::command]
pub fn save_client(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ClientInput,
) -> Result<Client> {
    let now = timeutil::now_ms();
    let client = {
        let db = state.db()?;
        repo_clients::save(&db, &input, now)?
    };
    emit_changed(&app, "data-changed");
    Ok(client)
}

#[tauri::command]
pub fn archive_client(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> Result<Client> {
    let now = timeutil::now_ms();
    let client = {
        let db = state.db()?;
        repo_clients::set_archived(&db, &id, archived, now)?
    };
    emit_changed(&app, "data-changed");
    Ok(client)
}

#[tauri::command]
pub fn list_projects(
    state: State<'_, AppState>,
    include_archived: Option<bool>,
) -> Result<Vec<Project>> {
    let db = state.db()?;
    repo_projects::list(&db, include_archived.unwrap_or(false))
}

#[tauri::command]
pub fn save_project(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ProjectInput,
) -> Result<Project> {
    let now = timeutil::now_ms();
    let project = {
        let db = state.db()?;
        repo_projects::save(&db, &input, now)?
    };
    emit_changed(&app, "data-changed");
    Ok(project)
}

#[tauri::command]
pub fn archive_project(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> Result<Project> {
    let now = timeutil::now_ms();
    let project = {
        let db = state.db()?;
        repo_projects::set_archived(&db, &id, archived, now)?
    };
    emit_changed(&app, "data-changed");
    Ok(project)
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>, include_archived: Option<bool>) -> Result<Vec<Tag>> {
    let db = state.db()?;
    repo_tags::list(&db, include_archived.unwrap_or(false))
}

#[tauri::command]
pub fn save_tag(app: AppHandle, state: State<'_, AppState>, input: TagInput) -> Result<Tag> {
    let now = timeutil::now_ms();
    let tag = {
        let db = state.db()?;
        repo_tags::save(&db, &input, now)?
    };
    emit_changed(&app, "data-changed");
    Ok(tag)
}

#[tauri::command]
pub fn archive_tag(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> Result<Tag> {
    let now = timeutil::now_ms();
    let tag = {
        let db = state.db()?;
        repo_tags::set_archived(&db, &id, archived, now)?
    };
    emit_changed(&app, "data-changed");
    Ok(tag)
}

#[tauri::command]
pub fn delete_tag(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    let now = timeutil::now_ms();
    {
        let db = state.db()?;
        repo_tags::soft_delete(&db, &id, now)?;
    }
    emit_changed(&app, "data-changed");
    Ok(())
}

/* ---------------------------- timesheet/report --------------------------- */

#[tauri::command]
pub fn get_timesheet(
    state: State<'_, AppState>,
    week_start: String,
    timezone: String,
) -> Result<Timesheet> {
    let date = timeutil::parse_date(&week_start)?;
    let now = timeutil::now_ms();
    let sunday_start = state.settings_snapshot().start_of_week == "sunday";
    let db = state.db()?;
    reports::get_timesheet(&db, date, sunday_start, &timezone, now)
}

#[tauri::command]
pub fn get_report(state: State<'_, AppState>, filter: ReportFilter) -> Result<ReportResult> {
    let now = timeutil::now_ms();
    let db = state.db()?;
    reports::get_report(&db, &filter, now)
}

#[tauri::command]
pub fn export_report_csv(
    state: State<'_, AppState>,
    filter: ReportFilter,
    destination: String,
) -> Result<ExportResult> {
    let now = timeutil::now_ms();
    let db = state.db()?;
    portability::export_csv(&db, &filter, &destination, now)
}

/* ------------------------------ idle review ------------------------------ */

#[tauri::command]
pub fn get_pending_idle_reviews(state: State<'_, AppState>) -> Result<Vec<IdleReview>> {
    let db = state.db()?;
    repo_idle::list_pending(&db)
}

#[tauri::command]
pub fn resolve_idle_review(
    app: AppHandle,
    state: State<'_, AppState>,
    review_id: String,
    action: String,
) -> Result<IdleReview> {
    let now = timeutil::now_ms();
    let review = {
        let mut db = state.db()?;
        idle::resolve(&mut db, &review_id, &action, now)?
    };
    let _ = app.emit("idle-review-required", ());
    emit_changed(&app, "timer-state-changed");
    Ok(review)
}

/* -------------------------------- settings ------------------------------- */

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings> {
    let db = state.db()?;
    repo_settings::load(&db)
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<SettingsUpdateResult> {
    let settings = {
        let db = state.db()?;
        let mut settings = repo_settings::load(&db)?;
        repo_settings::apply_patch(&mut settings, &patch)?;
        if settings.shortcuts_enabled {
            platform::shortcuts::validate_settings(&settings)?;
        }
        repo_settings::save_all(&db, &settings)?;
        settings
    };
    state.set_settings(settings.clone());

    let mut warnings = platform::shortcuts::apply(&app, &settings);
    warnings.extend(platform::sync_autostart(&app, settings.launch_at_login));
    let _ = app.emit("settings-changed", &settings);
    platform::tray::refresh(&app);

    Ok(SettingsUpdateResult { settings, warnings })
}

#[tauri::command]
pub fn get_shortcut_status(state: State<'_, AppState>) -> Result<ShortcutStatus> {
    Ok(state.shortcut_status())
}

/* ------------------------------- data files ------------------------------ */

#[tauri::command]
pub fn save_backup(state: State<'_, AppState>, destination: String) -> Result<BackupResult> {
    let now = timeutil::now_ms();
    let db = state.db()?;
    portability::create_backup(&db, &destination, state.app_version(), now)
}

#[tauri::command]
pub fn preview_restore(source: String) -> Result<BackupPreview> {
    portability::preview_restore(&source)
}

#[tauri::command]
pub fn restore_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
) -> Result<RestoreResult> {
    let now = timeutil::now_ms();
    let result = {
        let mut db = state.db()?;
        portability::restore_backup(
            &mut db,
            &source,
            &state.backups_dir(),
            state.app_version(),
            now,
        )?
    };
    let settings = {
        let db = state.db()?;
        repo_settings::load(&db)?
    };
    state.set_settings(settings.clone());
    state.reload_recovery()?;
    for warning in platform::shortcuts::apply(&app, &settings) {
        log::warn!("{warning}");
    }
    for warning in platform::sync_autostart(&app, settings.launch_at_login) {
        log::warn!("{warning}");
    }
    let _ = app.emit("data-changed", ());
    let _ = app.emit("settings-changed", &settings);
    platform::tray::refresh(&app);
    Ok(result)
}

/* --------------------------------- quit ---------------------------------- */

#[tauri::command]
pub fn quit_app(app: AppHandle, stop_timer: bool) {
    platform::window::quit(&app, stop_timer);
}

#[tauri::command]
pub fn get_recovery_info(state: State<'_, AppState>) -> Result<Option<RecoveryInfo>> {
    Ok(state.recovery_snapshot())
}
