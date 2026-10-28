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
    app_version: String,
    shortcut_warnings: Mutex<Vec<String>>,
    shortcut_status: Mutex<ShortcutStatus>,
    tray_available: AtomicBool,
}

impl AppState {
    pub fn bootstrap(data_dir: PathBuf, app_version: String) -> Result<Self> {
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
