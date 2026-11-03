use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::domain::{timer, validate};
use crate::error::{AppError, Result};
use crate::models::{StartTimerInput, TaskTemplate, TemplateInput};

pub fn list(conn: &Connection) -> Result<Vec<TaskTemplate>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, project_id, tag_ids_json, is_billable FROM task_templates ORDER BY name COLLATE NOCASE, id",
    )?;
    let rows = stmt.query_map([], |row| {
        let raw: String = row.get(4)?;
        let tag_ids = serde_json::from_str(&raw).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
        Ok(TaskTemplate {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            project_id: row.get(3)?,
            tag_ids,
            is_billable: row.get(5)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

pub fn get(conn: &Connection, id: &str) -> Result<TaskTemplate> {
    list(conn)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::not_found("Task template not found"))
}

pub fn save(conn: &Connection, input: &TemplateInput) -> Result<TaskTemplate> {
    let name = validate::normalize_name(&input.name, "Template", 120)?;
    let meta = timer::resolve_meta(
        conn,
        Some(&input.description),
        input.project_id.as_deref(),
        Some(&input.tag_ids),
        Some(input.is_billable),
        false,
    )?;
    validate_tags(conn, &meta.tag_ids)?;
    let id = match &input.id {
        Some(id) => {
            get(conn, id)?;
            id.clone()
        }
        None => Uuid::new_v4().to_string(),
    };
    let duplicate: Option<String> = conn
        .query_row(
            "SELECT id FROM task_templates WHERE name = ?1 COLLATE NOCASE AND id <> ?2",
            params![name, id],
            |row| row.get(0),
        )
        .optional()?;
    if duplicate.is_some() {
        return Err(AppError::conflict(
            "A template with this name already exists",
        ));
    }
    conn.execute(
        "INSERT INTO task_templates (id, name, description, project_id, tag_ids_json, is_billable)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, description = excluded.description, project_id = excluded.project_id,
         tag_ids_json = excluded.tag_ids_json, is_billable = excluded.is_billable",
        params![
            id,
            name,
            meta.description,
            meta.project_id,
            serde_json::to_string(&meta.tag_ids)?,
            meta.is_billable
        ],
    )?;
    get(conn, &id)
}

fn validate_tags(conn: &Connection, tags: &[String]) -> Result<()> {
    for id in tags {
        let active: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM tags WHERE id = ?1 AND archived_at_utc IS NULL AND deleted_at_utc IS NULL)",
            [id], |row| row.get(0),
        )?;
        if !active {
            return Err(AppError::validation("Choose active tags for this template"));
        }
    }
    Ok(())
}

pub fn start_input(conn: &Connection, id: &str) -> Result<StartTimerInput> {
    let template = get(conn, id)?;
    validate_tags(conn, &template.tag_ids)?;
    Ok(StartTimerInput {
        description: Some(template.description),
        project_id: template.project_id,
        tag_ids: Some(template.tag_ids),
        is_billable: Some(template.is_billable),
    })
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    if conn.execute("DELETE FROM task_templates WHERE id = ?1", [id])? == 0 {
        return Err(AppError::not_found("Task template not found"));
    }
    Ok(())
}
