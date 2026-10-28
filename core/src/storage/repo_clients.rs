use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::validate::normalize_name;
use crate::error::{AppError, Result};
use crate::models::{Client, ClientInput};

fn map_client(row: &rusqlite::Row<'_>) -> rusqlite::Result<Client> {
    Ok(Client {
        id: row.get(0)?,
        name: row.get(1)?,
        archived_at_utc: row.get(2)?,
        created_at_utc: row.get(3)?,
        updated_at_utc: row.get(4)?,
    })
}

pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<Client>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, archived_at_utc, created_at_utc, updated_at_utc
         FROM clients
         WHERE deleted_at_utc IS NULL AND (archived_at_utc IS NULL OR ?1)
         ORDER BY lower(name) ASC",
    )?;
    let rows = stmt.query_map([include_archived], map_client)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> Result<Client> {
    conn.query_row(
        "SELECT id, name, archived_at_utc, created_at_utc, updated_at_utc
         FROM clients WHERE id = ?1 AND deleted_at_utc IS NULL",
        [id],
        map_client,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found("Client not found"))
}

fn ensure_unique(conn: &Connection, name: &str, exclude_id: Option<&str>) -> Result<()> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM clients
             WHERE lower(name) = lower(?1) AND archived_at_utc IS NULL AND deleted_at_utc IS NULL
               AND (?2 IS NULL OR id <> ?2)",
            params![name, exclude_id],
            |row| row.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Err(AppError::conflict(format!(
            "An active client named \"{name}\" already exists"
        )));
    }
    Ok(())
}

pub fn save(conn: &Connection, input: &ClientInput, now: i64) -> Result<Client> {
    let name = normalize_name(&input.name, "Client", 120)?;
    let id = match input.id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            let existing = get(conn, id)?;
            if existing.archived_at_utc.is_some() {
                return Err(AppError::Archived(
                    "Unarchive this client before renaming it".into(),
                ));
            }
            ensure_unique(conn, &name, Some(id))?;
            conn.execute(
                "UPDATE clients SET name = ?1, updated_at_utc = ?2 WHERE id = ?3",
                params![name, now, id],
            )?;
            id.to_string()
        }
        None => {
            ensure_unique(conn, &name, None)?;
            let id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO clients (id, name, created_at_utc, updated_at_utc)
                 VALUES (?1, ?2, ?3, ?3)",
                params![id, name, now],
            )?;
            id
        }
    };
    get(conn, &id)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool, now: i64) -> Result<Client> {
    let existing = get(conn, id)?;
    if !archived {
        ensure_unique(conn, &existing.name, Some(id))?;
    }
    conn.execute(
        "UPDATE clients SET archived_at_utc = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![if archived { Some(now) } else { None }, now, id],
    )?;
    get(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db;

    #[test]
    fn create_update_archive_and_unique_active_names() {
        let conn = db::open_in_memory().unwrap();
        let created = save(
            &conn,
            &ClientInput {
                id: None,
                name: "  Acme  ".into(),
            },
            1000,
        )
        .unwrap();
        assert_eq!(created.name, "Acme");

        let dup = save(
            &conn,
            &ClientInput {
                id: None,
                name: "acme".into(),
            },
            2000,
        );
        assert!(matches!(dup, Err(AppError::Conflict(_))));

        let archived = set_archived(&conn, &created.id, true, 3000).unwrap();
        assert!(archived.archived_at_utc.is_some());
        // Archived name may be reused.
        let reused = save(
            &conn,
            &ClientInput {
                id: None,
                name: "ACME".into(),
            },
            4000,
        )
        .unwrap();
        assert_ne!(reused.id, created.id);
        // Unarchiving would now collide.
        assert!(matches!(
            set_archived(&conn, &created.id, false, 5000),
            Err(AppError::Conflict(_))
        ));
    }
}
