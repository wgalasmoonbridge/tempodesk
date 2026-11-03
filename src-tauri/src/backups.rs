use tauri::{AppHandle, Emitter, Manager};

use crate::domain::{auto_backup, timeutil};
use crate::error::Result;
use crate::models::AutoBackupStatus;
use crate::state::AppState;

pub fn run(state: &AppState, force: bool) -> Result<AutoBackupStatus> {
    let db = state.db()?;
    let settings = crate::storage::repo_settings::load(&db)?;
    auto_backup::run(
        &db,
        &settings,
        state.data_dir(),
        state.app_version(),
        timeutil::now_ms(),
        force,
    )?;
    auto_backup::status(&db, &settings, state.data_dir())
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        let state = app.state::<AppState>();
        if let Err(error) = run(&state, false) {
            log::warn!("Automatic backup failed: {error}");
        }
        let _ = app.emit("backup-status-changed", ());
        std::thread::sleep(std::time::Duration::from_secs(60));
    });
}
