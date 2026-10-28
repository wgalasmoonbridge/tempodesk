use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::validate::{normalize_color, normalize_name};
use crate::error::{AppError, Result};
use crate::models::{Tag, TagInput};

fn map_tag(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        archived_at_utc: row.get(3)?,
        created_at_utc: row.get(4)?,
        updated_at_utc: row.get(5)?,
    })
}

pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, archived_at_utc, created_at_utc, updated_at_utc
         FROM tags
         WHERE deleted_at_utc IS NULL AND (archived_at_utc IS NULL OR ?1)
         ORDER BY lower(name) ASC",
    )?;
    let rows = stmt.query_map([include_archived], map_tag)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> Result<Tag> {
    conn.query_row(
        "SELECT id, name, color, archived_at_utc, created_at_utc, updated_at_utc
         FROM tags WHERE id = ?1 AND deleted_at_utc IS NULL",
        [id],
        map_tag,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("Tag not found"))
}

fn ensure_unique(conn: &Connection, name: &str, exclude_id: Option<&str>) -> Result<()> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM tags
             WHERE lower(name) = lower(?1) AND archived_at_utc IS NULL AND deleted_at_utc IS NULL
               AND (?2 IS NULL OR id <> ?2)",
            params![name, exclude_id],
            |row| row.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Err(AppError::conflict(format!(
            "An active tag named \"{name}\" already exists"
        )));
    }
    Ok(())
}

pub fn save(conn: &Connection, input: &TagInput, now: i64) -> Result<Tag> {
    let name = normalize_name(&input.name, "Tag", 80)?;
    let id = match input.id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            let existing = get(conn, id)?;
            if existing.archived_at_utc.is_some() {
                return Err(AppError::Archived(
                    "Unarchive this tag before renaming it".into(),
                ));
            }
            ensure_unique(conn, &name, Some(id))?;
            let color = match input.color.as_deref() {
                Some(c) if !c.trim().is_empty() => Some(normalize_color(Some(c), "#64748b")?),
                Some(_) => None,
                None => existing.color,
            };
            conn.execute(
                "UPDATE tags SET name = ?1, color = ?2, updated_at_utc = ?3 WHERE id = ?4",
                params![name, color, now, id],
            )?;
            id.to_string()
        }
        None => {
            ensure_unique(conn, &name, None)?;
            let color = match input
                .color
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(c) => Some(normalize_color(Some(c), "#64748b")?),
                None => None,
            };
            let id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO tags (id, name, color, created_at_utc, updated_at_utc)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, name, color, now],
            )?;
            id
        }
    };
    get(conn, &id)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool, now: i64) -> Result<Tag> {
    let existing = get(conn, id)?;
    if !archived {
        ensure_unique(conn, &existing.name, Some(id))?;
    }
    conn.execute(
        "UPDATE tags SET archived_at_utc = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![if archived { Some(now) } else { None }, now, id],
    )?;
    get(conn, id)
}

/// Soft-delete: historical entries keep resolving the tag name.
pub fn soft_delete(conn: &Connection, id: &str, now: i64) -> Result<()> {
    get(conn, id)?;
    conn.execute(
        "UPDATE tags SET deleted_at_utc = ?1, updated_at_utc = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db;

    #[test]
    fn tag_rename_and_soft_delete_preserve_history_resolution() {
        let conn = db::open_in_memory().unwrap();
        let tag = save(
            &conn,
            &TagInput {
                id: None,
                name: "Deep Work".into(),
                color: Some("#4f46e5".into()),
            },
            1000,
        )
        .unwrap();
        let renamed = save(
            &conn,
            &TagInput {
                id: Some(tag.id.clone()),
                name: "Focus".into(),
                color: None,
            },
            2000,
        )
        .unwrap();
        assert_eq!(renamed.name, "Focus");
        assert_eq!(renamed.color.as_deref(), Some("#4f46e5"));
        soft_delete(&conn, &tag.id, 3000).unwrap();
        assert!(list(&conn, true).unwrap().is_empty());
        // Row remains for joins, but get() hides it.
        assert!(get(&conn, &tag.id).is_err());
    }
}
