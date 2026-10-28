pub mod idle;
pub mod menu;
pub mod shortcuts;
pub mod tray;
pub mod window;

use tauri::AppHandle;

/// Sync the OS autostart entry with the saved preference. Failures are warnings only.
pub fn sync_autostart(app: &AppHandle, enabled: bool) -> Vec<String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let is_enabled = manager.is_enabled().unwrap_or(false);
    let result = if enabled && !is_enabled {
        manager.enable()
    } else if !enabled && is_enabled {
        manager.disable()
    } else {
        Ok(())
    };
    match result {
        Ok(()) => Vec::new(),
        Err(err) => vec![format!("Could not update launch at login: {err}")],
    }
}
