use rusqlite::Connection;
use uuid::Uuid;

use crate::domain::timeutil::{
    align_second, allocation_in_range, day_end_ms, day_start_ms, local_date,
};
use crate::domain::validate::{normalize_description, validate_manual_range, validate_timer_start};
use crate::error::{AppError, Result};
use crate::models::{CreatedEntry, EntryUpdateInput, ManualEntryInput, StartTimerInput, TimeEntry};
use crate::storage::{repo_entries, repo_projects, repo_tags};

const MAX_TIMER_EDIT_SECONDS: i64 = 7 * 24 * 60 * 60;

struct EntryMeta {
    description: String,
    project_id: Option<String>,
    is_billable: bool,
    tag_ids: Vec<String>,
}

fn resolve_meta(
    conn: &Connection,
    description: Option<&str>,
    project_id: Option<&str>,
    tag_ids: Option<&[String]>,
    billable_override: Option<bool>,
    allow_archived_project: bool,
) -> Result<EntryMeta> {
    let description = normalize_description(description)?;
    let project_id = project_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let project = match &project_id {
        Some(id) => {
            let project = repo_projects::get(conn, id)?;
            if project.archived_at_utc.is_some() && !allow_archived_project {
                return Err(AppError::Archived(
                    "The selected project is archived. Choose an active project.".into(),
                ));
            }
            Some(project)
        }
        None => None,
    };

    let mut unique_tags: Vec<String> = Vec::new();
    if let Some(tags) = tag_ids {
        for tag_id in tags {
            if tag_id.trim().is_empty() {
                continue;
            }
            // Ensures the tag exists and has not been soft-deleted.
            repo_tags::get(conn, tag_id)?;
            if !unique_tags.iter().any(|t| t == tag_id) {
                unique_tags.push(tag_id.clone());
            }
        }
    }

    let is_billable = billable_override.unwrap_or_else(|| {
        project
            .as_ref()
            .map(|p| p.default_billable)
            .unwrap_or(false)
    });

    Ok(EntryMeta {
        description,
        project_id,
        is_billable,
        tag_ids: unique_tags,
    })
}

fn stop_active_in_tx(tx: &rusqlite::Transaction<'_>, now: i64) -> Result<Option<(String, i64)>> {
    let active = repo_entries::get_active(tx)?;
    let Some(entry) = active else {
        return Ok(None);
    };
    let end = align_second(now).max(entry.start_at_utc + 1000);
    let duration = (end - entry.start_at_utc) / 1000;
    tx.execute(
        "UPDATE time_entries
         SET end_at_utc = ?1, duration_seconds = ?2, updated_at_utc = ?3
         WHERE id = ?4",
        rusqlite::params![end, duration, now, entry.id],
    )?;
    Ok(Some((entry.id, end)))
}

fn insert_running(
    tx: &rusqlite::Transaction<'_>,
    meta: &EntryMeta,
    start_at_utc: i64,
    now: i64,
    source: &str,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO time_entries
           (id, description, project_id, start_at_utc, end_at_utc, duration_seconds,
            is_billable, source, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6, ?7, ?7)",
        rusqlite::params![
            id,
            meta.description,
            meta.project_id,
            start_at_utc,
            i64::from(meta.is_billable),
            source,
            now
        ],
    )?;
    repo_entries::set_entry_tags(tx, &id, &meta.tag_ids)?;
    Ok(id)
}

fn load_entry(conn: &Connection, id: &str) -> Result<TimeEntry> {
    repo_entries::get_entry(conn, id)?.ok_or_else(|| AppError::not_found("Time entry not found"))
}

pub fn start(conn: &mut Connection, input: &StartTimerInput, now: i64) -> Result<TimeEntry> {
    if repo_entries::get_active(conn)?.is_some() {
        return Err(AppError::ActiveTimerExists(
            "A timer is already running. Stop it or switch to a new one.".into(),
        ));
    }
    let start_at = align_second(now);
    validate_timer_start(start_at, now)?;
    let meta = resolve_meta(
        conn,
        input.description.as_deref(),
        input.project_id.as_deref(),
        input.tag_ids.as_deref(),
        input.is_billable,
        false,
    )?;

    let tx = conn.transaction()?;
    let id = insert_running(&tx, &meta, start_at, now, "timer")?;
    tx.commit()?;
    load_entry(conn, &id)
}

