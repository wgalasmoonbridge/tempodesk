use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::domain::reports::build_csv;
use crate::error::{AppError, Result};
use crate::models::{
    BackupCounts, BackupDocument, BackupEntry, BackupEntryTag, BackupPreview, BackupResult,
    BackupTag, Client, ExportResult, Project, ReportFilter, RestoreResult, TimeEntry,
    BACKUP_FORMAT, BACKUP_VERSION,
};
use crate::storage::{repo_entries, repo_settings};

const MAX_IMPORT_BYTES: u64 = 128 * 1024 * 1024;

/* --------------------------------- paths --------------------------------- */

pub fn validate_destination(raw: &str, extension: &str) -> Result<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Please choose a destination file"));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::validation(
            "The destination path must be absolute",
        ));
    }
    let ext_ok = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(extension))
        .unwrap_or(false);
    if !ext_ok {
        return Err(AppError::validation(format!(
            "The file name must end with .{extension}"
        )));
    }
    if path.is_dir() {
        return Err(AppError::validation("The destination is a folder"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::validation("The destination folder does not exist"))?;
    if !parent.is_dir() {
        return Err(AppError::validation(
            "The destination folder does not exist",
        ));
    }
    Ok(path)
}

pub fn validate_source(raw: &str, extension: &str) -> Result<PathBuf> {
    let path = validate_destination(raw, extension)?;
    if !path.is_file() {
        return Err(AppError::validation("The selected file does not exist"));
    }
    let meta = std::fs::metadata(&path)?;
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(AppError::validation("The selected file is too large"));
    }
    Ok(path)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::validation("Invalid destination"))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("Invalid destination file name"))?;
    let temp = parent.join(format!(".{file_name}.tmp-{}", std::process::id()));
    std::fs::write(&temp, bytes)?;
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    std::fs::rename(&temp, path).map_err(|err| {
        let _ = std::fs::remove_file(&temp);
        AppError::Io(err)
    })?;
    Ok(())
}

/* --------------------------------- export -------------------------------- */

pub fn export_csv(
    conn: &Connection,
    filter: &ReportFilter,
    destination: &str,
    now: i64,
) -> Result<ExportResult> {
    let path = validate_destination(destination, "csv")?;
    let (csv, rows, total) = build_csv(conn, filter, now)?;
    write_atomic(&path, csv.as_bytes())?;
    Ok(ExportResult {
        path: path.display().to_string(),
        row_count: rows,
        total_seconds: total,
    })
}

/* --------------------------------- backup -------------------------------- */

fn all_clients(conn: &Connection) -> Result<Vec<Client>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, archived_at_utc, created_at_utc, updated_at_utc FROM clients ORDER BY created_at_utc",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Client {
            id: row.get(0)?,
            name: row.get(1)?,
            archived_at_utc: row.get(2)?,
            created_at_utc: row.get(3)?,
            updated_at_utc: row.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn all_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.color, p.client_id, c.name, p.default_billable,
                p.archived_at_utc, p.created_at_utc, p.updated_at_utc
         FROM projects p LEFT JOIN clients c ON c.id = p.client_id
         ORDER BY p.created_at_utc",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            client_id: row.get(3)?,
            client_name: row.get(4)?,
            default_billable: row.get::<_, i64>(5)? != 0,
            archived_at_utc: row.get(6)?,
            created_at_utc: row.get(7)?,
            updated_at_utc: row.get(8)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn all_tags(conn: &Connection) -> Result<Vec<BackupTag>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, archived_at_utc, deleted_at_utc, created_at_utc, updated_at_utc
         FROM tags ORDER BY created_at_utc",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(BackupTag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            archived_at_utc: row.get(3)?,
            deleted_at_utc: row.get(4)?,
            created_at_utc: row.get(5)?,
            updated_at_utc: row.get(6)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn all_entries(conn: &Connection) -> Result<Vec<TimeEntry>> {
    let sql = format!("{} ORDER BY e.created_at_utc", repo_entries::ENTRY_SELECT);
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(repo_entries::map_entry(row)?);
    }
    Ok(out)
}

