//! Integration tests for shared filtering, report/CSV consistency, and 10k-entry performance.

use std::time::Instant;

use tempodesk_core::domain::{portability, reports, timer, timeutil};
use tempodesk_core::models::{
    ClientInput, EntryFilter, ManualEntryInput, ProjectInput, ReportFilter, TagInput,
};
use tempodesk_core::storage::{db, repo_clients, repo_entries, repo_projects, repo_tags};

const UTC_DAY: i64 = 86_400_000;

fn ms(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
    use chrono::TimeZone;
    chrono_tz::UTC
        .with_ymd_and_hms(y, m, d, h, min, 0)
        .single()
        .unwrap()
        .timestamp_millis()
}

#[allow(clippy::too_many_arguments)]
fn add_manual(
    conn: &mut rusqlite::Connection,
    start: i64,
    end: i64,
    description: &str,
    project_id: Option<String>,
    tag_ids: Vec<String>,
    billable: bool,
    now: i64,
) -> String {
    timer::create_manual(
        conn,
        &ManualEntryInput {
            description: Some(description.into()),
            project_id,
            tag_ids: Some(tag_ids),
            is_billable: Some(billable),
            start_at_utc: start,
            end_at_utc: end,
        },
        now,
    )
    .unwrap()
    .entry
    .id
}

struct Fixture {
    conn: rusqlite::Connection,
    project_alpha: String,
    project_beta: String,
    client: String,
    tag: String,
    now: i64,
}

fn fixture() -> Fixture {
    let mut conn = db::open_in_memory().unwrap();
    let now = ms(2026, 6, 15, 12, 0);
    let client = repo_clients::save(
        &conn,
        &ClientInput {
            id: None,
            name: "Acme".into(),
        },
        now,
    )
    .unwrap();
    let project_alpha = repo_projects::save(
        &conn,
        &ProjectInput {
            id: None,
            name: "Alpha".into(),
            color: None,
            client_id: Some(client.id.clone()),
            default_billable: Some(false),
        },
        now,
    )
    .unwrap();
    let project_beta = repo_projects::save(
        &conn,
        &ProjectInput {
            id: None,
            name: "Beta".into(),
            color: None,
            client_id: None,
            default_billable: None,
        },
        now,
    )
    .unwrap();
    let tag = repo_tags::save(
        &conn,
        &TagInput {
            id: None,
            name: "focus".into(),
            color: None,
        },
        now,
    )
    .unwrap();

    add_manual(
        &mut conn,
        ms(2026, 6, 15, 9, 0),
        ms(2026, 6, 15, 10, 0),
        "Alpha work",
        Some(project_alpha.id.clone()),
        vec![tag.id.clone()],
        true,
        now,
    );
    add_manual(
        &mut conn,
        ms(2026, 6, 15, 10, 0),
        ms(2026, 6, 15, 11, 0),
        "Beta work",
        Some(project_beta.id.clone()),
        vec![],
        false,
        now,
    );
    add_manual(
        &mut conn,
        ms(2026, 6, 15, 11, 0),
        ms(2026, 6, 15, 11, 30),
        "Admin 100%",
        None,
        vec![],
        false,
        now,
    );

    Fixture {
        conn,
        project_alpha: project_alpha.id,
        project_beta: project_beta.id,
        client: client.id,
        tag: tag.id,
        now,
    }
}

