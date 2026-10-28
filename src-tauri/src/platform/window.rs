use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, Window};

use crate::domain::{timer, timeutil};
use crate::state::AppState;
use crate::storage::repo_settings;

pub static QUITTING: AtomicBool = AtomicBool::new(false);

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn toggle_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = window.hide();
        } else {
            show_main(app);
        }
    }
}

pub fn navigate(app: &AppHandle, target: &str) {
    show_main(app);
    let _ = app.emit("navigate", target);
}

/// Caller must prevent the default close. Hides to tray, or starts the quit confirmation flow
/// when the user disabled close-to-tray.
pub fn handle_close_requested(window: &Window) {
    if QUITTING.load(Ordering::SeqCst) {
        return;
    }
    let app = window.app_handle();
    let close_to_tray = app.state::<AppState>().settings_snapshot().close_to_tray;
    if close_to_tray {
        let _ = window.hide();
        let _ = app.emit("window-hidden", ());
    } else {
        show_main(app);
        let _ = app.emit("quit-requested", ());
    }
}

/// Explicit quit flow. `stop_timer` implements the user's choice from the quit dialog.
pub fn quit(app: &AppHandle, stop_timer: bool) {
    QUITTING.store(true, Ordering::SeqCst);
    let state = app.state::<AppState>();
    let now = timeutil::now_ms();
    if stop_timer {
        if let Ok(mut db) = state.db() {
            if let Err(err) = timer::stop(&mut db, now) {
                log::info!("quit: no timer stopped: {err}");
            }
        }
    }
    if let Ok(db) = state.db() {
        let _ = repo_settings::set_runtime(&db, "last_heartbeat_utc", &now.to_string());
        let _ = repo_settings::set_runtime(&db, "clean_exit", "1");
    }
    app.exit(0);
}

/// Best-effort marker when the process is leaving normally.
pub fn mark_clean_exit(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(db) = state.db() {
        let now = timeutil::now_ms();
        let _ = repo_settings::set_runtime(&db, "last_heartbeat_utc", &now.to_string());
        let _ = repo_settings::set_runtime(&db, "clean_exit", "1");
    };
}