pub fn build_document(conn: &Connection, app_version: &str, now: i64) -> Result<BackupDocument> {
    let clients = all_clients(conn)?;
    let projects = all_projects(conn)?;
    let tags = all_tags(conn)?;
    let entries: Vec<BackupEntry> = all_entries(conn)?
        .into_iter()
        .map(|entry| BackupEntry {
            id: entry.id,
            description: entry.description,
            project_id: entry.project_id,
            start_at_utc: entry.start_at_utc,
            end_at_utc: entry.end_at_utc,
            duration_seconds: entry.duration_seconds,
            is_billable: entry.is_billable,
            source: entry.source,
            deleted_at_utc: entry.deleted_at_utc,
            created_at_utc: entry.created_at_utc,
            updated_at_utc: entry.updated_at_utc,
        })
        .collect();

    let mut entry_tags = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT entry_id, tag_id FROM entry_tags ORDER BY entry_id")?;
        let rows = stmt.query_map([], |row| {
            Ok(BackupEntryTag {
                entry_id: row.get(0)?,
                tag_id: row.get(1)?,
            })
        })?;
        for row in rows {
            entry_tags.push(row?);
        }
    }

    let settings_value = serde_json::to_value(repo_settings::load(conn)?)?;
    let settings = settings_value
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::Internal("Settings serialization failed".into()))?;

    Ok(BackupDocument {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        created_at_utc: now,
        app_version: app_version.to_string(),
        clients,
        projects,
        tags,
        entries,
        entry_tags,
        settings,
    })
}

pub fn counts(document: &BackupDocument) -> BackupCounts {
    BackupCounts {
        clients: document.clients.len(),
        projects: document.projects.len(),
        tags: document.tags.len(),
        entries: document.entries.len(),
        settings: document.settings.len(),
    }
}

fn validate_document(document: &BackupDocument) -> Result<()> {
    if document.format != BACKUP_FORMAT {
        return Err(AppError::validation("This file is not a TempoDesk backup"));
    }
    if document.version != BACKUP_VERSION {
        return Err(AppError::validation(format!(
            "Unsupported backup version {}",
            document.version
        )));
    }

    let mut ids = HashSet::new();
    for client in &document.clients {
        if !ids.insert(("client", client.id.clone())) {
            return Err(AppError::validation("Backup contains duplicate client IDs"));
        }
        if client.name.trim().is_empty() {
            return Err(AppError::validation(
                "Backup contains a client without a name",
            ));
        }
    }
    for project in &document.projects {
        if !ids.insert(("project", project.id.clone())) {
            return Err(AppError::validation(
                "Backup contains duplicate project IDs",
            ));
        }
        if project.name.trim().is_empty() {
            return Err(AppError::validation(
                "Backup contains a project without a name",
            ));
        }
        if let Some(client_id) = &project.client_id {
            if !document.clients.iter().any(|c| &c.id == client_id) {
                return Err(AppError::validation(
                    "Backup contains a project linked to a missing client",
                ));
            }
        }
    }
    for tag in &document.tags {
        if !ids.insert(("tag", tag.id.clone())) {
            return Err(AppError::validation("Backup contains duplicate tag IDs"));
        }
        if tag.name.trim().is_empty() {
            return Err(AppError::validation("Backup contains a tag without a name"));
        }
    }

    let mut active = 0;
    for entry in &document.entries {
        if !ids.insert(("entry", entry.id.clone())) {
            return Err(AppError::validation("Backup contains duplicate entry IDs"));
        }
        if entry.start_at_utc % 1000 != 0
            || entry.end_at_utc.map(|e| e % 1000 != 0).unwrap_or(false)
        {
            return Err(AppError::validation(
                "Backup contains timestamps that are not second-aligned",
            ));
        }
        if !matches!(
            entry.source.as_str(),
            "timer" | "manual" | "idle_adjustment"
        ) {
            return Err(AppError::validation(
                "Backup contains an unknown entry source",
            ));
        }
        match (entry.end_at_utc, entry.duration_seconds) {
            (None, None) => {
                if entry.deleted_at_utc.is_none() {
                    active += 1;
                }
            }
            (Some(end), Some(duration)) => {
                if end < entry.start_at_utc {
                    return Err(AppError::validation(
                        "Backup contains an entry whose end is before its start",
                    ));
                }
                if duration < 1 || (end - entry.start_at_utc) / 1000 != duration {
                    return Err(AppError::validation(
                        "Backup contains an entry with an inconsistent duration",
                    ));
                }
            }
            _ => {
                return Err(AppError::validation(
                    "Backup contains an entry with incomplete time fields",
                ))
            }
        }
        if let Some(project_id) = &entry.project_id {
            if !document.projects.iter().any(|p| &p.id == project_id) {
                return Err(AppError::validation(
                    "Backup contains an entry linked to a missing project",
                ));
            }
        }
        if entry.description.chars().count() > 1000 {
            return Err(AppError::validation(
                "Backup contains an over-long entry description",
            ));
        }
    }
    if active > 1 {
        return Err(AppError::validation(
            "Backup contains more than one running timer",
        ));
    }

    let ids = |list: &[String]| -> HashSet<String> { list.iter().cloned().collect() };
    let entry_ids = ids(&document
        .entries
        .iter()
        .map(|e| e.id.clone())
        .collect::<Vec<_>>());
    let tag_ids = ids(&document
        .tags
        .iter()
        .map(|t| t.id.clone())
        .collect::<Vec<_>>());
    let mut pairs = HashSet::new();
    for pair in &document.entry_tags {
        if !entry_ids.contains(&pair.entry_id) || !tag_ids.contains(&pair.tag_id) {
            return Err(AppError::validation(
                "Backup contains a tag link to a missing entry or tag",
            ));
        }
        if !pairs.insert((pair.entry_id.clone(), pair.tag_id.clone())) {
            return Err(AppError::validation("Backup contains duplicate tag links"));
        }
    }

    Ok(())
}