/// Atomically stop the current timer (if any) and start a new one.
pub fn switch(conn: &mut Connection, input: &StartTimerInput, now: i64) -> Result<TimeEntry> {
    let meta = resolve_meta(
        conn,
        input.description.as_deref(),
        input.project_id.as_deref(),
        input.tag_ids.as_deref(),
        input.is_billable,
        false,
    )?;
    let base = align_second(now);
    let tx = conn.transaction()?;
    let previous_end = stop_active_in_tx(&tx, now)?.map(|(_, end)| end);
    let start_at = previous_end.map(|end| end.max(base)).unwrap_or(base);
    validate_timer_start(start_at, now)?;
    let id = insert_running(&tx, &meta, start_at, now, "timer")?;
    tx.commit()?;
    load_entry(conn, &id)
}

pub fn stop(conn: &mut Connection, now: i64) -> Result<TimeEntry> {
    let tx = conn.transaction()?;
    let stopped = stop_active_in_tx(&tx, now)?;
    let Some((id, _)) = stopped else {
        return Err(AppError::NoActiveTimer("There is no running timer".into()));
    };
    tx.commit()?;
    load_entry(conn, &id)
}

/// Resume a completed entry as a brand-new running session, preserving the original.
pub fn resume(
    conn: &mut Connection,
    entry_id: &str,
    switch_active: bool,
    now: i64,
) -> Result<TimeEntry> {
    let source = load_entry(conn, entry_id)?;
    if source.running {
        return Err(AppError::conflict("That entry is already running"));
    }
    if source.deleted_at_utc.is_some() {
        return Err(AppError::not_found("Time entry not found"));
    }
    if repo_entries::get_active(conn)?.is_some() && !switch_active {
        return Err(AppError::ActiveTimerExists(
            "A timer is already running. Stop it first or switch.".into(),
        ));
    }

    let tag_ids: Vec<String> = source.tags.iter().map(|t| t.id.clone()).collect();
    let meta = resolve_meta(
        conn,
        Some(&source.description),
        source.project_id.as_deref(),
        Some(&tag_ids),
        Some(source.is_billable),
        true,
    )?;

    let base = align_second(now);
    let tx = conn.transaction()?;
    let previous_end = stop_active_in_tx(&tx, now)?.map(|(_, end)| end);
    let start_at = previous_end.map(|end| end.max(base)).unwrap_or(base);
    validate_timer_start(start_at, now)?;
    let id = insert_running(&tx, &meta, start_at, now, "timer")?;
    tx.commit()?;
    load_entry(conn, &id)
}

pub fn create_manual(
    conn: &mut Connection,
    input: &ManualEntryInput,
    now: i64,
) -> Result<CreatedEntry> {
    let duration = validate_manual_range(input.start_at_utc, input.end_at_utc, now)?;
    let meta = resolve_meta(
        conn,
        input.description.as_deref(),
        input.project_id.as_deref(),
        input.tag_ids.as_deref(),
        input.is_billable,
        false,
    )?;
    let id = Uuid::new_v4().to_string();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO time_entries
           (id, description, project_id, start_at_utc, end_at_utc, duration_seconds,
            is_billable, source, created_at_utc, updated_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'manual', ?8, ?8)",
        rusqlite::params![
            id,
            meta.description,
            meta.project_id,
            input.start_at_utc,
            input.end_at_utc,
            duration,
            i64::from(meta.is_billable),
            now
        ],
    )?;
    repo_entries::set_entry_tags(&tx, &id, &meta.tag_ids)?;
    tx.commit()?;

    let entry = load_entry(conn, &id)?;
    let overlaps =
        repo_entries::find_overlaps(conn, input.start_at_utc, input.end_at_utc, Some(&id), now)?;
    Ok(CreatedEntry { entry, overlaps })
}

