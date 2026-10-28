use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::models::IdleReview;

const IDLE_SELECT: &str = "
SELECT i.id, i.kind, i.timer_entry_id, i.idle_started_at_utc, i.activity_resumed_at_utc,
       i.status, i.created_at_utc, e.description
FROM idle_review_events i
LEFT JOIN time_entries e ON e.id = i.timer_entry_id
";

fn map_idle(row: &rusqlite::Row<'_>) -> rusqlite::Result<IdleReview> {
    Ok(IdleReview {
        id: row.get(0)?,
        kind: row.get(1)?,
        timer_entry_id: row.get(2)?,
        idle_started_at_utc: row.get(3)?,
        activity_resumed_at_utc: row.get(4)?,
        status: row.get(5)?,
        created_at_utc: row.get(6)?,
        entry_description: row.get(7)?,
    })
}

pub fn list_pending(conn: &Connection) -> Result<Vec<IdleReview>> {
    let sql =
        format!("{IDLE_SELECT} WHERE i.status = 'pending' ORDER BY i.idle_started_at_utc DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_idle)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> Result<IdleReview> {
    let sql = format!("{IDLE_SELECT} WHERE i.id = ?1");
    conn.query_row(&sql, [id], map_idle)
        .optional()?
        .ok_or_else(|| AppError::not_found("Idle review not found"))
}

/// True when an unresolved review exists for the given entry (one review per idle episode).
pub fn has_pending_for_entry(conn: &Connection, entry_id: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM idle_review_events
         WHERE status = 'pending' AND timer_entry_id = ?1",
        [entry_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn insert(
    conn: &Connection,
    kind: &str,
    entry_id: &str,
    idle_started_at_utc: i64,
    activity_resumed_at_utc: Option<i64>,
    now: i64,
) -> Result<IdleReview> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO idle_review_events
           (id, timer_entry_id, kind, idle_started_at_utc, activity_resumed_at_utc, status, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)",
        params![id, entry_id, kind, idle_started_at_utc, activity_resumed_at_utc, now],
    )?;
    get(conn, &id)
}

pub fn set_resumed(conn: &Connection, id: &str, resumed_at_utc: i64) -> Result<()> {
    conn.execute(
        "UPDATE idle_review_events SET activity_resumed_at_utc = ?1
         WHERE id = ?2 AND activity_resumed_at_utc IS NULL AND status = 'pending'",
        params![resumed_at_utc, id],
    )?;
    Ok(())
}

pub fn mark_resolved(
    conn: &Connection,
    id: &str,
    status: &str,
    result_entry_id: Option<&str>,
    now: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE idle_review_events
         SET status = ?1, result_entry_id = ?2, resolved_at_utc = ?3
         WHERE id = ?4",
        params![status, result_entry_id, now, id],
    )?;
    Ok(())
}
