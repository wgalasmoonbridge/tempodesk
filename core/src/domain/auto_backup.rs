use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::domain::portability;
use crate::error::{AppError, Result};
use crate::models::{AppSettings, AutoBackupStatus};
use crate::storage::repo_settings;

pub fn directory(settings: &AppSettings, data_dir: &Path) -> PathBuf {
    if settings.auto_backup_directory.is_empty() {
        data_dir.join("automatic-backups")
    } else {
        PathBuf::from(&settings.auto_backup_directory).join("TempoDesk automatic backups")
    }
}

pub fn status(
    conn: &Connection,
    settings: &AppSettings,
    data_dir: &Path,
) -> Result<AutoBackupStatus> {
    Ok(AutoBackupStatus {
        directory: directory(settings, data_dir).display().to_string(),
        last_backup_at_utc: repo_settings::get_runtime(conn, "auto_backup_at")?
            .and_then(|raw| raw.parse().ok()),
        last_backup_path: repo_settings::get_runtime(conn, "auto_backup_path")?,
        error: repo_settings::get_runtime(conn, "auto_backup_error")?.filter(|raw| !raw.is_empty()),
    })
}

/// Runs under the app's database mutex, including snapshot creation and retention.
pub fn run(
    conn: &Connection,
    settings: &AppSettings,
    data_dir: &Path,
    version: &str,
    now: i64,
    force: bool,
) -> Result<bool> {
    if !settings.auto_backup_enabled {
        return Ok(false);
    }
    let dir = directory(settings, data_dir);
    let previous = status(conn, settings, data_dir)?;
    let same_directory = previous
        .last_backup_path
        .as_ref()
        .is_some_and(|path| Path::new(path).parent() == Some(dir.as_path()));
    let recent = previous
        .last_backup_at_utc
        .is_some_and(|last| now >= last && now - last < 86_400_000);
    let exists = previous
        .last_backup_path
        .as_ref()
        .is_some_and(|path| Path::new(path).is_file());
    if !force && recent && same_directory && exists && previous.error.is_none() {
        return Ok(false);
    }

    let result: Result<()> = (|| {
        // Retry failed retention without creating another snapshot every minute.
        if !force && recent && same_directory && exists {
            prune(
                &dir,
                settings.auto_backup_retention as usize,
                Path::new(previous.last_backup_path.as_ref().unwrap()),
            )?;
            return Ok(());
        }
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!(
            "tempodesk-auto-{now}-{}.json",
            uuid::Uuid::new_v4()
        ));
        portability::create_backup(conn, &path.to_string_lossy(), version, now)?;
        repo_settings::set_runtime(conn, "auto_backup_at", &now.to_string())?;
        repo_settings::set_runtime(conn, "auto_backup_path", &path.to_string_lossy())?;
        prune(&dir, settings.auto_backup_retention as usize, &path)?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            repo_settings::set_runtime(conn, "auto_backup_error", "")?;
            Ok(true)
        }
        Err(error) => {
            repo_settings::set_runtime(conn, "auto_backup_error", &error.to_string())?;
            Err(error)
        }
    }
}

fn prune(dir: &Path, keep: usize, current: &Path) -> Result<()> {
    if keep == 0 {
        return Err(AppError::validation("Keep at least one automatic backup"));
    }
    let mut files = Vec::new();
    for item in std::fs::read_dir(dir)? {
        let item = item?;
        if !item.file_type()?.is_file() {
            continue;
        } // Leave symlinks and directories alone.
        let name = item.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(stem) = name
            .strip_prefix("tempodesk-auto-")
            .and_then(|s| s.strip_suffix(".json"))
        else {
            continue;
        };
        let Some((timestamp, id)) = stem.split_once('-') else {
            continue;
        };
        let (Ok(timestamp), Ok(_)) = (timestamp.parse::<i64>(), uuid::Uuid::parse_str(id)) else {
            continue;
        };
        files.push((timestamp, item.path()));
    }
    // Always retain the just-written snapshot, including after a backwards system-clock change.
    files.sort_by(|a, b| {
        (b.1 == current)
            .cmp(&(a.1 == current))
            .then_with(|| b.0.cmp(&a.0))
            .then_with(|| b.1.cmp(&a.1))
    });
    for (_, path) in files.into_iter().skip(keep) {
        std::fs::remove_file(path)?;
    }
    Ok(())
}
