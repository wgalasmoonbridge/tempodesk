//! Device-local session observations. Never creates or changes time entries.
use rusqlite::Connection;

use crate::domain::portability::{validate_destination, write_atomic};
use crate::error::{AppError, Result};
use crate::models::{
    ExportResult, MachineActivityEvent, MachineActivityFilter, MachineActivityPage, MachineSession,
};
use crate::storage::{repo_machine_activity as repo, repo_settings};

const DAY_MS: i64 = 86_400_000;

pub fn retention_cutoff(days: u32, now: i64) -> i64 {
    now.saturating_sub(i64::from(days.clamp(1, 365)) * DAY_MS)
        .max(0)
}

pub fn prune(conn: &Connection, now: i64) -> Result<usize> {
    let settings = repo_settings::load(conn)?;
    repo::prune(
        conn,
        retention_cutoff(settings.machine_activity_retention_days, now),
    )
}

pub fn list(
    conn: &Connection,
    filter: &MachineActivityFilter,
    now: i64,
) -> Result<MachineActivityPage> {
    prune(conn, now)?;
    repo::list(conn, filter)
}

fn event(
    session: &MachineSession,
    kind: &str,
    at: i64,
    now: i64,
    source: &str,
    timing: &str,
) -> MachineActivityEvent {
    MachineActivityEvent {
        id: uuid::Uuid::new_v4().to_string(),
        account_id: session.account_id.clone(),
        user_name: session.user_name.clone(),
        domain: session.domain.clone(),
        machine_name: session.machine_name.clone(),
        session_id: session.session_id.clone(),
        kind: kind.into(),
        event_at_utc: at.div_euclid(1000) * 1000,
        observed_at_utc: now.div_euclid(1000) * 1000,
        source: source.into(),
        timing: timing.into(),
    }
}

/// The baseline is reset after monitoring gaps, so sleep, failures, and enabling monitoring
/// cannot fabricate a lock/unlock or login transition. Native notifications update the same
/// baseline to avoid also recording their sampled equivalent.
#[derive(Default)]
pub struct SessionTracker {
    previous: Option<MachineSession>,
}

impl SessionTracker {
    pub fn reset(&mut self) {
        self.previous = None;
    }

    pub fn observe(
        &mut self,
        current: &MachineSession,
        now: i64,
        source: &str,
        sample_locks: bool,
        sample_active: bool,
    ) -> Vec<MachineActivityEvent> {
        let same_session = self.previous.as_ref().is_some_and(|old| {
            old.account_id == current.account_id
                && old.machine_name == current.machine_name
                && old.session_id == current.session_id
                && !matches!((old.login_at_utc, current.login_at_utc), (Some(a), Some(b)) if a != b)
        });
        let mut events = Vec::new();
        if !same_session {
            events.push(event(
                current,
                "session_observed",
                now,
                now,
                source,
                "observed",
            ));
        }
        if let Some(login) = current
            .login_at_utc
            .filter(|value| *value >= 0 && *value <= now)
        {
            if !same_session
                || self.previous.as_ref().and_then(|old| old.login_at_utc) != Some(login)
            {
                events.push(event(current, "login", login, now, source, "os_reported"));
            }
        }
        if same_session {
            let old = self.previous.as_ref().expect("same session has a baseline");
            if sample_locks && matches!((old.locked, current.locked), (Some(a), Some(b)) if a != b)
            {
                events.push(event(
                    current,
                    if current.locked == Some(true) {
                        "lock"
                    } else {
                        "unlock"
                    },
                    now,
                    now,
                    source,
                    "sampled",
                ));
            }
            if sample_active && matches!((old.active, current.active), (Some(a), Some(b)) if a != b)
            {
                events.push(event(
                    current,
                    if current.active == Some(true) {
                        "session_active"
                    } else {
                        "session_inactive"
                    },
                    now,
                    now,
                    source,
                    "sampled",
                ));
            }
        }
        self.previous = Some(current.clone());
        events
    }

