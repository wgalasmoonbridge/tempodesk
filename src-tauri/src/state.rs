use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::domain::timer;
use crate::domain::timeutil;
use crate::error::{AppError, Result};
use crate::models::{AppSettings, RecoveryInfo, ShortcutStatus};
use crate::storage::{db, repo_settings};

pub struct AppState {
    db: Mutex<Connection>,
    settings: Mutex<AppSettings>,
    recovery: Mutex<Option<RecoveryInfo>>,
    data_dir: PathBuf,
    data_profile: String,
    app_version: String,
    shortcut_warnings: Mutex<Vec<String>>,
    shortcut_status: Mutex<ShortcutStatus>,
    tray_available: AtomicBool,
}

/// Resolve the data directory for this build.
///
/// Release/production builds always use the OS app-data directory. Debug builds use a sibling
/// `...-dev` directory (or a directory explicitly supplied via `TEMPO_DATA_DIR`) so development,
/// UI tests, and crash tests can never touch the installed app's database or backups.
pub fn resolve_data_dir(
    base: &Path,
    debug: bool,
    override_dir: Option<&str>,
) -> (PathBuf, &'static str) {
    if !debug {
        return (base.to_path_buf(), "production");
    }
    if let Some(raw) = override_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return (PathBuf::from(raw), "test");
    }
    let name = base
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("tempodesk");
    if name.to_ascii_lowercase().contains("dev") {
        return (base.to_path_buf(), "development");
    }
    let parent = base.parent().unwrap_or_else(|| Path::new("."));
    (parent.join(format!("{name}-dev")), "development")
}

impl AppState {
    pub fn bootstrap(base_data_dir: PathBuf, app_version: String) -> Result<Self> {
        let (data_dir, data_profile) = resolve_data_dir(
            &base_data_dir,
            cfg!(debug_assertions),
            std::env::var("TEMPO_DATA_DIR").ok().as_deref(),
        );
        std::fs::create_dir_all(&data_dir)?;
        let db_path = data_dir.join("tempodesk.db");
        let conn = db::open_at(&db_path)?;
        if let Err(err) = db::integrity_check(&conn) {
            log::error!("database integrity check failed: {err}");
            return Err(err);
        }
        let settings = repo_settings::load(&conn)?;
        let now = timeutil::now_ms();
        // Detect before marking the new process as running.
        let recovery = timer::detect_recovery(&conn, now)?;
        repo_settings::set_runtime(&conn, "clean_exit", "0")?;
        repo_settings::set_runtime(&conn, "last_heartbeat_utc", &now.to_string())?;

        Ok(Self {
            db: Mutex::new(conn),
            settings: Mutex::new(settings),
            recovery: Mutex::new(recovery),
            data_dir,
            data_profile: data_profile.to_string(),
            app_version,
            shortcut_warnings: Mutex::new(Vec::new()),
            shortcut_status: Mutex::new(ShortcutStatus {
                open_ok: true,
                toggle_ok: true,
                errors: Vec::new(),
            }),
            tray_available: AtomicBool::new(false),
        })
    }

    pub fn db(&self) -> Result<MutexGuard<'_, Connection>> {
        self.db
            .lock()
            .map_err(|_| AppError::Internal("Database lock was poisoned".into()))
    }

    pub fn settings_snapshot(&self) -> AppSettings {
        self.settings.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn set_settings(&self, settings: AppSettings) {
        if let Ok(mut guard) = self.settings.lock() {
            *guard = settings;
        }
    }

    pub fn recovery_snapshot(&self) -> Option<RecoveryInfo> {
        self.recovery.lock().ok().and_then(|r| r.clone())
    }

    pub fn clear_recovery(&self) {
        if let Ok(mut guard) = self.recovery.lock() {
            *guard = None;
        }
    }

    pub fn reload_recovery(&self) -> Result<()> {
        let conn = self.db()?;
        let pending = timer::detect_recovery(&conn, timeutil::now_ms())?;
        if let Ok(mut guard) = self.recovery.lock() {
            *guard = pending;
        }
        Ok(())
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("tempodesk.db")
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn data_profile(&self) -> &str {
        &self.data_profile
    }

    pub fn is_production(&self) -> bool {
        self.data_profile == "production"
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }

    pub fn app_version(&self) -> &str {
        &self.app_version
    }

    pub fn set_tray_available(&self, available: bool) {
        self.tray_available.store(available, Ordering::SeqCst);
    }

    pub fn tray_available(&self) -> bool {
        self.tray_available.load(Ordering::SeqCst)
    }

    pub fn set_shortcut_status(&self, status: ShortcutStatus) {
        if let Ok(mut warnings) = self.shortcut_warnings.lock() {
            warnings.clear();
            warnings.extend(status.errors.clone());
        }
        if let Ok(mut guard) = self.shortcut_status.lock() {
            *guard = status;
        }
    }

    pub fn shortcut_status(&self) -> ShortcutStatus {
        self.shortcut_status
            .lock()
            .map(|s| s.clone())
            .unwrap_or(ShortcutStatus {
                open_ok: true,
                toggle_ok: true,
                errors: Vec::new(),
            })
    }
}
