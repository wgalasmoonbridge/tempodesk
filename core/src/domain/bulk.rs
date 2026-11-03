use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::timer;
use crate::error::{AppError, Result};
use crate::models::{BulkEditPatch, BulkEditResult, TimeEntry};
use crate::storage::repo_entries;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Metadata {
    description: String,
    project_id: Option<String>,
    is_billable: bool,
    tag_ids: Vec<String>,
}

impl Metadata {
    fn from_entry(entry: &TimeEntry) -> Self {
        let mut tag_ids: Vec<_> = entry.tags.iter().map(|tag| tag.id.clone()).collect();
        tag_ids.sort();
        Self {
            description: entry.description.clone(),
            project_id: entry.project_id.clone(),
            is_billable: entry.is_billable,
            tag_ids,
        }
    }

    fn write(&self, conn: &Connection, id: &str, now: i64) -> Result<()> {
        conn.execute("UPDATE time_entries SET description = ?1, project_id = ?2, is_billable = ?3, updated_at_utc = ?4 WHERE id = ?5",
            params![self.description, self.project_id, self.is_billable, now, id])?;
        repo_entries::set_entry_tags(conn, id, &self.tag_ids)
    }
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    id: String,
    before: Metadata,
    after: Metadata,
}

fn completed(conn: &Connection, id: &str) -> Result<TimeEntry> {
    let entry = repo_entries::get_entry(conn, id)?
        .ok_or_else(|| AppError::not_found("A selected entry no longer exists"))?;
    if entry.running || entry.deleted_at_utc.is_some() {
        return Err(AppError::conflict(
            "Only available, completed entries can be bulk edited",
        ));
    }
    Ok(entry)
}

pub fn edit(
    conn: &mut Connection,
    ids: &[String],
    patch: &BulkEditPatch,
    now: i64,
) -> Result<BulkEditResult> {
    if ids.is_empty() || ids.len() > 1000 {
        return Err(AppError::validation("Select between 1 and 1,000 entries"));
    }
    if patch.description.is_none()
        && !patch.set_project
        && patch.is_billable.is_none()
        && patch.tag_ids.is_none()
    {
        return Err(AppError::validation("Choose at least one field to change"));
    }
    let mode = patch.tag_mode.as_deref().unwrap_or("replace");
    if !matches!(mode, "add" | "replace" | "remove") {
        return Err(AppError::validation(
            "Tag operation must be add, replace, or remove",
        ));
    }
    let tx = conn.transaction()?;
    let mut snapshots = Vec::new();
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            continue;
        }
        let entry = completed(&tx, id)?;
        let before = Metadata::from_entry(&entry);
        let mut tags = before.tag_ids.clone();
        if let Some(selected) = &patch.tag_ids {
            match mode {
                "add" => tags.extend(selected.iter().cloned()),
                "remove" => tags.retain(|id| !selected.contains(id)),
                _ => tags = selected.clone(),
            }
        }
        let project = if patch.set_project {
            &patch.project_id
        } else {
            &before.project_id
        };
        let meta = timer::resolve_meta(
            &tx,
            Some(patch.description.as_deref().unwrap_or(&before.description)),
            project.as_deref(),
            Some(&tags),
            Some(patch.is_billable.unwrap_or(before.is_billable)),
            project == &before.project_id,
        )?;
        let mut after = Metadata {
            description: meta.description,
            project_id: meta.project_id,
            is_billable: meta.is_billable,
            tag_ids: meta.tag_ids,
        };
        after.tag_ids.sort();
        if before != after {
            after.write(&tx, id, now)?;
            snapshots.push(Snapshot {
                id: id.clone(),
                before,
                after,
            });
        }
    }
    if snapshots.is_empty() {
        return Err(AppError::validation(
            "The selected entries already have these values",
        ));
    }
    let token = Uuid::new_v4().to_string();
    tx.execute(
        "DELETE FROM bulk_edit_undo WHERE created_at_utc < ?1",
        [now - 7 * 86_400_000],
    )?;
    tx.execute(
        "INSERT INTO bulk_edit_undo (id, snapshots_json, created_at_utc) VALUES (?1, ?2, ?3)",
        params![token, serde_json::to_string(&snapshots)?, now],
    )?;
    tx.commit()?;
    Ok(BulkEditResult {
        updated_count: snapshots.len(),
        undo_token: token,
    })
}

pub fn undo(conn: &mut Connection, token: &str, now: i64) -> Result<usize> {
    let tx = conn.transaction()?;
    let raw: String = tx
        .query_row(
            "SELECT snapshots_json FROM bulk_edit_undo WHERE id = ?1",
            [token],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("This bulk edit is no longer available to undo"))?;
    let snapshots: Vec<Snapshot> = serde_json::from_str(&raw)?;
    // Check the entire batch before writing. Later time edits survive because undo changes metadata only.
    for snapshot in &snapshots {
        let current = completed(&tx, &snapshot.id)?;
        if Metadata::from_entry(&current) != snapshot.after {
            return Err(AppError::conflict(
                "An entry was changed after this bulk edit. Undo would overwrite newer changes.",
            ));
        }
    }
    for snapshot in &snapshots {
        snapshot.before.write(&tx, &snapshot.id, now)?;
    }
    tx.execute("DELETE FROM bulk_edit_undo WHERE id = ?1", [token])?;
    tx.commit()?;
    Ok(snapshots.len())
}