    pub fn notification(
        &mut self,
        kind: &str,
        at: i64,
        source: &str,
    ) -> Option<MachineActivityEvent> {
        let session = self.previous.as_mut()?;
        let (target, value) = match kind {
            "lock" => (&mut session.locked, true),
            "unlock" => (&mut session.locked, false),
            "session_active" => (&mut session.active, true),
            "session_inactive" => (&mut session.active, false),
            "logoff" => return Some(event(session, kind, at, at, source, "notification")),
            // A native logon signal has no authoritative login timestamp. A subsequent OS
            // session query records the actual login, rather than treating receipt as login time.
            _ => return None,
        };
        if *target == Some(value) {
            return None;
        }
        *target = Some(value);
        Some(event(session, kind, at, at, source, "notification"))
    }
}

/// Rechecks durable consent while holding the caller's DB lock, including for notifications
/// queued before disable/restore. Login deduplication survives app restarts.
pub fn record(conn: &Connection, events: &[MachineActivityEvent], now: i64) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let settings = repo_settings::load(&tx)?;
    let cutoff = retention_cutoff(settings.machine_activity_retention_days, now);
    let cleared_at = repo_settings::get_runtime(&tx, "machine_activity_cleared_at_utc")?
        .and_then(|value| value.parse::<i64>().ok());
    repo::prune(&tx, cutoff)?;
    let mut inserted = 0;
    if settings.machine_activity_enabled {
        for event in events {
            validate_event(event)?;
            if event.event_at_utc < cutoff || cleared_at.is_some_and(|at| event.event_at_utc <= at)
            {
                continue;
            }
            let key = if event.kind == "login" {
                Some(serde_json::to_string(&(
                    &event.account_id,
                    &event.machine_name,
                    &event.session_id,
                    event.event_at_utc,
                ))?)
            } else {
                None
            };
            inserted += usize::from(repo::insert(&tx, event, key.as_deref())?);
        }
    }
    tx.commit()?;
    Ok(inserted)
}

/// Clearing also suppresses already-queued notifications and re-import of this session's old
/// login time on restart. New observations continue if monitoring remains enabled.
pub fn clear(conn: &Connection, now: i64) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let count = repo::clear(&tx)?;
    repo_settings::set_runtime(&tx, "machine_activity_cleared_at_utc", &now.to_string())?;
    tx.commit()?;
    Ok(count)
}

fn validate_event(event: &MachineActivityEvent) -> Result<()> {
    if !matches!(
        event.kind.as_str(),
        "login"
            | "session_observed"
            | "lock"
            | "unlock"
            | "session_active"
            | "session_inactive"
            | "logoff"
    ) || !matches!(
        event.timing.as_str(),
        "os_reported" | "notification" | "sampled" | "observed"
    ) || (event.kind == "login" && event.timing != "os_reported")
        || event.event_at_utc < 0
        || event.event_at_utc > event.observed_at_utc
        || event.event_at_utc % 1000 != 0
        || event.observed_at_utc % 1000 != 0
        || [
            &event.account_id,
            &event.user_name,
            &event.machine_name,
            &event.source,
        ]
        .iter()
        .any(|value| value.trim().is_empty() || value.len() > 1024)
        || event
            .domain
            .as_ref()
            .is_some_and(|value| value.len() > 1024)
        || event
            .session_id
            .as_ref()
            .is_some_and(|value| value.len() > 1024)
    {
        return Err(AppError::validation("Invalid machine activity observation"));
    }
    Ok(())
}

fn csv_cell(raw: &str) -> String {
    // Account and machine names are OS-controlled strings, not trusted spreadsheet formulas.
    let raw = if raw.trim_start().starts_with(['=', '+', '-', '@'])
        || raw.starts_with(['\t', '\r', '\n'])
    {
        format!("'{raw}")
    } else {
        raw.to_string()
    };
    format!("\"{}\"", raw.replace('"', "\"\""))
}