pub fn update(
    conn: &mut Connection,
    id: &str,
    input: &EntryUpdateInput,
    now: i64,
) -> Result<CreatedEntry> {
    let existing = load_entry(conn, id)?;
    if existing.deleted_at_utc.is_some() {
        return Err(AppError::not_found("Time entry not found"));
    }

    let meta = resolve_meta(
        conn,
        Some(&input.description),
        input.project_id.as_deref(),
        Some(&input.tag_ids),
        Some(input.is_billable),
        input.project_id.as_deref() == existing.project_id.as_deref(),
    )?;

    validate_timer_start(input.start_at_utc, now)?;

    let (end_at, duration) = if existing.running {
        if input.end_at_utc.is_some() {
            return Err(AppError::validation(
                "Stop the timer before setting an end time",
            ));
        }
        (None, None)
    } else {
        let Some(end) = input.end_at_utc else {
            return Err(AppError::validation("A completed entry needs an end time"));
        };
        if end % 1000 != 0 {
            return Err(AppError::validation(
                "Timestamps must be aligned to whole seconds",
            ));
        }
        if end <= input.start_at_utc {
            return Err(AppError::EndBeforeStart(
                "The end time is before the start time".into(),
            ));
        }
        let seconds = (end - input.start_at_utc) / 1000;
        let max = if existing.source == "manual" {
            crate::domain::validate::MAX_MANUAL_SECONDS
        } else {
            MAX_TIMER_EDIT_SECONDS
        };
        if seconds > max {
            return Err(AppError::validation(format!(
                "This entry cannot be longer than {} hours",
                max / 3600
            )));
        }
        (Some(end), Some(seconds))
    };

    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE time_entries
         SET description = ?1, project_id = ?2, start_at_utc = ?3, end_at_utc = ?4,
             duration_seconds = ?5, is_billable = ?6, updated_at_utc = ?7
         WHERE id = ?8",
        rusqlite::params![
            meta.description,
            meta.project_id,
            input.start_at_utc,
            end_at,
            duration,
            i64::from(meta.is_billable),
            now,
            id
        ],
    )?;
    repo_entries::set_entry_tags(&tx, id, &meta.tag_ids)?;
    tx.commit()?;

    let entry = load_entry(conn, id)?;
    let overlaps = match end_at {
        Some(end) => repo_entries::find_overlaps(conn, input.start_at_utc, end, Some(id), now)?,
        None => Vec::new(),
    };
    Ok(CreatedEntry { entry, overlaps })
}

