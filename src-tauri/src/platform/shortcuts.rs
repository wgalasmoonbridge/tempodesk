use tauri::{AppHandle, Emitter, Manager};

use crate::domain::timer;
use crate::models::{AppSettings, ShortcutStatus};
use crate::state::AppState;
use crate::storage::repo_entries;

pub fn validate_settings(settings: &AppSettings) -> crate::error::Result<()> {
    if !settings.shortcuts_enabled {
        return Ok(());
    }
    for (label, value) in [
        ("Open/hide", settings.open_shortcut.as_str()),
        ("Timer toggle", settings.toggle_shortcut.as_str()),
    ] {
        if value
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .is_err()
        {
            return Err(crate::error::AppError::validation(format!(
                "{label} shortcut \"{value}\" is not a valid key binding"
            )));
        }
    }
    if settings.open_shortcut == settings.toggle_shortcut {
        return Err(crate::error::AppError::validation(
            "The open and timer shortcuts must be different",
        ));
    }
    Ok(())
}

/// Register (or clear) the global shortcuts. Registration failures are reported, never fatal.
pub fn apply(app: &AppHandle, settings: &AppSettings) -> Vec<String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let state = app.state::<AppState>();
    let gs = app.global_shortcut();
    if let Err(err) = gs.unregister_all() {
        log::warn!("could not unregister global shortcuts: {err}");
    }

    let mut status = ShortcutStatus {
        open_ok: true,
        toggle_ok: true,
        errors: Vec::new(),
    };

    if settings.shortcuts_enabled {
        if let Err(err) = gs.register(settings.open_shortcut.as_str()) {
            status.open_ok = false;
            status.errors.push(format!(
                "Open/hide shortcut “{}” could not be registered: {err}",
                settings.open_shortcut
            ));
        }
        if let Err(err) = gs.register(settings.toggle_shortcut.as_str()) {
            status.toggle_ok = false;
            status.errors.push(format!(
                "Timer shortcut “{}” could not be registered: {err}",
                settings.toggle_shortcut
            ));
        }
    }

    state.set_shortcut_status(status.clone());
    let _ = app.emit("shortcut-status", status.clone());
    status.errors
}

pub fn handle(
    app: &AppHandle,
    shortcut: &tauri_plugin_global_shortcut::Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    use tauri_plugin_global_shortcut::ShortcutState;
    if event.state != ShortcutState::Pressed {
        return;
    }
    let state = app.state::<AppState>();
    let settings = state.settings_snapshot();
    if !settings.shortcuts_enabled {
        return;
    }
    let open: Option<tauri_plugin_global_shortcut::Shortcut> = settings.open_shortcut.parse().ok();
    let toggle: Option<tauri_plugin_global_shortcut::Shortcut> =
        settings.toggle_shortcut.parse().ok();

    if open.as_ref() == Some(shortcut) {
        crate::platform::window::toggle_main(app);
        return;
    }
    if toggle.as_ref() != Some(shortcut) {
        return;
    }

    let result: crate::error::Result<()> = (|| {
        let mut db = state.db()?;
        let now = crate::domain::timeutil::now_ms();
        if repo_entries::get_active(&db)?.is_some() {
            timer::stop(&mut db, now)?;
        } else {
            timer::start(&mut db, &Default::default(), now)?;
        }
        Ok(())
    })();

    match result {
        Ok(()) => {
            state.clear_recovery();
            let _ = app.emit("timer-state-changed", ());
            crate::platform::tray::refresh(app);
        }
        Err(err) => {
            log::warn!("global shortcut failed: {err}");
            let _ = app.emit(
                "app-error",
                serde_json::json!({ "code": err.code(), "message": err.to_string() }),
            );
        }
    }
}
