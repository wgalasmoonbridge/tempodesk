use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

use crate::error::{AppError, Result};
use crate::timeutil;

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_init.sql")),
    (2, include_str!("../../migrations/0002_workflows.sql")),
    (
        3,
        include_str!("../../migrations/0003_machine_activity.sql"),
    ),
];

/// Open the app database, creating directories/privacy-friendly file if needed.
pub fn open_at(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

/// In-memory database with all migrations applied (used by tests and tooling).
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(())
}

fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at_utc INTEGER NOT NULL
         );",
    )?;

    let mut applied = HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT version FROM schema_migrations")?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
        for row in rows {
            applied.insert(row?);
        }
    }

    for (version, sql) in MIGRATIONS {
        if applied.contains(version) {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at_utc) VALUES (?1, ?2)",
            rusqlite::params![version, timeutil::now_ms()],
        )?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn integrity_check(conn: &Connection) -> Result<String> {
    let result: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(AppError::Internal(format!(
            "Database integrity check failed: {result}"
        )));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_and_enforces_foreign_keys() {
        let conn = open_in_memory().unwrap();
        assert_eq!(integrity_check(&conn).unwrap(), "ok");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 3);
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        // Unknown project must be rejected by the foreign key.
        let err = conn.execute(
            "INSERT INTO time_entries (id, description, project_id, start_at_utc, end_at_utc, duration_seconds, is_billable, source, created_at_utc, updated_at_utc)
             VALUES ('e1', '', 'missing', 0, 1000, 1, 0, 'manual', 0, 0)",
            [],
        );
        assert!(err.is_err());
    }

    #[test]
    fn upgrades_version_one_without_changing_existing_entries() {
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        conn.execute_batch(MIGRATIONS[0].1).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at_utc INTEGER NOT NULL); INSERT INTO schema_migrations VALUES (1, 1000); PRAGMA user_version = 1;").unwrap();
        conn.execute("INSERT INTO time_entries (id, description, start_at_utc, end_at_utc, duration_seconds, is_billable, source, created_at_utc, updated_at_utc) VALUES ('preserved', 'Existing work', 1000, 61000, 60, 1, 'manual', 1000, 1000)", []).unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // Restart does not reapply the migration.
        let description: String = conn
            .query_row(
                "SELECT description FROM time_entries WHERE id = 'preserved'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(description, "Existing work");
        assert_eq!(integrity_check(&conn).unwrap(), "ok");
    }

    #[test]
    fn upgrades_version_two_without_changing_timers_or_saved_tasks() {
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        conn.execute_batch(MIGRATIONS[0].1).unwrap();
        conn.execute_batch(MIGRATIONS[1].1).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at_utc INTEGER NOT NULL); INSERT INTO schema_migrations VALUES (1, 1000), (2, 1000); PRAGMA user_version = 2;").unwrap();
        conn.execute("INSERT INTO time_entries (id, description, start_at_utc, source, created_at_utc, updated_at_utc) VALUES ('active', 'Still running', 1000, 'timer', 1000, 1000)", []).unwrap();
        conn.execute(
            "INSERT INTO task_templates (id, name) VALUES ('task', 'Saved work')",
            [],
        )
        .unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM time_entries WHERE id = 'active' AND end_at_utc IS NULL",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row(
                "SELECT name FROM task_templates WHERE id = 'task'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "Saved work"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM machine_activity", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(
            !crate::storage::repo_settings::load(&conn)
                .unwrap()
                .machine_activity_enabled
        );
        assert_eq!(integrity_check(&conn).unwrap(), "ok");
    }

    #[test]
    fn only_one_active_entry_allowed_by_db() {
        let conn = open_in_memory().unwrap();
        let insert = |id: &str| {
            conn.execute(
                "INSERT INTO time_entries (id, description, start_at_utc, is_billable, source, created_at_utc, updated_at_utc)
                 VALUES (?1, '', 1000, 0, 'timer', 0, 0)",
                rusqlite::params![id],
            )
        };
        insert("a").unwrap();
        assert!(
            insert("b").is_err(),
            "second active entry must violate the unique index"
        );
    }
}
