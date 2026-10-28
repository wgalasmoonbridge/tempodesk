use rusqlite::types::Value;
use rusqlite::{params_from_iter, Connection, Row};

use crate::error::Result;
use crate::models::{EntryFilter, OverlapInfo, TagRef, TimeEntry};

pub const ENTRY_SELECT: &str = r#"
SELECT e.id, e.description, e.project_id, p.name, p.color, p.client_id, c.name,
       e.start_at_utc, e.end_at_utc, e.duration_seconds, e.is_billable, e.source,
       e.deleted_at_utc, e.created_at_utc, e.updated_at_utc,
       COALESCE((
         SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color))
         FROM entry_tags et JOIN tags t ON t.id = et.tag_id
         WHERE et.entry_id = e.id
       ), '[]')
FROM time_entries e
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN clients c ON c.id = p.client_id
"#;

pub fn map_entry(row: &Row<'_>) -> rusqlite::Result<TimeEntry> {
    let tags_json: String = row.get(15)?;
    let tags: Vec<TagRef> = serde_json::from_str(&tags_json).unwrap_or_default();
    let end_at_utc: Option<i64> = row.get(8)?;
    Ok(TimeEntry {
        id: row.get(0)?,
        description: row.get(1)?,
        project_id: row.get(2)?,
        project_name: row.get(3)?,
        project_color: row.get(4)?,
        client_id: row.get(5)?,
        client_name: row.get(6)?,
        start_at_utc: row.get(7)?,
        end_at_utc,
        duration_seconds: row.get(9)?,
        is_billable: row.get::<_, i64>(10)? != 0,
        source: row.get(11)?,
        deleted_at_utc: row.get(12)?,
        created_at_utc: row.get(13)?,
        updated_at_utc: row.get(14)?,
        tags,
        running: end_at_utc.is_none(),
    })
}

pub fn get_entry(conn: &Connection, id: &str) -> Result<Option<TimeEntry>> {
    let sql = format!("{ENTRY_SELECT} WHERE e.id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(row) => Ok(Some(map_entry(row)?)),
        None => Ok(None),
    }
}

pub fn get_active(conn: &Connection) -> Result<Option<TimeEntry>> {
    let sql = format!(
        "{ENTRY_SELECT} WHERE e.end_at_utc IS NULL AND e.deleted_at_utc IS NULL ORDER BY e.start_at_utc DESC LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        Some(row) => Ok(Some(map_entry(row)?)),
        None => Ok(None),
    }
}

pub fn list_entries(
    conn: &Connection,
    filter: &EntryFilter,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
    now_ms: i64,
) -> Result<Vec<TimeEntry>> {
    let mut sql = format!("{ENTRY_SELECT} WHERE 1 = 1");
    let mut values: Vec<Value> = Vec::new();

    if !filter.include_deleted.unwrap_or(false) {
        sql.push_str(" AND e.deleted_at_utc IS NULL");
    }
    if !filter.include_running.unwrap_or(true) {
        sql.push_str(" AND e.end_at_utc IS NOT NULL");
    }
    if let Some(from) = from_ms {
        sql.push_str(" AND COALESCE(e.end_at_utc, ?) > ?");
        values.push(Value::Integer(now_ms));
        values.push(Value::Integer(from));
    }
    if let Some(to) = to_ms {
        sql.push_str(" AND e.start_at_utc < ?");
        values.push(Value::Integer(to));
    }
    if let Some(project_id) = filter.project_id.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND e.project_id = ?");
        values.push(Value::Text(project_id.to_string()));
    }
    if let Some(client_id) = filter.client_id.as_deref().filter(|s| !s.is_empty()) {
        sql.push_str(" AND p.client_id = ?");
        values.push(Value::Text(client_id.to_string()));
    }
    if let Some(billable) = filter.billable {
        sql.push_str(" AND e.is_billable = ?");
        values.push(Value::Integer(if billable { 1 } else { 0 }));
    }
    if let Some(search) = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        sql.push_str(" AND lower(e.description) LIKE ? ESCAPE '\\'");
        values.push(Value::Text(format!(
            "%{}%",
            escape_like(&search.to_lowercase())
        )));
    }
    if let Some(tags) = filter.tag_ids.as_ref().filter(|t| !t.is_empty()) {
        for tag in tags {
            sql.push_str(
                " AND EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id = ?)",
            );
            values.push(Value::Text(tag.clone()));
        }
    }

    sql.push_str(match filter.sort.as_deref() {
        Some("start_asc") => " ORDER BY e.start_at_utc ASC, e.created_at_utc ASC",
        _ => " ORDER BY e.start_at_utc DESC, e.created_at_utc DESC",
    });

    let limit = filter.limit.unwrap_or(5000).clamp(1, 50_000);
    sql.push_str(" LIMIT ? OFFSET ?");
    values.push(Value::Integer(i64::from(limit)));
    values.push(Value::Integer(i64::from(filter.offset.unwrap_or(0))));

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(values.iter()))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(map_entry(row)?);
    }
    Ok(out)
}

