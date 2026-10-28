pub mod commands;
pub mod platform;
pub mod state;

// Domain, storage, and models live in the Tauri-free `tempodesk-core` crate.
pub use tempodesk_core::{domain, error, models, storage, timeutil};

use std::sync::atomic::Ordering;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::state::AppState;

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();

    tauri::Builder::default()
        // Must be the first plugin: focus the existing window on a second launch.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            platform::window::show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    platform::shortcuts::handle(app, shortcut, event);
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            let state = AppState::bootstrap(data_dir, app.package_info().version.to_string())?;
            app.manage(state);

            let start_hidden = std::env::args().any(|arg| arg == "--autostart");
            if let Some(window) = app.get_webview_window("main") {
                if start_hidden {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            if let Err(err) = platform::menu::setup(&handle) {
                log::warn!("native menu setup failed: {err}");
            }
            if let Err(err) = platform::tray::setup(&handle) {
                log::warn!("tray setup failed: {err}");
            }
            let settings = app.state::<AppState>().settings_snapshot();
            let warnings = platform::shortcuts::apply(&handle, &settings);
            for warning in warnings {
                log::warn!("{warning}");
            }
            for warning in platform::sync_autostart(&handle, settings.launch_at_login) {
                log::warn!("{warning}");
            }
            platform::idle::spawn(handle.clone());
            Ok(())
        })
        .on_menu_event(platform::menu::handle)
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if !platform::window::QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    platform::window::handle_close_requested(window);
                }
            }
            WindowEvent::Focused(true) => {
                let _ = tauri::Emitter::emit(window, "window-focused", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_status,
            commands::get_platform_info,
            commands::start_timer,
            commands::switch_timer,
            commands::stop_timer,
            commands::resume_entry,
            commands::resolve_recovery,
            commands::get_recovery_info,
            commands::list_entries,
            commands::create_manual_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::restore_entry,
            commands::list_clients,
            commands::save_client,
            commands::archive_client,
            commands::list_projects,
            commands::save_project,
            commands::archive_project,
            commands::list_tags,
            commands::save_tag,
            commands::archive_tag,
            commands::delete_tag,
            commands::get_timesheet,
            commands::get_report,
            commands::export_report_csv,
            commands::get_pending_idle_reviews,
            commands::resolve_idle_review,
            commands::get_settings,
            commands::update_settings,
            commands::get_shortcut_status,
            commands::save_backup,
            commands::preview_restore,
            commands::restore_backup,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build TempoDesk")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                platform::window::mark_clean_exit(app);
            }
        });
}
