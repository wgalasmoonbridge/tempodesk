use rusqlite::Connection;

use crate::domain::timer;
use crate::domain::timeutil::align_second;
use crate::error::{AppError, Result};
use crate::models::IdleReview;
use crate::storage::{repo_entries, repo_idle};

pub const ACTION_KEEP: &str = "keep";
pub const ACTION_EXCLUDE: &str = "exclude";
pub const ACTION_STOP_AT_IDLE: &str = "stop_at_idle";

/// Create at most one pending review per idle episode while a timer is running.
pub fn create_idle_review(
    conn: &Connection,
    idle_seconds: i64,
    now: i64,
) -> Result<Option<IdleReview>> {
    let Some(active) = repo_entries::get_active(conn)? else {
        return Ok(None);
    };
    if repo_idle::has_pending_for_entry(conn, &active.id)? {
        return Ok(None);
    }
    let idle_started = (now - idle_seconds.saturating_mul(1000)).max(active.start_at_utc);
    let review = repo_idle::insert(conn, "idle", &active.id, idle_started, None, now)?;
    Ok(Some(review))
}

/// Process-sleep / suspend gap: a heartbeat gap while a timer runs is queued for review.
pub fn create_sleep_review(
    conn: &Connection,
    last_heartbeat_utc: i64,
    now: i64,
) -> Result<Option<IdleReview>> {
    let Some(active) = repo_entries::get_active(conn)? else {
        return Ok(None);
    };
    if repo_idle::has_pending_for_entry(conn, &active.id)? {
        return Ok(None);
    }
    let idle_started = last_heartbeat_utc.max(active.start_at_utc).min(now);
    let review = repo_idle::insert(conn, "sleep", &active.id, idle_started, Some(now), now)?;
    Ok(Some(review))
}

/// Mark the user as active again on all pending, un-resumed idle reviews.
pub fn mark_activity_resumed(conn: &Connection, now: i64) -> Result<()> {
    let pending = repo_idle::list_pending(conn)?;
    for review in pending {
        if review.activity_resumed_at_utc.is_none() {
            repo_idle::set_resumed(conn, &review.id, now)?;
        }
    }
    Ok(())
}

