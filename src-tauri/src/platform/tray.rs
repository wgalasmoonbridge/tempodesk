use tauri::menu::{
    Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::domain::timer;
use crate::state::AppState;
use crate::storage::repo_entries;

fn short_label(text: &str, max: usize) -> String {
    let cleaned: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let count = cleaned.chars().count();
    if count <= max {
        cleaned
    } else {
        format!(
            "{}…",
            cleaned
                .chars()
                .take(max.saturating_sub(1))
                .collect::<String>()
        )
    }
}

fn format_hms(total_seconds: i64) -> String {
    let s = total_seconds.max(0);
    format!("{:02}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<AppState>();
    let (active, recent) = match state.db() {
        Ok(db) => (
            repo_entries::get_active(&db).ok().flatten(),
            repo_entries::recent_completed(&db, 5).unwrap_or_default(),
        ),
        Err(_) => (None, Vec::new()),
    };

    let now = crate::domain::timeutil::now_ms();
    let status_text = match &active {
        Some(entry) => {
            let seconds = (now - entry.start_at_utc) / 1000;
            let mut label = format!("Running · {}", format_hms(seconds));
            if !entry.description.is_empty() {
                label.push_str(" · ");
                label.push_str(&short_label(&entry.description, 40));
            }
            label
        }
        None => "No timer running".to_string(),
    };
    let status = MenuItem::with_id(app, "status", status_text, false, None::<&str>)?;
    let start_stop = MenuItem::with_id(
        app,
        "start_stop",
        if active.is_some() {
            "Stop timer"
        } else {
            "Start timer (no description)"
        },
        true,
        None::<&str>,
    )?;

    let recent_sub = SubmenuBuilder::new(app, "Recent entries").build()?;
    if recent.is_empty() {
        let empty = MenuItem::with_id(
            app,
            "recent_empty",
            "No recent entries",
            false,
            None::<&str>,
        )?;
        recent_sub.append(&empty)?;
    } else {
        for entry in recent {
            let mut text = if entry.description.is_empty() {
                "(no description)".to_string()
            } else {
                short_label(&entry.description, 34)
            };
            if let Some(project) = &entry.project_name {
                text.push_str(" — ");
                text.push_str(&short_label(project, 20));
            }
            let item = MenuItemBuilder::with_id(format!("recent:{}", entry.id), text)
                .enabled(true)
                .build(app)?;
            recent_sub.append(&item)?;
        }
    }

    let open = MenuItem::with_id(app, "open", "Open TempoDesk", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit TempoDesk", true, None::<&str>)?;

    MenuBuilder::new(app)
        .items(&[
            &status,
            &start_stop,
            &recent_sub,
            &sep,
            &open,
            &settings,
            &quit,
        ])
        .build()
}

/// Rebuild the tray menu/tooltip on the main thread; safe to call from any thread.
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(err) = refresh_inner(&handle) {
            log::warn!("tray refresh failed: {err}");
        }
    });
}

fn refresh_inner(app: &AppHandle) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };
    let menu = build_menu(app)?;
    tray.set_menu(Some(menu))?;

    let state = app.state::<AppState>();
    let active = state
        .db()
        .ok()
        .and_then(|db| repo_entries::get_active(&db).ok().flatten());
    let tooltip = match &active {
        Some(entry) => {
            let seconds = (crate::domain::timeutil::now_ms() - entry.start_at_utc) / 1000;
            let desc = if entry.description.is_empty() {
                "TempoDesk".to_string()
            } else {
                short_label(&entry.description, 60)
            };
            format!("{desc} — {}", format_hms(seconds))
        }
        None => "TempoDesk — no timer running".to_string(),
    };
    tray.set_tooltip(Some(tooltip))?;

    #[cfg(target_os = "macos")]
    {
        let title = active
            .as_ref()
            .map(|entry| {
                format!(
                    " {}",
                    format_hms((crate::domain::timeutil::now_ms() - entry.start_at_utc) / 1000)
                )
            })
            .unwrap_or_default();
        let _ = tray.set_title(if title.is_empty() { None } else { Some(title) });
    }
    Ok(())
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let menu = build_menu(app)?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon is missing".into()))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("TempoDesk")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            handle_menu(app, &id);
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::platform::window::show_main(tray.app_handle());
            }
        })
        .build(app)?;

    app.state::<AppState>().set_tray_available(true);
    Ok(())
}

fn handle_menu(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    match id {
        "open" => crate::platform::window::show_main(app),
        "settings" => crate::platform::window::navigate(app, "settings"),
        "quit" => {
            crate::platform::window::show_main(app);
            let _ = app.emit("quit-requested", ());
        }
        "start_stop" => {
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
                    refresh(app);
                }
                Err(err) => {
                    let _ = app.emit(
                        "app-error",
                        serde_json::json!({ "code": err.code(), "message": err.to_string() }),
                    );
                }
            }
        }
        other if other.starts_with("recent:") => {
            let entry_id = other.trim_start_matches("recent:").to_string();
            let result: crate::error::Result<()> = (|| {
                let mut db = state.db()?;
                timer::resume(&mut db, &entry_id, true, crate::domain::timeutil::now_ms())?;
                Ok(())
            })();
            match result {
                Ok(()) => {
                    state.clear_recovery();
                    let _ = app.emit("timer-state-changed", ());
                    refresh(app);
                }
                Err(err) => {
                    let _ = app.emit(
                        "app-error",
                        serde_json::json!({ "code": err.code(), "message": err.to_string() }),
                    );
                }
            }
        }
        _ => {}
    }
}
