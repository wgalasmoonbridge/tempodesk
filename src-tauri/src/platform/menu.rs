use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let about = MenuItemBuilder::with_id("about", "About TempoDesk").build(app)?;
    let preferences = MenuItemBuilder::with_id("preferences", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let new_entry = MenuItemBuilder::with_id("new-entry", "New Manual Entry")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let search = MenuItemBuilder::with_id("focus-search", "Search…")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let hide_window = MenuItemBuilder::with_id("hide-window", "Hide to Tray")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let shortcuts = MenuItemBuilder::with_id("shortcuts", "Keyboard Shortcuts").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit TempoDesk")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let sep4 = PredefinedMenuItem::separator(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .items(&[&new_entry, &search, &sep1, &hide_window])
        .item(if cfg!(target_os = "macos") {
            &sep2
        } else {
            &quit
        })
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .items(&[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep3,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ])
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .items(&[&shortcuts, &sep4, &about])
        .build()?;

    let mut menu = MenuBuilder::new(app);
    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, "TempoDesk")
            .items(&[
                &about,
                &sep1,
                &preferences,
                &sep2,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &sep3,
                &quit,
            ])
            .build()?;
        menu = menu.item(&app_menu);
    }
    let menu = menu
        .items(&[&file_menu, &edit_menu, &window_menu, &help_menu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

pub fn handle(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref().to_string();
    match id.as_str() {
        "preferences" => crate::platform::window::navigate(app, "settings"),
        "new-entry" => {
            crate::platform::window::show_main(app);
            let _ = app.emit("new-entry", ());
        }
        "focus-search" => {
            crate::platform::window::show_main(app);
            let _ = app.emit("focus-search", ());
        }
        "hide-window" => {
            let close_to_tray = app
                .state::<crate::state::AppState>()
                .settings_snapshot()
                .close_to_tray;
            if close_to_tray {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            } else {
                crate::platform::window::show_main(app);
                let _ = app.emit("quit-requested", ());
            }
        }
        "quit" => {
            crate::platform::window::show_main(app);
            let _ = app.emit("quit-requested", ());
        }
        "about" => crate::platform::window::navigate(app, "settings"),
        "shortcuts" => {
            crate::platform::window::show_main(app);
            let _ = app.emit("show-shortcuts", ());
        }
        _ => {}
    }
}
