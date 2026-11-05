use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai;
use crate::domain::{idle, machine_activity, portability, reports, summary, timer, timeutil};
use crate::error::AppError;
use crate::error::Result;
use crate::models::{
    AiStatus, AiTestResult, AppSettings, AppStatus, AutoBackupStatus, BackupPreview, BackupResult,
    BulkDeleteResult, BulkEditPatch, BulkEditResult, BulkRestoreResult, Client, ClientInput,
    CreatedEntry, EntryFilter, EntryPage, EntryUpdateInput, ExportResult, IdleReview,
    MachineActivityFilter, MachineActivityPage, MachineActivityStatus, ManualEntryInput,
    PlatformInfo, Project, ProjectInput, RecoveryInfo, ReportFilter, ReportResult, RestoreResult,
    SettingsPatch, SettingsUpdateResult, ShortcutStatus, StartTimerInput, SummaryResult, Tag,
    TagInput, TaskTemplate, TemplateInput, TimeEntry, Timesheet,
};
use crate::platform;
use crate::secrets;
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
        data_profile: state.data_profile().to_string(),
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
pub fn list_entry_page(state: State<'_, AppState>, filter: EntryFilter) -> Result<EntryPage> {
    let (from, to) = resolve_range(&filter)?;
    let db = state.db()?;
    repo_entries::list_page(&db, &filter, from, to, timeutil::now_ms())
}

#[tauri::command]
pub fn bulk_edit_entries(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
    patch: BulkEditPatch,
) -> Result<BulkEditResult> {
    let result = {
        let mut db = state.db()?;
        crate::domain::bulk::edit(&mut db, &ids, &patch, timeutil::now_ms())?
    };
    emit_changed(&app, "entries-changed");
    Ok(result)
}

#[tauri::command]
pub fn undo_bulk_edit(app: AppHandle, state: State<'_, AppState>, token: String) -> Result<usize> {
    let count = {
        let mut db = state.db()?;
        crate::domain::bulk::undo(&mut db, &token, timeutil::now_ms())?
    };
    emit_changed(&app, "entries-changed");
    Ok(count)
}

#[tauri::command]
pub fn list_templates(state: State<'_, AppState>) -> Result<Vec<TaskTemplate>> {
    let db = state.db()?;
    crate::domain::templates::list(&db)
}

#[tauri::command]
pub fn save_template(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TemplateInput,
) -> Result<TaskTemplate> {
    let template = {
        let db = state.db()?;
        crate::domain::templates::save(&db, &input)?
    };
    emit_changed(&app, "data-changed");
    Ok(template)
}

#[tauri::command]
pub fn delete_template(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    {
        let db = state.db()?;
        crate::domain::templates::delete(&db, &id)?;
    }
    emit_changed(&app, "data-changed");
    Ok(())
}

#[tauri::command]
pub fn start_template(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    switch_active: Option<bool>,
) -> Result<TimeEntry> {
    let entry = {
        let mut db = state.db()?;
        let input = crate::domain::templates::start_input(&db, &id)?;
        if switch_active.unwrap_or(false) {
            timer::switch(&mut db, &input, timeutil::now_ms())?
        } else {
            timer::start(&mut db, &input, timeutil::now_ms())?
        }
    };
    state.clear_recovery();
    emit_changed(&app, "timer-state-changed");
    Ok(entry)
}

#[tauri::command]
pub fn get_auto_backup_status(state: State<'_, AppState>) -> Result<AutoBackupStatus> {
    let db = state.db()?;
    crate::domain::auto_backup::status(&db, &state.settings_snapshot(), state.data_dir())
}