fn read_document(source: &str) -> Result<(BackupDocument, PathBuf)> {
    let path = validate_source(source, "json")?;
    let bytes = std::fs::read(&path)?;
    let document: BackupDocument = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::validation("The selected file is not a valid TempoDesk backup"))?;
    validate_document(&document)?;
    Ok((document, path))
}

pub fn create_backup(
    conn: &Connection,
    destination: &str,
    app_version: &str,
    now: i64,
) -> Result<BackupResult> {
    let path = validate_destination(destination, "json")?;
    let document = build_document(conn, app_version, now)?;
    let bytes = serde_json::to_vec_pretty(&document)?;
    write_atomic(&path, &bytes)?;
    Ok(BackupResult {
        path: path.display().to_string(),
        counts: counts(&document),
    })
}

pub fn preview_restore(source: &str) -> Result<BackupPreview> {
    let (document, path) = read_document(source)?;
    Ok(BackupPreview {
        source: path.display().to_string(),
        created_at_utc: document.created_at_utc,
        app_version: document.app_version.clone(),
        counts: counts(&document),
    })
}

pub fn restore_backup(
    conn: &mut Connection,
    source: &str,
    safety_dir: &Path,
    app_version: &str,
    now: i64,
) -> Result<RestoreResult> {
    let (document, path) = read_document(source)?;
    let incoming_counts = counts(&document);
    let _ = &path;

    std::fs::create_dir_all(safety_dir)?;
    let safety_document = build_document(conn, app_version, now)?;
    let safety_path = safety_dir.join(format!("tempodesk-pre-restore-{now}.json"));
    write_atomic(&safety_path, &serde_json::to_vec_pretty(&safety_document)?)?;

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM entry_tags", [])?;
    tx.execute("DELETE FROM idle_review_events", [])?;
    tx.execute("DELETE FROM time_entries", [])?;
    tx.execute("DELETE FROM projects", [])?;
    tx.execute("DELETE FROM clients", [])?;
    tx.execute("DELETE FROM tags", [])?;
    tx.execute("DELETE FROM app_settings", [])?;
    tx.execute("DELETE FROM runtime_state", [])?;

    {
        let mut stmt = tx.prepare(
            "INSERT INTO clients (id, name, archived_at_utc, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for client in &document.clients {
            stmt.execute(params![
                client.id,
                client.name,
                client.archived_at_utc,
                client.created_at_utc,
                client.updated_at_utc
            ])?;
        }
    }
    {
        let mut stmt = tx.prepare(
            "INSERT INTO projects
               (id, name, color, client_id, default_billable, archived_at_utc, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for project in &document.projects {
            stmt.execute(params![
                project.id,
                project.name,
                project.color,
                project.client_id,
                i64::from(project.default_billable),
                project.archived_at_utc,
                project.created_at_utc,
                project.updated_at_utc
            ])?;
        }
    }
    {
        let mut stmt = tx.prepare(
            "INSERT INTO tags (id, name, color, archived_at_utc, deleted_at_utc, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for tag in &document.tags {
            stmt.execute(params![
                tag.id,
                tag.name,
                tag.color,
                tag.archived_at_utc,
                tag.deleted_at_utc,
                tag.created_at_utc,
                tag.updated_at_utc
            ])?;
        }
    }
    {
        let mut stmt = tx.prepare(
            "INSERT INTO time_entries
               (id, description, project_id, start_at_utc, end_at_utc, duration_seconds,
                is_billable, source, deleted_at_utc, created_at_utc, updated_at_utc)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )?;
        for entry in &document.entries {
            stmt.execute(params![
                entry.id,
                entry.description,
                entry.project_id,
                entry.start_at_utc,
                entry.end_at_utc,
                entry.duration_seconds,
                i64::from(entry.is_billable),
                entry.source,
                entry.deleted_at_utc,
                entry.created_at_utc,
                entry.updated_at_utc
            ])?;
        }
    }
    {
        let mut stmt = tx.prepare("INSERT INTO entry_tags (entry_id, tag_id) VALUES (?1, ?2)")?;
        for pair in &document.entry_tags {
            stmt.execute(params![pair.entry_id, pair.tag_id])?;
        }
    }
    {
        let mut stmt = tx.prepare("INSERT INTO app_settings (key, value_json) VALUES (?1, ?2)")?;
        for (key, value) in &document.settings {
            if key.len() > 120 {
                continue;
            }
            stmt.execute(params![key, value.to_string()])?;
        }
    }

    tx.execute(
        "INSERT INTO runtime_state (key, value) VALUES ('clean_exit', '0'), ('last_heartbeat_utc', ?1),
         ('restored_at_utc', ?1)",
        params![now],
    )?;
    tx.commit()?;

    Ok(RestoreResult {
        counts: incoming_counts,
        safety_backup_path: safety_path.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::timer;
    use crate::domain::timeutil;
    use crate::models::{ClientInput, ManualEntryInput, ProjectInput, SettingsPatch, TagInput};
    use crate::storage::{db, repo_clients, repo_projects, repo_tags};

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tempodesk-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn backup_restore_roundtrip_preserves_data_and_counts() {
        let mut conn = db::open_in_memory().unwrap();
        let now = 1_800_000_000_000;
        let client = repo_clients::save(
            &conn,
            &ClientInput {
                id: None,
                name: "Acme".into(),
            },
            now,
        )
        .unwrap();
        let project = repo_projects::save(
            &conn,
            &ProjectInput {
                id: None,
                name: "Website".into(),
                color: Some("#0d9488".into()),
                client_id: Some(client.id.clone()),
                default_billable: Some(true),
            },
            now,
        )
        .unwrap();
        let tag = repo_tags::save(
            &conn,
            &TagInput {
                id: None,
                name: "Focus".into(),
                color: None,
            },
            now,
        )
        .unwrap();
        timer::create_manual(
            &mut conn,
            &ManualEntryInput {
                description: Some("Work".into()),
                project_id: Some(project.id.clone()),
                tag_ids: Some(vec![tag.id.clone()]),
                is_billable: None,
                start_at_utc: now - 3_600_000,
                end_at_utc: now,
            },
            now,
        )
        .unwrap();
        repo_settings::update(
            &conn,
            &SettingsPatch {
                theme: Some("dark".into()),
                ..Default::default()
            },
            now,
        )
        .unwrap();

        let dir = temp_dir();
        let backup_path = dir.join("backup.json");
        let backup = create_backup(&conn, backup_path.to_str().unwrap(), "0.1.0", now).unwrap();
        assert_eq!(backup.counts.entries, 1);
        assert_eq!(backup.counts.projects, 1);

        // Destroy data.
        conn.execute("DELETE FROM entry_tags", []).unwrap();
        conn.execute("DELETE FROM time_entries", []).unwrap();
        conn.execute("DELETE FROM projects", []).unwrap();
        conn.execute("DELETE FROM clients", []).unwrap();
        conn.execute("DELETE FROM tags", []).unwrap();
        conn.execute("DELETE FROM app_settings", []).unwrap();
        assert!(repo_entries::get_active(&conn).unwrap().is_none());

        let preview = preview_restore(backup_path.to_str().unwrap()).unwrap();
        assert_eq!(preview.counts.entries, 1);

        let restored = restore_backup(
            &mut conn,
            backup_path.to_str().unwrap(),
            &dir,
            "0.1.0",
            now + 1000,
        )
        .unwrap();
        assert_eq!(restored.counts.entries, 1);
        assert!(Path::new(&restored.safety_backup_path).is_file());
        assert_eq!(repo_clients::list(&conn, true).unwrap().len(), 1);
        assert_eq!(repo_projects::list(&conn, true).unwrap().len(), 1);
        assert_eq!(repo_tags::list(&conn, true).unwrap().len(), 1);
        let entries =
            repo_entries::list_entries(&conn, &Default::default(), None, None, now).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].description, "Work");
        assert_eq!(entries[0].tags.len(), 1);
        assert_eq!(repo_settings::load(&conn).unwrap().theme, "dark");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn invalid_backup_changes_nothing() {
        let mut conn = db::open_in_memory().unwrap();
        let now = 1_800_000_000_000;
        repo_clients::save(
            &conn,
            &ClientInput {
                id: None,
                name: "Keep".into(),
            },
            now,
        )
        .unwrap();
        let dir = temp_dir();
        let path = dir.join("bad.json");
        std::fs::write(&path, b"{not json").unwrap();
        let err = preview_restore(path.to_str().unwrap());
        assert!(err.is_err());
        let err = restore_backup(&mut conn, path.to_str().unwrap(), &dir, "0.1.0", now);
        assert!(err.is_err());
        assert_eq!(repo_clients::list(&conn, true).unwrap().len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn rejects_wrong_extension_and_relative_paths() {
        assert!(validate_destination("relative.csv", "csv").is_err());
        assert!(validate_destination("C:\\temp\\file.txt", "csv").is_err());
    }

    #[test]
    fn export_writes_csv_with_matching_totals() {
        let mut conn = db::open_in_memory().unwrap();
        let now = chrono::Utc::now().timestamp_millis() / 1000 * 1000;
        timer::create_manual(
            &mut conn,
            &ManualEntryInput {
                description: Some("Export me".into()),
                project_id: None,
                tag_ids: None,
                is_billable: Some(true),
                start_at_utc: now - 3_600_000,
                end_at_utc: now,
            },
            now,
        )
        .unwrap();
        let today = timeutil::local_date_string(now, chrono_tz::UTC);
        let filter = ReportFilter {
            date_from: today.clone(),
            date_to: today,
            timezone: "UTC".into(),
            project_id: None,
            client_id: None,
            tag_id: None,
            billable: None,
            search: None,
        };
        let dir = temp_dir();
        let path = dir.join("report.csv");
        let result = export_csv(&conn, &filter, path.to_str().unwrap(), now).unwrap();
        assert_eq!(result.row_count, 1);
        assert_eq!(result.total_seconds, 3600);
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.starts_with("Entry ID,Description"));
        assert!(content.contains("Export me"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn active_timer_survives_backup_restore_as_single_active_entry() {
        let mut conn = db::open_in_memory().unwrap();
        let now = chrono::Utc::now().timestamp_millis() / 1000 * 1000;
        timer::start(&mut conn, &Default::default(), now).unwrap();
        let dir = temp_dir();
        let path = dir.join("running.json");
        create_backup(&conn, path.to_str().unwrap(), "0.1.0", now).unwrap();
        conn.execute("DELETE FROM time_entries", []).unwrap();
        restore_backup(&mut conn, path.to_str().unwrap(), &dir, "0.1.0", now + 5000).unwrap();
        assert!(repo_entries::get_active(&conn).unwrap().is_some());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn settings_map_is_preserved() {
        let conn = db::open_in_memory().unwrap();
        let doc = build_document(&conn, "0.1.0", 1000).unwrap();
        assert!(doc.settings.contains_key("theme"));
        assert_eq!(doc.version, BACKUP_VERSION);
    }
}
