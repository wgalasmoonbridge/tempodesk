use rusqlite::Connection;
use tempodesk_core::domain::{auto_backup, bulk, portability, templates, timer};
use tempodesk_core::models::{
    AppSettings, BulkEditPatch, EntryFilter, ManualEntryInput, ProjectInput, SettingsPatch,
    TagInput, TemplateInput,
};
use tempodesk_core::storage::{db, repo_entries, repo_projects, repo_settings, repo_tags};

const NOW: i64 = 1_800_000_000_000;

fn entry(conn: &mut Connection, description: &str) -> String {
    timer::create_manual(
        conn,
        &ManualEntryInput {
            description: Some(description.into()),
            project_id: None,
            tag_ids: None,
            is_billable: Some(false),
            start_at_utc: NOW - 3_600_000,
            end_at_utc: NOW - 1_800_000,
        },
        NOW,
    )
    .unwrap()
    .entry
    .id
}

struct TestDir(std::path::PathBuf);
impl TestDir {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("tempodesk-workflows-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        assert!(self.0.is_absolute() && self.0.parent() == Some(std::env::temp_dir().as_path()));
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("tempodesk-workflows-"));
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn templates_round_trip_in_backup_and_start_fresh_sessions() {
    let mut conn = db::open_in_memory().unwrap();
    let project = repo_projects::save(
        &conn,
        &ProjectInput {
            name: "Client work".into(),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    let tag = repo_tags::save(
        &conn,
        &TagInput {
            name: "Focus".into(),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    let input = TemplateInput {
        id: None,
        name: "Coding".into(),
        description: "Build feature".into(),
        project_id: Some(project.id.clone()),
        tag_ids: vec![tag.id.clone()],
        is_billable: true,
    };
    let template = templates::save(&conn, &input).unwrap();
    assert!(templates::save(
        &conn,
        &TemplateInput {
            name: "coding".into(),
            ..input.clone()
        }
    )
    .is_err());
    let start_input = templates::start_input(&conn, &template.id).unwrap();
    let active = timer::start(&mut conn, &start_input, NOW);
    assert!(active.is_ok());
    let active = active.unwrap();
    assert_ne!(active.id, template.id);
    assert_eq!(active.description, "Build feature");
    assert!(active.is_billable);
    assert_eq!(active.tags[0].id, tag.id);
    assert!(timer::start(&mut conn, &Default::default(), NOW + 1000).is_err());
    timer::stop(&mut conn, NOW + 60000).unwrap();
    let dir = TestDir::new();
    let path = dir.0.join("backup.json");
    let result = portability::create_backup(&conn, path.to_str().unwrap(), "test", NOW).unwrap();
    assert_eq!(result.counts.templates, 1);
    templates::delete(&conn, &template.id).unwrap();
    portability::restore_backup(
        &mut conn,
        path.to_str().unwrap(),
        &dir.0.join("safety"),
        "test",
        NOW,
    )
    .unwrap();
    assert_eq!(templates::get(&conn, &template.id).unwrap(), template);
    repo_projects::set_archived(&conn, &project.id, true, NOW).unwrap();
    let input = templates::start_input(&conn, &template.id).unwrap();
    assert!(timer::start(&mut conn, &input, NOW).is_err());
    assert!(repo_entries::get_active(&conn).unwrap().is_none());
}

#[test]
fn version_one_backups_restore_without_templates_and_disable_machine_specific_scheduling() {
    let mut conn = db::open_in_memory().unwrap();
    entry(&mut conn, "Existing work");
    let mut value =
        serde_json::to_value(portability::build_document(&conn, "old", NOW).unwrap()).unwrap();
    value["version"] = 1.into();
    value.as_object_mut().unwrap().remove("templates");
    value["settings"]["autoBackupEnabled"] = true.into();
    value["settings"]["autoBackupDirectory"] = "Z:\\other-machine".into();
    let dir = TestDir::new();
    let path = dir.0.join("legacy.json");
    std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    portability::restore_backup(
        &mut conn,
        path.to_str().unwrap(),
        &dir.0.join("safety"),
        "new",
        NOW,
    )
    .unwrap();
    assert!(templates::list(&conn).unwrap().is_empty());
    assert_eq!(
        repo_entries::list_page(&conn, &EntryFilter::default(), None, None, NOW)
            .unwrap()
            .total_count,
        1
    );
    let settings = repo_settings::load(&conn).unwrap();
    assert!(!settings.auto_backup_enabled);
    assert!(settings.auto_backup_directory.is_empty());
}

#[test]
fn bulk_edits_are_atomic_and_undo_preserves_times_and_detects_later_changes() {
    let mut conn = db::open_in_memory().unwrap();
    let first = entry(&mut conn, "First");
    let second = entry(&mut conn, "Second");
    let tag = repo_tags::save(
        &conn,
        &TagInput {
            name: "Focus".into(),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    let patch = BulkEditPatch {
        is_billable: Some(true),
        tag_ids: Some(vec![tag.id.clone()]),
        tag_mode: Some("add".into()),
        ..Default::default()
    };
    assert!(bulk::edit(&mut conn, &[first.clone(), "missing".into()], &patch, NOW).is_err());
    assert!(
        !repo_entries::get_entry(&conn, &first)
            .unwrap()
            .unwrap()
            .is_billable
    );
    let ids = vec![first.clone(), second.clone(), first.clone()];
    let result = bulk::edit(&mut conn, &ids, &patch, NOW).unwrap();
    assert_eq!(result.updated_count, 2);
    let after = repo_entries::get_entry(&conn, &first).unwrap().unwrap();
    assert!(after.is_billable);
    assert_eq!(after.tags.len(), 1);
    // A later edit to session times is independent of the metadata undo.
    conn.execute("UPDATE time_entries SET start_at_utc = start_at_utc - 1000, duration_seconds = duration_seconds + 1 WHERE id = ?1", [&first]).unwrap();
    assert_eq!(
        bulk::undo(&mut conn, &result.undo_token, NOW + 1000).unwrap(),
        2
    );
    assert!(bulk::undo(&mut conn, &result.undo_token, NOW + 2000).is_err());
    let restored = repo_entries::get_entry(&conn, &first).unwrap().unwrap();
    assert!(!restored.is_billable);
    assert!(restored.tags.is_empty());
    assert_eq!(restored.start_at_utc, after.start_at_utc - 1000);
    let result = bulk::edit(&mut conn, &ids, &patch, NOW + 3000).unwrap();
    conn.execute(
        "UPDATE time_entries SET description = 'Newer edit' WHERE id = ?1",
        [&second],
    )
    .unwrap();
    assert!(bulk::undo(&mut conn, &result.undo_token, NOW + 4000).is_err());
    assert!(
        repo_entries::get_entry(&conn, &first)
            .unwrap()
            .unwrap()
            .is_billable,
        "no partial undo"
    );
    let active = timer::start(&mut conn, &Default::default(), NOW).unwrap();
    assert!(bulk::edit(
        &mut conn,
        &[first, active.id],
        &BulkEditPatch {
            description: Some("Wrong".into()),
            ..Default::default()
        },
        NOW
    )
    .is_err());
}

#[test]
fn bulk_tag_modes_and_explicit_project_clear_preserve_unselected_values() {
    let mut conn = db::open_in_memory().unwrap();
    let id = entry(&mut conn, "Keep description");
    let tag = repo_tags::save(
        &conn,
        &TagInput {
            name: "Focus".into(),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    let project = repo_projects::save(
        &conn,
        &ProjectInput {
            name: "Project".into(),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    bulk::edit(
        &mut conn,
        std::slice::from_ref(&id),
        &BulkEditPatch {
            set_project: true,
            project_id: Some(project.id),
            tag_ids: Some(vec![tag.id.clone()]),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    bulk::edit(
        &mut conn,
        std::slice::from_ref(&id),
        &BulkEditPatch {
            set_project: true,
            project_id: None,
            tag_mode: Some("remove".into()),
            tag_ids: Some(vec![tag.id]),
            ..Default::default()
        },
        NOW,
    )
    .unwrap();
    let result = repo_entries::get_entry(&conn, &id).unwrap().unwrap();
    assert_eq!(result.description, "Keep description");
    assert!(result.project_id.is_none() && result.tags.is_empty());
}

#[test]
fn history_pages_are_stable_and_totals_cover_more_than_one_thousand_entries() {
    let conn = db::open_in_memory().unwrap();
    let tx = conn.unchecked_transaction().unwrap();
    for index in 0..1205 {
        tx.execute("INSERT INTO time_entries (id, description, start_at_utc, end_at_utc, duration_seconds, is_billable, source, created_at_utc, updated_at_utc) VALUES (?1, '100% work', 1000, 61000, 60, 1, 'manual', 1000, 1000)", [format!("entry-{index:04}")]).unwrap();
    }
    tx.commit().unwrap();
    let filter = EntryFilter {
        limit: Some(100),
        search: Some("100%".into()),
        billable: Some(true),
        ..Default::default()
    };
    let first = repo_entries::list_page(&conn, &filter, Some(11000), Some(31000), NOW).unwrap();
    assert_eq!(first.total_count, 1205);
    assert_eq!(first.total_seconds, 1205 * 20);
    assert_eq!(first.entries.len(), 100);
    let last = repo_entries::list_page(
        &conn,
        &EntryFilter {
            offset: Some(1200),
            ..filter.clone()
        },
        Some(11000),
        Some(31000),
        NOW,
    )
    .unwrap();
    assert_eq!(last.entries.len(), 5);
    assert_eq!(last.total_seconds, first.total_seconds);
    assert!(last
        .entries
        .iter()
        .all(|last| first.entries.iter().all(|first| first.id != last.id)));
    let none = repo_entries::list_page(
        &conn,
        &EntryFilter {
            billable: Some(false),
            ..filter
        },
        None,
        None,
        NOW,
    )
    .unwrap();
    assert_eq!((none.total_count, none.total_seconds), (0, 0));
}

#[test]
fn automatic_backups_schedule_retain_and_report_errors_without_deleting_other_files() {
    let conn = db::open_in_memory().unwrap();
    let dir = TestDir::new();
    let mut settings = AppSettings {
        auto_backup_enabled: true,
        auto_backup_retention: 2,
        ..Default::default()
    };
    assert!(auto_backup::run(&conn, &settings, &dir.0, "test", NOW, false).unwrap());
    assert!(!auto_backup::run(&conn, &settings, &dir.0, "test", NOW + 1000, false).unwrap());
    let backup_dir = auto_backup::directory(&settings, &dir.0);
    for name in [
        "manual.json",
        "tempodesk-pre-restore-1.json",
        "tempodesk-auto-123-other.json",
    ] {
        std::fs::write(backup_dir.join(name), "keep me").unwrap();
    }
    for day in 1..=3 {
        assert!(auto_backup::run(
            &conn,
            &settings,
            &dir.0,
            "test",
            NOW + day * 86_400_000,
            false
        )
        .unwrap());
    }
    assert_eq!(std::fs::read_dir(&backup_dir).unwrap().count(), 5);
    // A backwards clock still retains the latest successful snapshot.
    assert!(auto_backup::run(&conn, &settings, &dir.0, "test", NOW - 1000, false).unwrap());
    let previous = auto_backup::status(&conn, &settings, &dir.0).unwrap();
    assert!(std::path::Path::new(previous.last_backup_path.as_ref().unwrap()).is_file());
    settings.auto_backup_directory = dir.0.join("unavailable").to_string_lossy().into();
    std::fs::write(&settings.auto_backup_directory, "not a folder").unwrap();
    assert!(auto_backup::run(&conn, &settings, &dir.0, "test", NOW, false).is_err());
    let failed = auto_backup::status(&conn, &settings, &dir.0).unwrap();
    assert!(failed.error.is_some());
    assert_eq!(failed.last_backup_at_utc, previous.last_backup_at_utc);
    settings.auto_backup_directory.clear();
    assert!(auto_backup::run(&conn, &settings, &dir.0, "test", NOW, true).unwrap());
    assert!(auto_backup::status(&conn, &settings, &dir.0)
        .unwrap()
        .error
        .is_none());
    assert!(repo_settings::update(
        &conn,
        &SettingsPatch {
            auto_backup_retention: Some(0),
            ..Default::default()
        },
        NOW
    )
    .is_err());
    assert!(repo_settings::update(
        &conn,
        &SettingsPatch {
            auto_backup_directory: Some("relative".into()),
            ..Default::default()
        },
        NOW
    )
    .is_err());
    settings.auto_backup_enabled = false;
    assert!(!auto_backup::run(&conn, &settings, &dir.0, "test", NOW, true).unwrap());
}