pub fn soft_delete(conn: &Connection, id: &str, now: i64) -> Result<()> {
    let entry = load_entry(conn, id)?;
    if entry.running {
        return Err(AppError::conflict(
            "Stop the running timer before deleting it",
        ));
    }
    conn.execute(
        "UPDATE time_entries SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )?;
    Ok(())
}

pub fn restore(conn: &Connection, id: &str, now: i64) -> Result<TimeEntry> {
    repo_entries::get_entry(conn, id)?
        .ok_or_else(|| AppError::not_found("Time entry not found"))?;
    conn.execute(
        "UPDATE time_entries SET deleted_at_utc = NULL, updated_at_utc = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )?;
    load_entry(conn, id)
}

/// Sum of entry time attributable to one local calendar day.
pub fn seconds_for_local_day(
    conn: &Connection,
    date: chrono::NaiveDate,
    tz: chrono_tz::Tz,
    now: i64,
) -> Result<i64> {
    let start = day_start_ms(date, tz);
    let end = day_end_ms(date, tz);
    let entries = repo_entries::list_overlapping(conn, start, end, now, false)?;
    let mut total = 0;
    for entry in entries {
        let effective_end = entry.end_at_utc.unwrap_or(now);
        for (_, seconds) in allocation_in_range(entry.start_at_utc, effective_end, start, end, tz) {
            total += seconds;
        }
    }
    Ok(total)
}

pub fn seconds_for_day_containing(
    conn: &Connection,
    at_ms: i64,
    tz: chrono_tz::Tz,
    now: i64,
) -> Result<i64> {
    seconds_for_local_day(conn, local_date(at_ms, tz), tz, now)
}

/// Stop the running timer at a specific instant (used by idle/sleep review and crash recovery).
/// The end is clamped to now (except for the 1-second minimum duration).
pub fn stop_at(
    conn: &mut Connection,
    at_ms: i64,
    now: i64,
    new_source: Option<&str>,
) -> Result<TimeEntry> {
    let tx = conn.transaction()?;
    let active = repo_entries::get_active(&tx)?
        .ok_or_else(|| AppError::NoActiveTimer("There is no running timer".into()))?;
    let end = align_second(at_ms)
        .max(active.start_at_utc + 1000)
        .min(align_second(now).max(active.start_at_utc + 1000));
    let duration = (end - active.start_at_utc) / 1000;
    tx.execute(
        "UPDATE time_entries
         SET end_at_utc = ?1, duration_seconds = ?2, source = COALESCE(?3, source),
             updated_at_utc = ?4
         WHERE id = ?5",
        rusqlite::params![end, duration, new_source, now, active.id],
    )?;
    tx.commit()?;
    load_entry(conn, &active.id)
}

/// Start a new running timer copying metadata from a previous entry (resume / idle split).
pub fn start_from_entry(
    conn: &mut Connection,
    template_id: &str,
    start_at: i64,
    source: &str,
    now: i64,
) -> Result<TimeEntry> {
    if repo_entries::get_active(conn)?.is_some() {
        return Err(AppError::ActiveTimerExists(
            "A timer is already running".into(),
        ));
    }
    let template = load_entry(conn, template_id)?;
    let start_at = align_second(start_at);
    let tag_ids: Vec<String> = template.tags.iter().map(|t| t.id.clone()).collect();
    let meta = resolve_meta(
        conn,
        Some(&template.description),
        template.project_id.as_deref(),
        Some(&tag_ids),
        Some(template.is_billable),
        true,
    )?;
    validate_timer_start(start_at, now)?;
    let tx = conn.transaction()?;
    let id = insert_running(&tx, &meta, start_at, now, source)?;
    tx.commit()?;
    load_entry(conn, &id)
}

pub const RECOVERY_REASON_UNCLEAN: &str = "unclean_shutdown";
pub const RECOVERY_REASON_RUNNING: &str = "running_at_launch";

/// Detects a timer that was active when the previous process ended.
pub fn detect_recovery(conn: &Connection, now: i64) -> Result<Option<crate::models::RecoveryInfo>> {
    let Some(entry) = repo_entries::get_active(conn)? else {
        return Ok(None);
    };
    let clean_exit = crate::storage::repo_settings::get_runtime(conn, "clean_exit")?
        .map(|v| v == "1")
        .unwrap_or(false);
    let last_seen = crate::storage::repo_settings::get_runtime(conn, "last_heartbeat_utc")?
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| *v >= entry.start_at_utc)
        .unwrap_or(entry.start_at_utc);
    let last_seen = last_seen.min(now);
    Ok(Some(crate::models::RecoveryInfo {
        estimated_seconds: (last_seen - entry.start_at_utc).max(0) / 1000,
        last_seen_at_utc: last_seen,
        reason: if clean_exit {
            RECOVERY_REASON_RUNNING.to_string()
        } else {
            RECOVERY_REASON_UNCLEAN.to_string()
        },
        can_stop_at_last_seen: last_seen > entry.start_at_utc,
        entry,
    }))
}

pub fn resolve_recovery(
    conn: &mut Connection,
    action: &str,
    now: i64,
) -> Result<Option<TimeEntry>> {
    match action {
        "continue" => Ok(repo_entries::get_active(conn)?),
        "stop_at_last_seen" => {
            let last_seen = crate::storage::repo_settings::get_runtime(conn, "last_heartbeat_utc")?
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(now);
            Ok(Some(stop_at(conn, last_seen, now, None)?))
        }
        "stop_now" => Ok(Some(stop(conn, now)?)),
        other => Err(AppError::validation(format!(
            "Unknown recovery action: {other}"
        ))),
    }
}
