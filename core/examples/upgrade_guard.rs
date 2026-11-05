//! Rehearse migrations and create an app-readable JSON backup from a workspace snapshot only.
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let raw = args.next().ok_or("Expected a migration-trial.db path")?;
    let app_version = args
        .next()
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    let path = PathBuf::from(raw).canonicalize()?;
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".upgrade-backups")
        .canonicalize()?;
    if !path.starts_with(&workspace)
        || path.file_name().and_then(|name| name.to_str()) != Some("migration-trial.db")
    {
        return Err("Refusing to migrate anything except a workspace migration trial".into());
    }
    let conn = tempodesk_core::storage::db::open_at(&path)?;
    tempodesk_core::storage::db::integrity_check(&conn)?;
    let json = path.parent().unwrap().join("tempodesk-before-upgrade.json");
    let result = tempodesk_core::domain::portability::create_backup(
        &conn,
        json.to_str().ok_or("Invalid backup path")?,
        &app_version,
        tempodesk_core::timeutil::now_ms(),
    )?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