/// All entries (including a running one) overlapping a UTC range, used by reports and timesheets.
/// Filtering by project/client/tag/billable is applied in the domain layer so that every report
/// widget and CSV export shares exactly the same computation.
pub fn list_overlapping(
    conn: &Connection,
    from_ms: i64,
    to_ms: i64,
    now_ms: i64,
    include_deleted: bool,
) -> Result<Vec<TimeEntry>> {
    let mut sql =
        format!("{ENTRY_SELECT} WHERE e.start_at_utc < ?1 AND COALESCE(e.end_at_utc, ?2) > ?3");
    if !include_deleted {
        sql.push_str(" AND e.deleted_at_utc IS NULL");
    }
    sql.push_str(" ORDER BY e.start_at_utc ASC");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params![to_ms, now_ms, from_ms])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(map_entry(row)?);
    }
    Ok(out)
}

pub fn find_overlaps(
    conn: &Connection,
    start_ms: i64,
    end_ms: i64,
    exclude_id: Option<&str>,
    now_ms: i64,
) -> Result<Vec<OverlapInfo>> {
    let mut sql = String::from(
        "SELECT id, description, start_at_utc, COALESCE(end_at_utc, ?1)
         FROM time_entries
         WHERE deleted_at_utc IS NULL
           AND start_at_utc < ?2
           AND COALESCE(end_at_utc, ?1) > ?3",
    );
    if exclude_id.is_some() {
        sql.push_str(" AND id <> ?4");
    }
    sql.push_str(" ORDER BY start_at_utc ASC LIMIT 50");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = match exclude_id {
        Some(id) => stmt.query(rusqlite::params![now_ms, end_ms, start_ms, id])?,
        None => stmt.query(rusqlite::params![now_ms, end_ms, start_ms])?,
    };
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(OverlapInfo {
            id: row.get(0)?,
            description: row.get(1)?,
            start_at_utc: row.get(2)?,
            end_at_utc: row.get(3)?,
        });
    }
    Ok(out)
}

pub fn recent_completed(conn: &Connection, limit: u32) -> Result<Vec<TimeEntry>> {
    let sql = format!(
        "{ENTRY_SELECT} WHERE e.end_at_utc IS NOT NULL AND e.deleted_at_utc IS NULL
         ORDER BY e.start_at_utc DESC LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query([limit])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(map_entry(row)?);
    }
    Ok(out)
}

pub fn set_entry_tags(conn: &Connection, entry_id: &str, tag_ids: &[String]) -> Result<()> {
    conn.execute("DELETE FROM entry_tags WHERE entry_id = ?1", [entry_id])?;
    let mut stmt =
        conn.prepare("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?1, ?2)")?;
    for tag_id in tag_ids {
        stmt.execute(rusqlite::params![entry_id, tag_id])?;
    }
    Ok(())
}

fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
