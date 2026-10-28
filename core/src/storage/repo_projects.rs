use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::validate::{normalize_color, normalize_name};
use crate::error::{AppError, Result};
use crate::models::{Project, ProjectInput};

const PROJECT_SELECT: &str = "
SELECT p.id, p.name, p.color, p.client_id, c.name, p.default_billable,
       p.archived_at_utc, p.created_at_utc, p.updated_at_utc
FROM projects p
LEFT JOIN clients c ON c.id = p.client_id
";

fn map_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
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
}

pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<Project>> {
    let sql = format!(
        "{PROJECT_SELECT} WHERE p.deleted_at_utc IS NULL AND (p.archived_at_utc IS NULL OR ?1)
         ORDER BY p.archived_at_utc IS NOT NULL ASC, lower(p.name) ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([include_archived], map_project)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> Result<Project> {
    let sql = format!("{PROJECT_SELECT} WHERE p.id = ?1 AND p.deleted_at_utc IS NULL");
    conn.query_row(&sql, [id], map_project)
        .optional()?
        .ok_or_else(|| AppError::not_found("Project not found"))
}

fn ensure_client(conn: &Connection, client_id: Option<&str>, allow_archived: bool) -> Result<()> {
    let Some(client_id) = client_id.filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    let archived: Option<i64> = conn
        .query_row(
            "SELECT archived_at_utc FROM clients WHERE id = ?1 AND deleted_at_utc IS NULL",
            [client_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("Client not found"))?;
    if archived.is_some() && !allow_archived {
        return Err(AppError::Archived("The selected client is archived".into()));
    }
    Ok(())
}

pub fn save(conn: &Connection, input: &ProjectInput, now: i64) -> Result<Project> {
    let name = normalize_name(&input.name, "Project", 120)?;
    let keep_archived_client = match input.id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            let existing = get(conn, id)?;
            existing.client_id.as_deref().filter(|s| !s.is_empty())
                == input.client_id.as_deref().filter(|s| !s.is_empty())
        }
        None => false,
    };
    ensure_client(conn, input.client_id.as_deref(), keep_archived_client)?;

    let id = match input.id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            let existing = get(conn, id)?;
            let color = normalize_color(input.color.as_deref(), &existing.color)?;
            let default_billable = input.default_billable.unwrap_or(existing.default_billable);
            conn.execute(
                "UPDATE projects
                 SET name = ?1, color = ?2, client_id = ?3, default_billable = ?4, updated_at_utc = ?5
                 WHERE id = ?6",
                params![
                    name,
                    color,
                    input.client_id.as_deref().filter(|s| !s.is_empty()),
                    i64::from(default_billable),
                    now,
                    id
                ],
            )?;
            id.to_string()
        }
        None => {
            let color = normalize_color(input.color.as_deref(), "#4f46e5")?;
            let default_billable = input.default_billable.unwrap_or(false);
            let id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO projects
                   (id, name, color, client_id, default_billable, created_at_utc, updated_at_utc)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![
                    id,
                    name,
                    color,
                    input.client_id.as_deref().filter(|s| !s.is_empty()),
                    i64::from(default_billable),
                    now
                ],
            )?;
            id
        }
    };
    get(conn, &id)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool, now: i64) -> Result<Project> {
    get(conn, id)?;
    conn.execute(
        "UPDATE projects SET archived_at_utc = ?1, updated_at_utc = ?2 WHERE id = ?3",
        params![if archived { Some(now) } else { None }, now, id],
    )?;
    get(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ClientInput;
    use crate::storage::{db, repo_clients};

    #[test]
    fn project_inherits_client_and_default_billable() {
        let conn = db::open_in_memory().unwrap();
        let client = repo_clients::save(
            &conn,
            &ClientInput {
                id: None,
                name: "Acme".into(),
            },
            1000,
        )
        .unwrap();
        let project = save(
            &conn,
            &ProjectInput {
                id: None,
                name: "Website".into(),
                color: Some("#0d9488".into()),
                client_id: Some(client.id.clone()),
                default_billable: Some(true),
            },
            2000,
        )
        .unwrap();
        assert_eq!(project.client_name.as_deref(), Some("Acme"));
        assert!(project.default_billable);
        assert_eq!(project.color, "#0d9488");

        let archived = set_archived(&conn, &project.id, true, 3000).unwrap();
        assert!(archived.archived_at_utc.is_some());
        assert_eq!(list(&conn, false).unwrap().len(), 0);
        assert_eq!(list(&conn, true).unwrap().len(), 1);
    }

    #[test]
    fn rejects_archived_client_assignment() {
        let conn = db::open_in_memory().unwrap();
        let client = repo_clients::save(
            &conn,
            &ClientInput {
                id: None,
                name: "Old".into(),
            },
            1000,
        )
        .unwrap();
        repo_clients::set_archived(&conn, &client.id, true, 2000).unwrap();
        let err = save(
            &conn,
            &ProjectInput {
                id: None,
                name: "Nope".into(),
                color: None,
                client_id: Some(client.id),
                default_billable: None,
            },
            3000,
        );
        assert!(matches!(err, Err(AppError::Archived(_))));
    }
}

#[cfg(test)]
mod archived_client_tests {
    use super::*;
    use crate::models::ClientInput;
    use crate::storage::{db, repo_clients};

    #[test]
    fn project_can_keep_archived_client_but_not_switch_to_one() {
        let conn = db::open_in_memory().unwrap();
        let a = repo_clients::save(
            &conn,
            &ClientInput {
                id: None,
                name: "A".into(),
            },
            1000,
        )
        .unwrap();
        let b = repo_clients::save(
            &conn,
            &ClientInput {
                id: None,
                name: "B".into(),
            },
            2000,
        )
        .unwrap();
        let project = save(
            &conn,
            &ProjectInput {
                id: None,
                name: "P".into(),
                color: None,
                client_id: Some(a.id.clone()),
                default_billable: None,
            },
            3000,
        )
        .unwrap();
        repo_clients::set_archived(&conn, &a.id, true, 4000).unwrap();
        repo_clients::set_archived(&conn, &b.id, true, 5000).unwrap();

        // Keeping the same archived client while renaming is allowed.
        let renamed = save(
            &conn,
            &ProjectInput {
                id: Some(project.id.clone()),
                name: "P renamed".into(),
                color: None,
                client_id: Some(a.id.clone()),
                default_billable: None,
            },
            6000,
        )
        .unwrap();
        assert_eq!(renamed.name, "P renamed");
        assert_eq!(renamed.client_id.as_deref(), Some(a.id.as_str()));

        // Switching to a different archived client is rejected.
        let err = save(
            &conn,
            &ProjectInput {
                id: Some(project.id),
                name: "P renamed".into(),
                color: None,
                client_id: Some(b.id),
                default_billable: None,
            },
            7000,
        );
        assert!(matches!(err, Err(AppError::Archived(_))));
    }
}
