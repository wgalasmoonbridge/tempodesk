use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::domain::idle;
use crate::domain::timeutil;
use crate::state::AppState;
use crate::storage::{repo_entries, repo_settings};

/// Returns the number of seconds since the last user input, if the OS exposes it.
#[cfg(windows)]
pub fn idle_seconds() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if !ok.as_bool() {
        return None;
    }
    let tick = unsafe { GetTickCount64() };
    Some(tick.saturating_sub(u64::from(info.dwTime)) / 1000)
}

/// macOS: CoreGraphics combined-session idle time (no accessibility permission required for
/// aggregate idle time; no window/keystroke content is read).
#[cfg(target_os = "macos")]
pub fn idle_seconds() -> Option<u64> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }
    const COMBINED_SESSION_STATE: i32 = 0;
    const ANY_INPUT_EVENT_TYPE: u32 = 0xFFFF_FFFF;
    let seconds = unsafe {
        CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT_TYPE)
    };
    if seconds.is_finite() && seconds >= 0.0 {
        Some(seconds as u64)
    } else {
        None
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn idle_seconds() -> Option<u64> {
    None
}

pub fn is_available() -> bool {
    #[cfg(any(windows, target_os = "macos"))]
    {
        idle_seconds().is_some()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        false
    }
}

pub fn unavailable_reason() -> Option<String> {
    if is_available() {
        None
    } else {
        Some("Idle detection is not available on this platform.".to_string())
    }
}

/// Background heartbeat + idle monitor. Idle polling only happens when the user enabled it.
/// The heartbeat is also used for crash/sleep recovery review.
pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("tempodesk-heartbeat".into())
        .spawn(move || {
            let mut last_tick = timeutil::now_ms();
            let mut last_persist = last_tick;
            let mut last_tray = last_tick;
            let mut reminder_anchor: Option<i64> = None;
            let mut reminder_sent = false;
            loop {
                std::thread::sleep(Duration::from_secs(5));
                let now = timeutil::now_ms();
                let gap = now - last_tick;
                last_tick = now;

                let state = app.state::<AppState>();
                let settings = state.settings_snapshot();

                // Persist the last-known running instant (recovery estimate after a crash).
                if now - last_persist >= 15_000 {
                    if let Ok(db) = state.db() {
                        let _ = repo_settings::set_runtime(
                            &db,
                            "last_heartbeat_utc",
                            &now.to_string(),
                        );
                    }
                    last_persist = now;
                }

                let mut changed = false;

                // A >90s pause means the process was suspended (sleep/hibernate) or the wall
                // clock moved; queue one review instead of silently trusting the gap.
                if gap.abs() > 90_000 {
                    if let Ok(db) = state.db() {
                        match idle::create_sleep_review(&db, now - gap, now) {
                            Ok(Some(_)) => {
                                changed = true;
                                notify(
                                    &app,
                                    "TempoDesk was suspended",
                                    "A timer kept running across a sleep or clock gap. Review the time.",
                                );
                            }
                            Ok(None) => {}
                            Err(err) => log::warn!("sleep review failed: {err}"),
                        }
                    }
                }

                if settings.idle_tracking_enabled {
                    if let Some(seconds) = idle_seconds() {
                        let threshold = i64::from(settings.idle_threshold_minutes) * 60;
                        if seconds as i64 >= threshold {
                            if let Ok(db) = state.db() {
                                match idle::create_idle_review(&db, seconds as i64, now) {
                                    Ok(Some(_)) => {
                                        changed = true;
                                        notify(
                                            &app,
                                            "Are you still working?",
                                            "TempoDesk noticed you were away. Choose how to handle the idle time.",
                                        );
                                    }
                                    Ok(None) => {}
                                    Err(err) => log::warn!("idle review failed: {err}"),
                                }
                            }
                        } else if seconds <= 3 {
                            if let Ok(db) = state.db() {
                                let _ = idle::mark_activity_resumed(&db, now);
                            }
                        }
                    }
                }

                // Tracking reminder: one native notification per "not tracking" episode, so it
                // never spams. Starting a timer re-arms the reminder for the next episode.
                if settings.tracking_reminder_enabled {
                    let active = state
                        .db()
                        .ok()
                        .and_then(|db| repo_entries::get_active(&db).ok())
                        .flatten();
                    if active.is_some() {
                        reminder_anchor = None;
                        reminder_sent = false;
                    } else if reminder_anchor.is_none() {
                        reminder_anchor = Some(now);
                        reminder_sent = false;
                    } else if !reminder_sent
                        && now - reminder_anchor.unwrap_or(now)
                            >= i64::from(settings.tracking_reminder_minutes) * 60_000
                    {
                        reminder_sent = true;
                        notify(
                            &app,
                            "Track your time",
                            "You haven't started a timer in a while. Start one to keep accurate records.",
                        );
                        // In-app fallback when native notifications are unavailable or denied.
                        let _ = app.emit("tracking-reminder", ());
                    }
                } else {
                    reminder_anchor = None;
                    reminder_sent = false;
                }

                if changed {
                    let _ = app.emit("idle-review-required", ());
                }
                if changed || now - last_tray >= 30_000 {
                    crate::platform::tray::refresh(&app);
                    last_tray = now;
                }
            }
        })
        .ok();
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}
