use rusqlite::{params, Connection};

use crate::error::{AppError, Result};
use crate::models::{MachineActivityEvent, MachineActivityFilter, MachineActivityPage};

pub fn validate_filter(filter: &MachineActivityFilter) -> Result<()> {
    if filter.from_utc.is_some_and(|value| value < 0)
        || filter.to_utc.is_some_and(|value| value < 0)
        || matches!((filter.from_utc, filter.to_utc), (Some(from), Some(to)) if from >= to)
    {
        return Err(AppError::validation(
            "Choose a valid machine activity date range",
        ));
    }
    Ok(())
}

pub fn prune(conn: &Connection, cutoff: i64) -> Result<usize> {
    Ok(conn.execute(
        "DELETE FROM machine_activity WHERE event_at_utc < ?1",
        [cutoff],
    )?)
}

pub fn insert(conn: &Connection, event: &MachineActivityEvent, key: Option<&str>) -> Result<bool> {
    Ok(conn.execute(
        "INSERT INTO machine_activity (id, event_key, account_id, user_name, domain, machine_name,
            session_id, kind, event_at_utc, observed_at_utc, source, timing)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(event_key) DO NOTHING",
        params![
            event.id,
            key,
            event.account_id,
            event.user_name,
            event.domain,
            event.machine_name,
            event.session_id,
            event.kind,
            event.event_at_utc,
            event.observed_at_utc,
            event.source,
            event.timing
        ],
    )? > 0)
}

pub fn list(conn: &Connection, filter: &MachineActivityFilter) -> Result<MachineActivityPage> {
    validate_filter(filter)?;
    let total_count = conn.query_row(
        "SELECT COUNT(*) FROM machine_activity
         WHERE (?1 IS NULL OR event_at_utc >= ?1) AND (?2 IS NULL OR event_at_utc < ?2)",
        params![filter.from_utc, filter.to_utc],
        |row| row.get(0),
    )?;
    let mut stmt = conn.prepare(
        "SELECT id, account_id, user_name, domain, machine_name, session_id, kind,
            event_at_utc, observed_at_utc, source, timing
         FROM machine_activity
         WHERE (?1 IS NULL OR event_at_utc >= ?1) AND (?2 IS NULL OR event_at_utc < ?2)
         ORDER BY event_at_utc DESC, id DESC LIMIT ?3 OFFSET ?4",
    )?;
    let rows = stmt.query_map(
        params![
            filter.from_utc,
            filter.to_utc,
            filter.limit.unwrap_or(100).clamp(1, 500),
            filter.offset.unwrap_or(0)
        ],
        |row| {
            Ok(MachineActivityEvent {
                id: row.get(0)?,
                account_id: row.get(1)?,
                user_name: row.get(2)?,
                domain: row.get(3)?,
                machine_name: row.get(4)?,
                session_id: row.get(5)?,
                kind: row.get(6)?,
                event_at_utc: row.get(7)?,
                observed_at_utc: row.get(8)?,
                source: row.get(9)?,
                timing: row.get(10)?,
            })
        },
    )?;
    let events = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(MachineActivityPage {
        events,
        total_count,
    })
}

pub fn clear(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("DELETE FROM machine_activity", [])?)
}