/// Resolve a pending review. Never deletes tracked time without an explicit action:
/// - keep: the idle interval stays tracked
/// - exclude: the session is split, the idle gap becomes untracked, both segments persist
/// - stop_at_idle: the session ends at the idle start
pub fn resolve(
    conn: &mut Connection,
    review_id: &str,
    action: &str,
    now: i64,
) -> Result<IdleReview> {
    if !matches!(action, ACTION_KEEP | ACTION_EXCLUDE | ACTION_STOP_AT_IDLE) {
        return Err(AppError::validation("Unknown idle review action"));
    }
    let review = repo_idle::get(conn, review_id)?;
    if review.status != "pending" {
        return Err(AppError::conflict("This idle review was already resolved"));
    }
    let Some(entry_id) = review.timer_entry_id.clone() else {
        repo_idle::mark_resolved(conn, review_id, "stale", None, now)?;
        return repo_idle::get(conn, review_id);
    };
    let active = repo_entries::get_active(conn)?.filter(|entry| entry.id == entry_id);
    let Some(active) = active else {
        repo_idle::mark_resolved(conn, review_id, "stale", Some(&entry_id), now)?;
        return repo_idle::get(conn, review_id);
    };

    match action {
        ACTION_KEEP => {
            repo_idle::mark_resolved(conn, review_id, "keep", Some(&entry_id), now)?;
        }
        ACTION_STOP_AT_IDLE => {
            let stopped = timer::stop_at(
                conn,
                review.idle_started_at_utc.max(active.start_at_utc),
                now,
                Some("idle_adjustment"),
            )?;
            repo_idle::mark_resolved(conn, review_id, "stop_at_idle", Some(&stopped.id), now)?;
        }
        ACTION_EXCLUDE => {
            let stopped = timer::stop_at(
                conn,
                review.idle_started_at_utc.max(active.start_at_utc),
                now,
                Some("idle_adjustment"),
            )?;
            let stop_end = stopped.end_at_utc.unwrap_or(now);
            let resumed_at =
                align_second(review.activity_resumed_at_utc.unwrap_or(now).min(now)).max(stop_end);
            let resumed = timer::start_from_entry(conn, &stopped.id, resumed_at, "timer", now)?;
            repo_idle::mark_resolved(conn, review_id, "exclude", Some(&resumed.id), now)?;
        }
        _ => unreachable!(),
    }
    repo_idle::get(conn, review_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::StartTimerInput;
    use crate::storage::{db, repo_settings};

    fn active_input() -> StartTimerInput {
        StartTimerInput {
            description: Some("Work".into()),
            project_id: None,
            tag_ids: None,
            is_billable: Some(false),
        }
    }

    #[test]
    fn idle_episode_creates_one_review_and_keep_preserves_time() {
        let mut conn = db::open_in_memory().unwrap();
        let start = 1_800_000_000_000;
        timer::start(&mut conn, &active_input(), start).unwrap();
        let now = start + 30 * 60 * 1000;
        let review = create_idle_review(&conn, 300, now).unwrap().unwrap();
        assert_eq!(review.kind, "idle");
        assert_eq!(review.idle_started_at_utc, now - 300_000);
        // No second review for the same episode.
        assert!(create_idle_review(&conn, 400, now + 1000)
            .unwrap()
            .is_none());

        mark_activity_resumed(&conn, now + 5000).unwrap();
        let resolved = resolve(&mut conn, &review.id, ACTION_KEEP, now + 6000).unwrap();
        assert_eq!(resolved.status, "keep");
        let active = repo_entries::get_active(&conn).unwrap().unwrap();
        assert_eq!(active.id, review.timer_entry_id.unwrap());
    }

    #[test]
    fn exclude_splits_into_two_audited_segments_without_losing_time() {
        let mut conn = db::open_in_memory().unwrap();
        let start = 1_800_000_000_000;
        timer::start(&mut conn, &active_input(), start).unwrap();
        let idle_start = start + 10 * 60 * 1000;
        let resumed = idle_start + 5 * 60 * 1000;
        let review = repo_idle::insert(
            &conn,
            "idle",
            &repo_entries::get_active(&conn).unwrap().unwrap().id,
            idle_start,
            Some(resumed),
            resumed,
        )
        .unwrap();
        let resolved = resolve(&mut conn, &review.id, ACTION_EXCLUDE, resumed + 1000).unwrap();
        assert_eq!(resolved.status, "exclude");
        let entries =
            repo_entries::list_entries(&conn, &Default::default(), None, None, resumed + 1000)
                .unwrap();
        assert_eq!(entries.len(), 2);
        let stopped = entries.iter().find(|e| !e.running).unwrap();
        assert_eq!(stopped.end_at_utc, Some(idle_start));
        assert_eq!(stopped.duration_seconds, Some(600));
        let running = entries.iter().find(|e| e.running).unwrap();
        assert_eq!(running.start_at_utc, resumed);
        assert_eq!(running.description, "Work");
    }

    #[test]
    fn stop_at_idle_ends_session_at_idle_start() {
        let mut conn = db::open_in_memory().unwrap();
        let start = 1_800_000_000_000;
        timer::start(&mut conn, &active_input(), start).unwrap();
        let idle_start = start + 7 * 60 * 1000;
        let review = repo_idle::insert(
            &conn,
            "idle",
            &repo_entries::get_active(&conn).unwrap().unwrap().id,
            idle_start,
            Some(idle_start + 60_000),
            idle_start + 60_000,
        )
        .unwrap();
        resolve(
            &mut conn,
            &review.id,
            ACTION_STOP_AT_IDLE,
            idle_start + 60_000,
        )
        .unwrap();
        assert!(repo_entries::get_active(&conn).unwrap().is_none());
        let entry = repo_entries::get_entry(&conn, &review.timer_entry_id.unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(entry.end_at_utc, Some(idle_start));
    }

    #[test]
    fn review_becomes_stale_if_timer_was_stopped_elsewhere() {
        let mut conn = db::open_in_memory().unwrap();
        let start = 1_800_000_000_000;
        timer::start(&mut conn, &active_input(), start).unwrap();
        let entry_id = repo_entries::get_active(&conn).unwrap().unwrap().id;
        let review = repo_idle::insert(
            &conn,
            "sleep",
            &entry_id,
            start,
            Some(start + 60_000),
            start + 60_000,
        )
        .unwrap();
        timer::stop(&mut conn, start + 120_000).unwrap();
        let resolved = resolve(&mut conn, &review.id, ACTION_KEEP, start + 130_000).unwrap();
        assert_eq!(resolved.status, "stale");
    }

    #[test]
    fn recovery_detection_and_stop_at_last_heartbeat() {
        let mut conn = db::open_in_memory().unwrap();
        let start = 1_800_000_000_000;
        timer::start(&mut conn, &active_input(), start).unwrap();
        repo_settings::set_runtime(&conn, "clean_exit", "0").unwrap();
        repo_settings::set_runtime(&conn, "last_heartbeat_utc", &(start + 60_000).to_string())
            .unwrap();
        let recovery = timer::detect_recovery(&conn, start + 10 * 60_000)
            .unwrap()
            .unwrap();
        assert_eq!(recovery.reason, "unclean_shutdown");
        assert_eq!(recovery.estimated_seconds, 60);
        timer::resolve_recovery(&mut conn, "stop_at_last_seen", start + 10 * 60_000).unwrap();
        assert!(repo_entries::get_active(&conn).unwrap().is_none());
        let entry = repo_entries::get_entry(&conn, &recovery.entry.id)
            .unwrap()
            .unwrap();
        assert_eq!(entry.duration_seconds, Some(60));
    }

    #[test]
    fn clean_quit_with_running_timer_is_still_reviewable() {
        let mut conn = db::open_in_memory().unwrap();
        let start = 1_800_000_000_000;
        timer::start(&mut conn, &active_input(), start).unwrap();
        repo_settings::set_runtime(&conn, "clean_exit", "1").unwrap();
        repo_settings::set_runtime(&conn, "last_heartbeat_utc", &(start + 120_000).to_string())
            .unwrap();
        let recovery = timer::detect_recovery(&conn, start + 600_000)
            .unwrap()
            .unwrap();
        assert_eq!(recovery.reason, "running_at_launch");
        assert_eq!(recovery.estimated_seconds, 120);
    }
}

#[cfg(test)]
mod timestamp_tests {
    use super::*;
    use crate::models::StartTimerInput;
    use crate::storage::db;

    #[test]
    fn stop_aligns_millisecond_wall_clock_to_whole_seconds() {
        let mut conn = db::open_in_memory().unwrap();
        let start = 1_800_000_000_000;
        timer::start(
            &mut conn,
            &StartTimerInput {
                description: Some("ms".into()),
                project_id: None,
                tag_ids: None,
                is_billable: Some(false),
            },
            start,
        )
        .unwrap();
        // Deliberately unaligned wall clock (123 ms past the second).
        let stopped = timer::stop(&mut conn, start + 12_345).unwrap();
        assert_eq!(stopped.end_at_utc, Some(start + 12_000));
        assert_eq!(stopped.duration_seconds, Some(12));
    }

    #[test]
    fn idle_split_aligns_resume_timestamp() {
        let mut conn = db::open_in_memory().unwrap();
        let start = 1_800_000_000_000;
        timer::start(
            &mut conn,
            &StartTimerInput {
                description: Some("idle".into()),
                project_id: None,
                tag_ids: None,
                is_billable: Some(false),
            },
            start,
        )
        .unwrap();
        let idle_start = start + 600_000;
        let resumed = idle_start + 300_000 + 456; // unaligned
        let entry_id = repo_entries::get_active(&conn).unwrap().unwrap().id;
        let review = repo_idle::insert(
            &conn,
            "idle",
            &entry_id,
            idle_start + 78,
            Some(resumed),
            resumed,
        )
        .unwrap();
        super::resolve(&mut conn, &review.id, ACTION_EXCLUDE, resumed + 999).unwrap();
        let entries =
            repo_entries::list_entries(&conn, &Default::default(), None, None, resumed + 999)
                .unwrap();
        let running = entries.iter().find(|entry| entry.running).unwrap();
        assert_eq!(running.start_at_utc % 1000, 0);
    }
}