#[test]
fn entry_filters_share_one_computation() {
    let f = fixture();
    let base = EntryFilter {
        date_from: Some("2026-06-15".into()),
        date_to: Some("2026-06-15".into()),
        timezone: Some("UTC".into()),
        limit: Some(100),
        ..Default::default()
    };
    let db = &f.conn;

    let all = repo_entries::list_entries(
        db,
        &base,
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(all.len(), 3);

    let by_project = repo_entries::list_entries(
        db,
        &EntryFilter {
            project_id: Some(f.project_alpha.clone()),
            ..base.clone()
        },
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(by_project.len(), 1);
    assert_eq!(by_project[0].description, "Alpha work");

    let by_client = repo_entries::list_entries(
        db,
        &EntryFilter {
            client_id: Some(f.client.clone()),
            ..base.clone()
        },
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(by_client.len(), 1);

    let by_tag = repo_entries::list_entries(
        db,
        &EntryFilter {
            tag_ids: Some(vec![f.tag.clone()]),
            ..base.clone()
        },
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(by_tag.len(), 1);
    assert!(by_tag[0].is_billable);

    let billable = repo_entries::list_entries(
        db,
        &EntryFilter {
            billable: Some(true),
            ..base.clone()
        },
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(billable.len(), 1);

    let search = repo_entries::list_entries(
        db,
        &EntryFilter {
            search: Some("ALPHA".into()),
            ..base.clone()
        },
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(search.len(), 1);

    // LIKE wildcards must be treated literally.
    let literal = repo_entries::list_entries(
        db,
        &EntryFilter {
            search: Some("100%".into()),
            ..base.clone()
        },
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(literal.len(), 1);
    let wildcard_only = repo_entries::list_entries(
        db,
        &EntryFilter {
            search: Some("%".into()),
            ..base.clone()
        },
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(wildcard_only.len(), 1);
    assert_eq!(wildcard_only[0].description, "Admin 100%");

    let sorted = repo_entries::list_entries(
        db,
        &EntryFilter {
            sort: Some("start_asc".into()),
            ..base.clone()
        },
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(sorted[0].description, "Alpha work");
    assert_eq!(sorted[2].description, "Admin 100%");

    // Soft delete hides entries by default but not with includeDeleted.
    let admin = all
        .iter()
        .find(|entry| entry.description == "Admin 100%")
        .unwrap();
    timer::soft_delete(db, &admin.id, f.now + 1000).unwrap();
    let visible = repo_entries::list_entries(
        db,
        &base,
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(visible.len(), 2);
    let including = repo_entries::list_entries(
        db,
        &EntryFilter {
            include_deleted: Some(true),
            ..base.clone()
        },
        Some(ms(2026, 6, 15, 0, 0)),
        Some(ms(2026, 6, 16, 0, 0)),
        f.now,
    )
    .unwrap();
    assert_eq!(including.len(), 3);
}

#[test]
fn report_and_csv_filters_match() {
    let f = fixture();
    for (project, expected) in [
        (Some(f.project_alpha.clone()), 3600),
        (Some(f.project_beta.clone()), 3600),
        (None, 9000),
    ] {
        let filter = ReportFilter {
            date_from: "2026-06-15".into(),
            date_to: "2026-06-15".into(),
            timezone: "UTC".into(),
            project_id: project,
            client_id: None,
            tag_id: None,
            billable: None,
            search: None,
        };
        let report = reports::get_report(&f.conn, &filter, f.now).unwrap();
        assert_eq!(report.total_seconds, expected);
        let (csv, rows, total) = reports::build_csv(&f.conn, &filter, f.now).unwrap();
        assert_eq!(rows, report.entry_count);
        assert_eq!(total, report.total_seconds);
        assert_eq!(
            csv.lines().filter(|line| !line.trim().is_empty()).count() as i64,
            rows + 1
        );
        assert!(csv.contains("UTC") || csv.contains("Entry ID"));
    }

    let filter = ReportFilter {
        date_from: "2026-06-15".into(),
        date_to: "2026-06-15".into(),
        timezone: "UTC".into(),
        project_id: None,
        client_id: Some(f.client.clone()),
        tag_id: Some(f.tag.clone()),
        billable: Some(true),
        search: None,
    };
    let report = reports::get_report(&f.conn, &filter, f.now).unwrap();
    assert_eq!(report.total_seconds, 3600);
    assert_eq!(report.by_client[0].name, "Acme");
    assert_eq!(report.by_project[0].name, "Alpha");
}

#[test]
fn ten_thousand_entries_report_stays_accurate_and_responsive() {
    let f = fixture();
    let now = ms(2026, 6, 15, 12, 0);
    let first_day = ms(2026, 1, 1, 0, 0);
    let tx = f.conn.unchecked_transaction().unwrap();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO time_entries
                 (id, description, project_id, start_at_utc, end_at_utc, duration_seconds,
                  is_billable, source, created_at_utc, updated_at_utc)
                 VALUES (?1, ?2, ?3, ?4, ?5, 3600, 0, 'manual', ?6, ?6)",
            )
            .unwrap();
        for day in 0..100 {
            for index in 0..100 {
                let start = first_day + day * UTC_DAY + index * 5 * 60 * 1000;
                stmt.execute(rusqlite::params![
                    format!("perf-{day}-{index}"),
                    format!("Task {day}/{index}"),
                    &f.project_alpha,
                    start,
                    start + 3_600_000,
                    now
                ])
                .unwrap();
            }
        }
    }
    tx.commit().unwrap();

    let filter = ReportFilter {
        date_from: "2026-01-01".into(),
        date_to: "2026-04-10".into(),
        timezone: "UTC".into(),
        project_id: None,
        client_id: None,
        tag_id: None,
        billable: None,
        search: None,
    };
    let started = Instant::now();
    let report = reports::get_report(&f.conn, &filter, now).unwrap();
    let elapsed = started.elapsed();
    eprintln!("10k report elapsed: {elapsed:?}");
    assert_eq!(report.entry_count, 10_000);
    assert_eq!(report.total_seconds, 36_000_000);
    assert_eq!(
        report.daily.iter().map(|day| day.seconds).sum::<i64>(),
        36_000_000
    );
    assert!(
        elapsed.as_secs_f64() < 10.0,
        "report should complete well under 10s in debug builds"
    );

    let started = Instant::now();
    let page = repo_entries::list_entries(
        &f.conn,
        &EntryFilter {
            limit: Some(100),
            offset: Some(5000),
            sort: Some("start_desc".into()),
            ..Default::default()
        },
        None,
        None,
        now,
    )
    .unwrap();
    assert_eq!(page.len(), 100);
    assert!(started.elapsed().as_secs_f64() < 2.0);
}

#[test]
fn backup_preview_and_csv_destination_validation() {
    let f = fixture();
    let dir = std::env::temp_dir().join(format!("tempodesk-it-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let backup =
        portability::create_backup(&f.conn, dir.join("b.json").to_str().unwrap(), "test", f.now)
            .unwrap();
    assert_eq!(backup.counts.entries, 3);
    let preview = portability::preview_restore(dir.join("b.json").to_str().unwrap()).unwrap();
    assert_eq!(preview.counts.entries, 3);
    assert!(portability::preview_restore(dir.join("missing.json").to_str().unwrap()).is_err());
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn day_helpers_match_reports_across_dst() {
    // Sanity check that the public helpers used by the UI and reports agree.
    let ny: chrono_tz::Tz = "America/New_York".parse().unwrap();
    let day = chrono::NaiveDate::from_ymd_opt(2026, 3, 8).unwrap();
    let start = timeutil::day_start_ms(day, ny);
    let end = timeutil::day_end_ms(day, ny);
    assert_eq!((end - start) / 1000, 23 * 3600);
}

#[test]
fn timer_flow_enforces_one_active_entry_and_resume_copy_semantics() {
    use tempodesk_core::domain::timer;
    use tempodesk_core::models::StartTimerInput;
    use tempodesk_core::storage::repo_entries;

    let mut conn = db::open_in_memory().unwrap();
    let start = ms(2026, 9, 1, 9, 0);
    let first = timer::start(
        &mut conn,
        &StartTimerInput {
            description: Some("A".into()),
            project_id: None,
            tag_ids: None,
            is_billable: Some(false),
        },
        start,
    )
    .unwrap();

    // A second start must be rejected, not silently create two active rows.
    let duplicate = timer::start(
        &mut conn,
        &StartTimerInput {
            description: Some("B".into()),
            project_id: None,
            tag_ids: None,
            is_billable: Some(true),
        },
        start + 5000,
    );
    assert!(matches!(
        duplicate,
        Err(tempodesk_core::error::AppError::ActiveTimerExists(_))
    ));

    // Switch atomically closes A and starts B.
    let switched = timer::switch(
        &mut conn,
        &StartTimerInput {
            description: Some("B".into()),
            project_id: None,
            tag_ids: None,
            is_billable: Some(true),
        },
        start + 120_000,
    )
    .unwrap();
    let active = repo_entries::get_active(&conn).unwrap().unwrap();
    assert_eq!(active.id, switched.id);
    assert_eq!(active.description, "B");
    let old = repo_entries::get_entry(&conn, &first.id).unwrap().unwrap();
    assert_eq!(old.end_at_utc, Some(start + 120_000));
    assert_eq!(old.duration_seconds, Some(120));

    // Stopping twice cannot create a second completion entry.
    let stopped = timer::stop(&mut conn, start + 180_000).unwrap();
    assert_eq!(stopped.id, switched.id);
    let second_stop = timer::stop(&mut conn, start + 181_000);
    assert!(matches!(
        second_stop,
        Err(tempodesk_core::error::AppError::NoActiveTimer(_))
    ));
    let count =
        repo_entries::list_entries(&conn, &EntryFilter::default(), None, None, start + 200_000)
            .unwrap()
            .len();
    assert_eq!(count, 2);

    // Resume copies metadata into a new running entry; the original stays unchanged.
    let resumed = timer::resume(&mut conn, &first.id, false, start + 300_000).unwrap();
    assert_eq!(resumed.description, "A");
    assert_ne!(resumed.id, first.id);
    assert!(resumed.running);
    let original = repo_entries::get_entry(&conn, &first.id).unwrap().unwrap();
    assert_eq!(original.end_at_utc, Some(start + 120_000));
    assert!(!original.running);
    timer::stop(&mut conn, start + 360_000).unwrap();

    // Editing a running entry cannot commit an end time.
    let running = timer::start(
        &mut conn,
        &StartTimerInput {
            description: Some("C".into()),
            project_id: None,
            tag_ids: None,
            is_billable: Some(false),
        },
        start + 400_000,
    )
    .unwrap();
    let invalid = timer::update(
        &mut conn,
        &running.id,
        &tempodesk_core::models::EntryUpdateInput {
            description: "C".into(),
            project_id: None,
            tag_ids: vec![],
            is_billable: false,
            start_at_utc: running.start_at_utc,
            end_at_utc: Some(start + 460_000),
        },
        start + 500_000,
    );
    assert!(invalid.is_err());
    timer::stop(&mut conn, start + 520_000).unwrap();
}

#[test]
fn duplicate_entry_copies_metadata_and_interval() {
    use tempodesk_core::domain::timer;
    use tempodesk_core::models::StartTimerInput;

    let mut f = fixture();
    let entries =
        repo_entries::list_entries(&f.conn, &EntryFilter::default(), None, None, f.now).unwrap();
    let source = entries
        .iter()
        .find(|e| e.description == "Alpha work")
        .unwrap()
        .clone();

    let copy = timer::duplicate(&mut f.conn, &source.id, f.now).unwrap();
    assert_ne!(copy.entry.id, source.id);
    assert_eq!(copy.entry.description, source.description);
    assert_eq!(copy.entry.project_id, source.project_id);
    assert_eq!(copy.entry.tags.len(), 1);
    assert_eq!(copy.entry.tags[0].id, source.tags[0].id);
    assert_eq!(copy.entry.is_billable, source.is_billable);
    assert_eq!(copy.entry.start_at_utc, source.start_at_utc);
    assert_eq!(copy.entry.end_at_utc, source.end_at_utc);
    assert_eq!(copy.entry.duration_seconds, source.duration_seconds);
    assert_eq!(copy.entry.source, "manual");
    assert!(!copy.entry.running);

    // The original entry is unchanged.
    let original = repo_entries::get_entry(&f.conn, &source.id)
        .unwrap()
        .unwrap();
    assert_eq!(original, source);

    // A running entry cannot be duplicated.
    let running = timer::start(
        &mut f.conn,
        &StartTimerInput {
            description: Some("Running".into()),
            project_id: None,
            tag_ids: None,
            is_billable: Some(false),
        },
        f.now,
    )
    .unwrap();
    assert!(timer::duplicate(&mut f.conn, &running.id, f.now).is_err());
}

#[test]
fn editing_an_entry_keeps_soft_deleted_tag_association() {
    use tempodesk_core::domain::timer;
    use tempodesk_core::models::{EntryUpdateInput, ManualEntryInput};
    use tempodesk_core::storage::repo_entries;

    let mut conn = db::open_in_memory().unwrap();
    let now = ms(2026, 8, 1, 12, 0);
    let tag = repo_tags::save(
        &conn,
        &TagInput {
            id: None,
            name: "historical".into(),
            color: None,
        },
        now,
    )
    .unwrap();
    let created = timer::create_manual(
        &mut conn,
        &ManualEntryInput {
            description: Some("tagged".into()),
            project_id: None,
            tag_ids: Some(vec![tag.id.clone()]),
            is_billable: Some(false),
            start_at_utc: now - 3_600_000,
            end_at_utc: now,
        },
        now,
    )
    .unwrap();
    repo_tags::soft_delete(&conn, &tag.id, now + 1000).unwrap();

    let updated = timer::update(
        &mut conn,
        &created.entry.id,
        &EntryUpdateInput {
            description: "tagged and edited".into(),
            project_id: None,
            tag_ids: vec![tag.id.clone()],
            is_billable: false,
            start_at_utc: now - 3_600_000,
            end_at_utc: Some(now),
        },
        now + 2000,
    )
    .unwrap();
    assert_eq!(updated.entry.tags.len(), 1);
    assert_eq!(updated.entry.tags[0].id, tag.id);

    // Unknown tag IDs are still rejected.
    let invalid = timer::update(
        &mut conn,
        &created.entry.id,
        &EntryUpdateInput {
            description: "bad".into(),
            project_id: None,
            tag_ids: vec!["missing-tag".into()],
            is_billable: false,
            start_at_utc: now - 3_600_000,
            end_at_utc: Some(now),
        },
        now + 3000,
    );
    assert!(invalid.is_err());
    assert_eq!(
        repo_entries::get_entry(&conn, &created.entry.id)
            .unwrap()
            .unwrap()
            .tags
            .len(),
        1
    );
}

#[test]
fn bulk_delete_and_restore_are_transactional_and_report_skips() {
    use tempodesk_core::domain::timer;
    use tempodesk_core::models::StartTimerInput;

    let mut conn = db::open_in_memory().unwrap();
    let now = ms(2026, 10, 1, 12, 0);
    let mut ids = Vec::new();
    for (index, name) in ["A", "B", "C"].iter().enumerate() {
        let start = now - 3_600_000 + (index as i64) * 600_000;
        ids.push(add_manual(
            &mut conn,
            start,
            start + 300_000,
            name,
            None,
            vec![],
            false,
            now,
        ));
    }
    let running = timer::start(
        &mut conn,
        &StartTimerInput {
            description: Some("running".into()),
            project_id: None,
            tag_ids: None,
            is_billable: Some(false),
        },
        now,
    )
    .unwrap();

    let mut request = ids.clone();
    request.push(running.id.clone());
    request.push("missing".into());
    request.push(ids[0].clone());
    let deleted = timer::bulk_delete(&mut conn, &request, now + 1000).unwrap();
    assert_eq!(deleted.deleted_count, 3);
    assert_eq!(deleted.deleted_ids.len(), 3);
    assert!(deleted
        .skipped
        .iter()
        .any(|skip| skip.id == running.id && skip.reason == "running"));
    assert!(deleted
        .skipped
        .iter()
        .any(|skip| skip.id == "missing" && skip.reason == "not_found"));

    let visible =
        repo_entries::list_entries(&conn, &EntryFilter::default(), None, None, now + 2000).unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].description, "running");
    assert!(visible[0].running);
    let all = repo_entries::list_entries(
        &conn,
        &EntryFilter {
            include_deleted: Some(true),
            ..Default::default()
        },
        None,
        None,
        now + 2000,
    )
    .unwrap();
    assert_eq!(all.len(), 4);

    let restored = timer::bulk_restore(&mut conn, &ids, now + 3000).unwrap();
    assert_eq!(restored.restored_count, 3);
    let visible =
        repo_entries::list_entries(&conn, &EntryFilter::default(), None, None, now + 4000).unwrap();
    assert_eq!(visible.len(), 4);
    // Restoring again is a no-op with explicit skips.
    let again = timer::bulk_restore(&mut conn, &ids, now + 5000).unwrap();
    assert_eq!(again.restored_count, 0);
    assert_eq!(again.skipped.len(), 3);
    assert!(again
        .skipped
        .iter()
        .all(|skip| skip.reason == "not_deleted"));

    assert!(timer::bulk_delete(&mut conn, &[], now).is_err());
}