pub fn export_csv(
    conn: &Connection,
    filter: &MachineActivityFilter,
    destination: &str,
    now: i64,
) -> Result<ExportResult> {
    let path = validate_destination(destination, "csv")?;
    prune(conn, now)?;
    let mut filter = filter.clone();
    filter.offset = Some(0);
    filter.limit = Some(500);
    let mut page = repo::list(conn, &filter)?;
    if page.total_count > 100_000 {
        return Err(AppError::validation(
            "Choose a smaller range to export at most 100,000 activity events",
        ));
    }
    let mut csv = "event,event_at_utc,observed_at_utc,account_id,user_name,domain,machine_name,session_id,source,timing\r\n".to_string();
    let mut count = 0;
    loop {
        for event in &page.events {
            let values = [
                event.kind.clone(),
                event.event_at_utc.to_string(),
                event.observed_at_utc.to_string(),
                event.account_id.clone(),
                event.user_name.clone(),
                event.domain.clone().unwrap_or_default(),
                event.machine_name.clone(),
                event.session_id.clone().unwrap_or_default(),
                event.source.clone(),
                event.timing.clone(),
            ];
            csv.push_str(
                &values
                    .iter()
                    .map(|value| csv_cell(value))
                    .collect::<Vec<_>>()
                    .join(","),
            );
            csv.push_str("\r\n");
            count += 1;
        }
        if count >= page.total_count {
            break;
        }
        filter.offset = Some(count as u32);
        page = repo::list(conn, &filter)?;
    }
    write_atomic(&path, csv.as_bytes())?;
    Ok(ExportResult {
        path: path.display().to_string(),
        row_count: count,
        total_seconds: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SettingsPatch;
    use crate::storage::db;

    fn session() -> MachineSession {
        MachineSession {
            account_id: "uid:1000".into(),
            user_name: "Person".into(),
            domain: None,
            machine_name: "Laptop".into(),
            session_id: Some("2".into()),
            login_at_utc: Some(1000),
            locked: Some(false),
            active: Some(true),
        }
    }
    fn enable(conn: &Connection) {
        repo_settings::update(
            conn,
            &SettingsPatch {
                machine_activity_enabled: Some(true),
                ..Default::default()
            },
            0,
        )
        .unwrap();
    }

    #[test]
    fn consent_and_login_deduplication_survive_restarts() {
        let conn = db::open_in_memory().unwrap();
        let events = SessionTracker::default().observe(&session(), 10_000, "test", true, true);
        assert_eq!(record(&conn, &events, 10_000).unwrap(), 0);
        enable(&conn);
        assert_eq!(record(&conn, &events, 10_000).unwrap(), 2);
        let restarted = SessionTracker::default().observe(&session(), 20_000, "test", true, true);
        assert_eq!(record(&conn, &restarted, 20_000).unwrap(), 1);
        let page = list(&conn, &MachineActivityFilter::default(), 20_000).unwrap();
        assert_eq!(
            page.events
                .iter()
                .filter(|event| event.kind == "login")
                .count(),
            1
        );
        assert_eq!(
            page.events
                .iter()
                .find(|event| event.kind == "login")
                .unwrap()
                .event_at_utc,
            1000
        );
        assert!(crate::storage::repo_entries::get_active(&conn)
            .unwrap()
            .is_none());
        let report = crate::domain::reports::get_report(
            &conn,
            &crate::models::ReportFilter {
                date_from: "1970-01-01".into(),
                date_to: "1970-01-01".into(),
                timezone: "UTC".into(),
                project_id: None,
                client_id: None,
                tag_id: None,
                billable: None,
                search: None,
            },
            20_000,
        )
        .unwrap();
        assert_eq!(report.entry_count, 0);
        let prompt = crate::domain::summary::build_ai_prompt(&report, true);
        assert!(!prompt.contains("Person"));
        assert!(!prompt.contains("uid:1000"));
        repo_settings::update(
            &conn,
            &SettingsPatch {
                machine_activity_enabled: Some(false),
                ..Default::default()
            },
            0,
        )
        .unwrap();
        assert_eq!(record(&conn, &restarted, 20_000).unwrap(), 0);
    }

    #[test]
    fn unknown_times_states_and_monitoring_gaps_never_invent_events() {
        let mut tracker = SessionTracker::default();
        let mut current = session();
        current.login_at_utc = None;
        current.locked = None;
        let events = tracker.observe(&current, 10_000, "test", true, true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "session_observed");
        current.locked = Some(true);
        assert!(tracker
            .observe(&current, 11_000, "test", true, true)
            .is_empty());
        current.locked = Some(false);
        assert_eq!(
            tracker.observe(&current, 12_000, "test", true, true)[0].kind,
            "unlock"
        );
        tracker.reset();
        current.locked = Some(true);
        let events = tracker.observe(&current, 13_000, "test", true, true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "session_observed");
        current.login_at_utc = Some(14_000);
        assert!(tracker
            .observe(&current, 13_000, "test", true, true)
            .is_empty());
    }

    #[test]
    fn native_notifications_are_deduplicated_and_do_not_imply_login() {
        let mut tracker = SessionTracker::default();
        tracker.observe(&session(), 10_000, "test", false, false);
        assert!(tracker.notification("login", 11_000, "test").is_none());
        assert_eq!(
            tracker.notification("lock", 11_000, "test").unwrap().timing,
            "notification"
        );
        assert!(tracker.notification("lock", 11_000, "test").is_none());
        let mut current = session();
        current.locked = Some(true);
        assert!(tracker
            .observe(&current, 12_000, "test", true, true)
            .is_empty());
        assert_eq!(
            tracker.notification("unlock", 13_000, "test").unwrap().kind,
            "unlock"
        );
    }

    #[test]
    fn retention_and_filtering_apply_even_when_disabled() {
        let conn = db::open_in_memory().unwrap();
        enable(&conn);
        let events = SessionTracker::default().observe(&session(), 10_000, "test", true, true);
        record(&conn, &events, 10_000).unwrap();
        let filter = MachineActivityFilter {
            from_utc: Some(1000),
            to_utc: Some(10_000),
            limit: Some(1),
            ..Default::default()
        };
        assert_eq!(list(&conn, &filter, 10_000).unwrap().total_count, 1);
        assert!(list(
            &conn,
            &MachineActivityFilter {
                from_utc: Some(2),
                to_utc: Some(1),
                ..Default::default()
            },
            10_000
        )
        .is_err());
        repo_settings::update(
            &conn,
            &SettingsPatch {
                machine_activity_enabled: Some(false),
                machine_activity_retention_days: Some(1),
                ..Default::default()
            },
            0,
        )
        .unwrap();
        assert_eq!(
            list(&conn, &MachineActivityFilter::default(), DAY_MS + 20_000)
                .unwrap()
                .total_count,
            0
        );
        assert!(repo_settings::update(
            &conn,
            &SettingsPatch {
                machine_activity_retention_days: Some(0),
                ..Default::default()
            },
            0
        )
        .is_err());
    }

    #[test]
    fn csv_exports_the_entire_range_not_just_one_page_and_clear_is_separate() {
        let conn = db::open_in_memory().unwrap();
        enable(&conn);
        let mut current = session();
        current.user_name = "=FORMULA,\"quoted\"".into();
        let events: Vec<_> = (0..510)
            .map(|i| {
                event(
                    &current,
                    "session_observed",
                    i * 1000,
                    i * 1000,
                    "test",
                    "observed",
                )
            })
            .collect();
        record(&conn, &events, 510_000).unwrap();
        let path =
            std::env::temp_dir().join(format!("tempodesk-activity-{}.csv", uuid::Uuid::new_v4()));
        let result = export_csv(
            &conn,
            &MachineActivityFilter {
                limit: Some(1),
                offset: Some(500),
                ..Default::default()
            },
            path.to_str().unwrap(),
            510_000,
        )
        .unwrap();
        assert_eq!(result.row_count, 510);
        let csv = std::fs::read_to_string(&path).unwrap();
        assert_eq!(csv.lines().count(), 511);
        assert!(csv.contains("'"));
        assert!(csv.contains("\"\"quoted\"\""));
        std::fs::remove_file(path).unwrap();
        assert_eq!(repo::clear(&conn).unwrap(), 510);
    }

    #[test]
    fn clear_suppresses_pending_events_and_old_logins_after_restart() {
        let conn = db::open_in_memory().unwrap();
        enable(&conn);
        let events = SessionTracker::default().observe(&session(), 10_000, "test", true, true);
        record(&conn, &events, 10_000).unwrap();
        assert_eq!(clear(&conn, 11_123).unwrap(), 2);
        assert_eq!(record(&conn, &events, 12_000).unwrap(), 0);
        let restarted = SessionTracker::default().observe(&session(), 12_000, "test", true, true);
        assert_eq!(record(&conn, &restarted, 12_000).unwrap(), 1);
        let page = list(&conn, &MachineActivityFilter::default(), 12_000).unwrap();
        assert_eq!(page.events[0].kind, "session_observed");
        let mut new_session = session();
        new_session.login_at_utc = Some(13_000);
        let events = SessionTracker::default().observe(&new_session, 14_000, "test", true, true);
        assert_eq!(record(&conn, &events, 14_000).unwrap(), 2);
    }

    #[test]
    fn invalid_observations_roll_back_the_whole_batch() {
        let conn = db::open_in_memory().unwrap();
        enable(&conn);
        let mut events = SessionTracker::default().observe(&session(), 10_000, "test", true, true);
        events[1].timing = "observed".into(); // A login requires an actual OS-reported time.
        assert!(record(&conn, &events, 10_000).is_err());
        assert_eq!(
            repo::list(&conn, &MachineActivityFilter::default())
                .unwrap()
                .total_count,
            0
        );
    }

    #[test]
    fn portable_backups_exclude_identity_and_never_enable_monitoring_on_restore() {
        let mut conn = db::open_in_memory().unwrap();
        enable(&conn);
        repo_settings::update(
            &conn,
            &SettingsPatch {
                machine_activity_retention_days: Some(90),
                ..Default::default()
            },
            0,
        )
        .unwrap();
        repo_settings::set_runtime(&conn, "machine_activity_cleared_at_utc", "500").unwrap();
        let events = SessionTracker::default().observe(&session(), 10_000, "test", true, true);
        record(&conn, &events, 10_000).unwrap();
        let document = crate::domain::portability::build_document(&conn, "test", 10_000).unwrap();
        let json = serde_json::to_string(&document).unwrap();
        assert!(!json.contains("uid:1000"));
        assert!(!json.contains("Person"));
        assert!(!document.settings.contains_key("machineActivityEnabled"));
        let dir = std::env::temp_dir().join(format!("tempodesk-activity-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("backup.json");
        // Even a hand-edited/old backup cannot grant consent.
        let mut document = document;
        document
            .settings
            .insert("machineActivityEnabled".into(), serde_json::json!(true));
        std::fs::write(&path, serde_json::to_vec(&document).unwrap()).unwrap();
        crate::domain::portability::restore_backup(
            &mut conn,
            path.to_str().unwrap(),
            &dir,
            "test",
            11_000,
        )
        .unwrap();
        let settings = repo_settings::load(&conn).unwrap();
        assert!(!settings.machine_activity_enabled);
        assert_eq!(settings.machine_activity_retention_days, 90);
        assert_eq!(
            repo_settings::get_runtime(&conn, "machine_activity_cleared_at_utc")
                .unwrap()
                .as_deref(),
            Some("500")
        );
        assert_eq!(
            repo::list(&conn, &MachineActivityFilter::default())
                .unwrap()
                .total_count,
            2
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
