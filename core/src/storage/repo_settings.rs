use chrono_tz::Tz;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, Result};
use crate::models::{AppSettings, SettingsPatch};

pub fn load(conn: &Connection) -> Result<AppSettings> {
    let mut merged = serde_json::to_value(AppSettings::default())?;
    let mut stmt = conn.prepare("SELECT key, value_json FROM app_settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (key, raw) = row?;
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        if let serde_json::Value::Object(map) = &mut merged {
            if map.contains_key(&key) {
                map.insert(key, value);
            }
        }
    }
    let mut settings: AppSettings = serde_json::from_value(merged).unwrap_or_default();
    normalize_loaded(&mut settings);
    Ok(settings)
}

fn normalize_loaded(settings: &mut AppSettings) {
    if !matches!(settings.theme.as_str(), "system" | "light" | "dark") {
        settings.theme = "system".into();
    }
    if !matches!(settings.start_of_week.as_str(), "monday" | "sunday") {
        settings.start_of_week = "monday".into();
    }
    if !matches!(settings.time_format.as_str(), "auto" | "12h" | "24h") {
        settings.time_format = "auto".into();
    }
    if settings.timezone.trim().is_empty() {
        settings.timezone = "system".into();
    }
    settings.idle_threshold_minutes = settings.idle_threshold_minutes.clamp(1, 60);
    if settings.open_shortcut.trim().is_empty() {
        settings.open_shortcut = "CommandOrControl+Shift+T".into();
    }
    if settings.toggle_shortcut.trim().is_empty() {
        settings.toggle_shortcut = "CommandOrControl+Shift+Y".into();
    }
    if settings.ai_provider != "gemini" {
        settings.ai_provider = "gemini".into();
    }
    let model = settings.ai_model.trim();
    if model.is_empty()
        || model.chars().count() > 80
        || !model
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        settings.ai_model = "gemini-2.5-flash".into();
    } else {
        settings.ai_model = model.to_string();
    }
}