#[tauri::command]
pub fn run_auto_backup(app: AppHandle, state: State<'_, AppState>) -> Result<AutoBackupStatus> {
    if !state.settings_snapshot().auto_backup_enabled {
        return Err(AppError::validation("Enable automatic backups first"));
    }
    let result = crate::backups::run(&state, true);
    let _ = app.emit("backup-status-changed", ());
    result
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
pub fn duplicate_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<CreatedEntry> {
    let now = timeutil::now_ms();
    let created = {
        let mut db = state.db()?;
        timer::duplicate(&mut db, &entry_id, now)?
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

/// Soft-delete several completed entries at once. Running entries are skipped and reported.
#[tauri::command]
pub fn delete_entries(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<BulkDeleteResult> {
    let now = timeutil::now_ms();
    let result = {
        let mut db = state.db()?;
        timer::bulk_delete(&mut db, &ids, now)?
    };
    emit_changed(&app, "entries-changed");
    Ok(result)
}

/// Restore several soft-deleted entries at once (bulk delete undo).
#[tauri::command]
pub fn restore_entries(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<BulkRestoreResult> {
    let now = timeutil::now_ms();
    let result = {
        let mut db = state.db()?;
        timer::bulk_restore(&mut db, &ids, now)?
    };
    emit_changed(&app, "entries-changed");
    Ok(result)
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

/* -------------------------- machine activity ----------------------------- */

#[tauri::command]
pub fn get_machine_activity_status(app: AppHandle) -> MachineActivityStatus {
    app.state::<platform::session::Service>().status()
}

#[tauri::command]
pub fn list_machine_activity(
    state: State<'_, AppState>,
    filter: MachineActivityFilter,
) -> Result<MachineActivityPage> {
    let db = state.db()?;
    machine_activity::list(&db, &filter, timeutil::now_ms())
}

#[tauri::command]
pub fn export_machine_activity_csv(
    state: State<'_, AppState>,
    filter: MachineActivityFilter,
    destination: String,
) -> Result<ExportResult> {
    let db = state.db()?;
    machine_activity::export_csv(&db, &filter, &destination, timeutil::now_ms())
}

#[tauri::command]
pub fn clear_machine_activity(app: AppHandle, state: State<'_, AppState>) -> Result<usize> {
    let count = {
        let db = state.db()?;
        machine_activity::clear(&db, timeutil::now_ms())?
    };
    let _ = app.emit("machine-activity-changed", ());
    Ok(count)
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
        let was_enabled = settings.machine_activity_enabled;
        repo_settings::apply_patch(&mut settings, &patch)?;
        if settings.shortcuts_enabled {
            platform::shortcuts::validate_settings(&settings)?;
        }
        repo_settings::save_all(&db, &settings)?;
        if was_enabled != settings.machine_activity_enabled {
            app.state::<platform::session::Service>()
                .invalidate(settings.machine_activity_enabled);
        }
        machine_activity::prune(&db, timeutil::now_ms())?;
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

/* ------------------------------- AI summaries ---------------------------- */

fn build_ai_status(state: &AppState) -> AiStatus {
    let settings = state.settings_snapshot();
    let (key_configured, key_error) = secrets::key_status(state.data_profile());
    AiStatus {
        enabled: settings.ai_summaries_enabled,
        provider: settings.ai_provider,
        model: settings.ai_model,
        consent: settings.ai_consent,
        include_descriptions: settings.ai_include_descriptions,
        key_configured,
        key_error,
    }
}

#[tauri::command]
pub fn get_ai_status(state: State<'_, AppState>) -> Result<AiStatus> {
    Ok(build_ai_status(&state))
}

#[tauri::command]
pub fn set_ai_api_key(state: State<'_, AppState>, api_key: String) -> Result<AiStatus> {
    secrets::set_api_key(state.data_profile(), &api_key)?;
    Ok(build_ai_status(&state))
}

#[tauri::command]
pub fn delete_ai_api_key(state: State<'_, AppState>) -> Result<AiStatus> {
    secrets::delete_api_key(state.data_profile())?;
    Ok(build_ai_status(&state))
}

#[tauri::command]
pub async fn test_ai_connection(state: State<'_, AppState>) -> Result<AiTestResult> {
    let profile = state.data_profile().to_string();
    let model = state.settings_snapshot().ai_model;
    let key = secrets::get_api_key(&profile)?.ok_or_else(|| {
        AppError::validation("Add a Gemini API key before testing the connection")
    })?;
    ai::test_connection(&model, &key).await
}

/// Generate a high-level summary. `use_ai = false` produces the deterministic local summary
/// without any network access. AI generation requires an enabled, consented configuration and a
/// key from the OS credential store.
#[tauri::command]
pub async fn generate_summary(
    state: State<'_, AppState>,
    filter: ReportFilter,
    use_ai: bool,
) -> Result<SummaryResult> {
    let now = timeutil::now_ms();
    let (report, settings, profile) = {
        let db = state.db()?;
        (
            reports::get_report(&db, &filter, now)?,
            state.settings_snapshot(),
            state.data_profile().to_string(),
        )
    };
    let range_label = format!("{} to {}", report.date_from, report.date_to);
    if !use_ai {
        return Ok(SummaryResult {
            text: summary::local_summary(&report),
            mode: "local".into(),
            provider: None,
            model: None,
            generated_at_utc: now,
            range_label,
            total_seconds: report.total_seconds,
            warning: None,
        });
    }

    if !settings.ai_summaries_enabled {
        return Err(AppError::Unsupported(
            "AI summaries are disabled. Enable them in Settings → AI summaries.".into(),
        ));
    }
    if !settings.ai_consent {
        return Err(AppError::Unsupported(
            "Confirm the AI data-sharing notice in Settings before generating an AI summary."
                .into(),
        ));
    }
    let key = secrets::get_api_key(&profile)?.ok_or_else(|| {
        AppError::validation(
            "Add a Gemini API key in Settings → AI summaries before generating an AI summary.",
        )
    })?;
    let prompt = summary::build_ai_prompt(&report, settings.ai_include_descriptions);
    ai::generate(
        &settings.ai_model,
        &key,
        &prompt,
        report.total_seconds,
        range_label,
    )
    .await
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
    // A restored dataset must never become visible through a link created for the old data.
    app.state::<tempodesk_sharing::SharingService>().stop();
    let now = timeutil::now_ms();
    let result = {
        let mut db = state.db()?;
        let result = portability::restore_backup(
            &mut db,
            &source,
            &state.backups_dir(),
            state.app_version(),
            now,
        )?;
        app.state::<platform::session::Service>().invalidate(false);
        result
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