pub fn save_all(conn: &Connection, settings: &AppSettings) -> Result<()> {
    let value = serde_json::to_value(settings)?;
    let serde_json::Value::Object(map) = value else {
        return Err(AppError::Internal("Settings serialization failed".into()));
    };
    let tx = conn.unchecked_transaction()?;
    for (key, value) in map {
        tx.execute(
            "INSERT INTO app_settings (key, value_json) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            params![key, value.to_string()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn apply_patch(settings: &mut AppSettings, patch: &SettingsPatch) -> Result<()> {
    if let Some(theme) = &patch.theme {
        if !matches!(theme.as_str(), "system" | "light" | "dark") {
            return Err(AppError::validation("Theme must be system, light, or dark"));
        }
        settings.theme = theme.clone();
    }
    if let Some(week) = &patch.start_of_week {
        if !matches!(week.as_str(), "monday" | "sunday") {
            return Err(AppError::validation(
                "Start of week must be monday or sunday",
            ));
        }
        settings.start_of_week = week.clone();
    }
    if let Some(tz) = &patch.timezone {
        let trimmed = tz.trim();
        if trimmed.is_empty() || (trimmed != "system" && trimmed.parse::<Tz>().is_err()) {
            return Err(AppError::validation("Unknown time zone"));
        }
        settings.timezone = trimmed.to_string();
    }
    if let Some(format) = &patch.time_format {
        if !matches!(format.as_str(), "auto" | "12h" | "24h") {
            return Err(AppError::validation(
                "Time format must be auto, 12h, or 24h",
            ));
        }
        settings.time_format = format.clone();
    }
    if let Some(value) = patch.close_to_tray {
        settings.close_to_tray = value;
    }
    if let Some(value) = patch.launch_at_login {
        settings.launch_at_login = value;
    }
    if let Some(value) = patch.idle_tracking_enabled {
        settings.idle_tracking_enabled = value;
    }
    if let Some(value) = patch.idle_threshold_minutes {
        if !(1..=60).contains(&value) {
            return Err(AppError::validation(
                "Idle threshold must be between 1 and 60 minutes",
            ));
        }
        settings.idle_threshold_minutes = value;
    }
    if let Some(value) = patch.shortcuts_enabled {
        settings.shortcuts_enabled = value;
    }
    if let Some(value) = &patch.open_shortcut {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 64 {
            return Err(AppError::validation(
                "Open shortcut is not a valid key binding",
            ));
        }
        settings.open_shortcut = trimmed.to_string();
    }
    if let Some(value) = &patch.toggle_shortcut {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.chars().count() > 64 {
            return Err(AppError::validation(
                "Timer shortcut is not a valid key binding",
            ));
        }
        settings.toggle_shortcut = trimmed.to_string();
    }
    if settings.shortcuts_enabled && settings.open_shortcut == settings.toggle_shortcut {
        return Err(AppError::validation(
            "The open and timer shortcuts must be different",
        ));
    }
    if let Some(value) = patch.onboarding_complete {
        settings.onboarding_complete = value;
    }
    if let Some(value) = patch.tray_explained {
        settings.tray_explained = value;
    }
    if let Some(value) = patch.ai_summaries_enabled {
        settings.ai_summaries_enabled = value;
    }
    if let Some(value) = &patch.ai_provider {
        if value != "gemini" {
            return Err(AppError::validation(
                "Only the Gemini provider is supported in this version",
            ));
        }
        settings.ai_provider = value.clone();
    }
    if let Some(value) = &patch.ai_model {
        let model = value.trim();
        if model.is_empty()
            || model.chars().count() > 80
            || !model
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        {
            return Err(AppError::validation(
                "Model must contain only letters, digits, dots, dashes, or underscores",
            ));
        }
        settings.ai_model = model.to_string();
    }
    if let Some(value) = patch.ai_consent {
        settings.ai_consent = value;
    }
    if let Some(value) = patch.ai_include_descriptions {
        settings.ai_include_descriptions = value;
    }
    Ok(())
}

pub fn update(conn: &Connection, patch: &SettingsPatch, now: i64) -> Result<AppSettings> {
    let _ = now;
    let mut settings = load(conn)?;
    apply_patch(&mut settings, patch)?;
    save_all(conn, &settings)?;
    Ok(settings)
}

/* ----------------------------- runtime state ----------------------------- */

pub fn get_runtime(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM runtime_state WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn set_runtime(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO runtime_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db;

    #[test]
    fn defaults_round_trip_and_patch_validation() {
        let conn = db::open_in_memory().unwrap();
        let defaults = load(&conn).unwrap();
        assert_eq!(defaults.theme, "system");
        assert!(defaults.close_to_tray);
        assert!(!defaults.idle_tracking_enabled);

        let updated = update(
            &conn,
            &SettingsPatch {
                theme: Some("dark".into()),
                idle_threshold_minutes: Some(10),
                ..Default::default()
            },
            1000,
        )
        .unwrap();
        assert_eq!(updated.theme, "dark");
        assert_eq!(load(&conn).unwrap().idle_threshold_minutes, 10);

        assert!(update(
            &conn,
            &SettingsPatch {
                theme: Some("neon".into()),
                ..Default::default()
            },
            2000
        )
        .is_err());
        assert!(update(
            &conn,
            &SettingsPatch {
                idle_threshold_minutes: Some(0),
                ..Default::default()
            },
            3000
        )
        .is_err());
        assert!(update(
            &conn,
            &SettingsPatch {
                open_shortcut: Some("Ctrl+X".into()),
                toggle_shortcut: Some("Ctrl+X".into()),
                ..Default::default()
            },
            4000
        )
        .is_err());
    }

    #[test]
    fn runtime_state_persists() {
        let conn = db::open_in_memory().unwrap();
        assert!(get_runtime(&conn, "last_heartbeat_utc").unwrap().is_none());
        set_runtime(&conn, "last_heartbeat_utc", "123").unwrap();
        assert_eq!(
            get_runtime(&conn, "last_heartbeat_utc").unwrap().as_deref(),
            Some("123")
        );
    }
}

#[cfg(test)]
mod ai_settings_tests {
    use super::*;
    use crate::storage::db;

    #[test]
    fn ai_settings_validate_provider_model_and_persist() {
        let conn = db::open_in_memory().unwrap();
        let updated = update(
            &conn,
            &SettingsPatch {
                ai_summaries_enabled: Some(true),
                ai_consent: Some(true),
                ai_include_descriptions: Some(false),
                ai_model: Some("gemini-2.5-flash".into()),
                ..Default::default()
            },
            1000,
        )
        .unwrap();
        assert!(updated.ai_summaries_enabled);
        assert!(updated.ai_consent);
        assert!(!updated.ai_include_descriptions);
        assert_eq!(updated.ai_model, "gemini-2.5-flash");
        assert_eq!(updated.ai_provider, "gemini");

        let loaded = load(&conn).unwrap();
        assert!(loaded.ai_summaries_enabled);
        assert_eq!(loaded.ai_model, "gemini-2.5-flash");

        assert!(update(
            &conn,
            &SettingsPatch {
                ai_provider: Some("other".into()),
                ..Default::default()
            },
            2000
        )
        .is_err());
        assert!(update(
            &conn,
            &SettingsPatch {
                ai_model: Some("bad model name".into()),
                ..Default::default()
            },
            3000
        )
        .is_err());
        // Invalid stored model strings are normalized rather than crashing startup.
        let mut damaged = loaded;
        damaged.ai_model = "bad model!".into();
        save_all(&conn, &damaged).unwrap();
        assert_eq!(load(&conn).unwrap().ai_model, "gemini-2.5-flash");
    }
}
