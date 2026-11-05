//! Opt-in native session monitoring. All OS calls happen off the UI thread, and no identity
//! is read while disabled. The worker owns/drops native subscriptions on its own thread.
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
use linux::Monitor;
#[cfg(target_os = "macos")]
use macos::Monitor;
#[cfg(windows)]
use windows::Monitor;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::domain::{machine_activity, timeutil};
use crate::models::{MachineActivityStatus, MachineCapability, MachineSession};
use crate::state::AppState;

pub(super) struct Observation {
    session: MachineSession,
    source: &'static str,
    capabilities: Vec<MachineCapability>,
    sample_locks: bool,
    sample_active: bool,
}

pub(super) struct NativeEvent {
    kind: &'static str,
    at: i64,
    source: &'static str,
}

pub(super) fn capability(
    feature: &str,
    status: &str,
    detail: impl Into<String>,
) -> MachineCapability {
    MachineCapability {
        feature: feature.into(),
        status: status.into(),
        detail: detail.into(),
    }
}

fn empty_status(enabled: bool) -> MachineActivityStatus {
    MachineActivityStatus {
        enabled,
        current_session: None,
        last_observed_at_utc: None,
        error: None,
        capabilities: ["identity", "login_time", "lock", "session"]
            .into_iter()
            .map(|feature| {
                capability(
                    feature,
                    if enabled { "unavailable" } else { "disabled" },
                    if enabled {
                        "Waiting for the native session monitor."
                    } else {
                        "Monitoring is off; account details are not read."
                    },
                )
            })
            .collect(),
    }
}

pub struct Service {
    status: Mutex<MachineActivityStatus>,
    epoch: AtomicU64,
    stopped: AtomicBool,
}

impl Default for Service {
    fn default() -> Self {
        Self {
            status: Mutex::new(empty_status(false)),
            epoch: AtomicU64::new(0),
            stopped: AtomicBool::new(false),
        }
    }
}

impl Service {
    /// Called under the DB lock when consent changes or data is restored. Invalidates queued
    /// observations before the settings transaction becomes visible to the monitor.
    pub fn invalidate(&self, enabled: bool) {
        if let Ok(mut status) = self.status.lock() {
            self.epoch.fetch_add(1, Ordering::SeqCst);
            *status = empty_status(enabled);
        }
    }

    fn config(&self) -> (u64, bool) {
        self.status
            .lock()
            .map(|status| (self.epoch.load(Ordering::SeqCst), status.enabled))
            .unwrap_or((self.epoch.load(Ordering::SeqCst), false))
    }

    pub fn status(&self) -> MachineActivityStatus {
        self.status
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| empty_status(false))
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
    }

    fn publish(&self, epoch: u64, status: MachineActivityStatus) {
        if let Ok(mut guard) = self.status.lock() {
            if self.epoch.load(Ordering::SeqCst) == epoch {
                *guard = status;
            }
        }
    }
}

pub fn spawn(app: AppHandle) {
    let service = app.state::<Service>();
    service.invalidate(
        app.state::<AppState>()
            .settings_snapshot()
            .machine_activity_enabled,
    );
    if std::thread::Builder::new()
        .name("tempodesk-machine-activity".into())
        .spawn({
            let app = app.clone();
            move || run(app)
        })
        .is_err()
    {
        let mut status = service.status();
        status.error =
            Some("Could not start the native session monitor; time tracking is unaffected.".into());
        service.publish(service.epoch.load(Ordering::SeqCst), status);
    }
}

fn run(app: AppHandle) {
    let service = app.state::<Service>();
    let state = app.state::<AppState>();
    let mut monitor: Option<Monitor> = None;
    let mut tracker = machine_activity::SessionTracker::default();
    let mut epoch = service.epoch.load(Ordering::SeqCst);
    let mut last_tick = Instant::now();
    let mut next_sample = Instant::now();
    let mut next_prune = Instant::now();
    loop {
        if service.stopped.load(Ordering::SeqCst) {
            break;
        }
        let (current_epoch, enabled) = service.config();
        // Drop queued messages on a monitoring/suspend gap. Their receipt time is not an
        // authoritative timestamp for something that happened while this process slept.
        if current_epoch != epoch || last_tick.elapsed() > Duration::from_secs(15) {
            monitor = None;
            tracker.reset();
            next_sample = Instant::now();
            epoch = current_epoch;
        }
        last_tick = Instant::now();
        let now = timeutil::now_ms();
        if Instant::now() >= next_prune {
            if let Ok(db) = state.db() {
                let _ = machine_activity::prune(&db, now);
            }
            next_prune = Instant::now() + Duration::from_secs(3600);
        }
        if !enabled {
            monitor = None;
            tracker.reset();
        } else {
            let mut events = Vec::new();
            if let Some(native) = &mut monitor {
                for notification in native.drain() {
                    if let Some(event) = tracker.notification(
                        notification.kind,
                        notification.at,
                        notification.source,
                    ) {
                        events.push(event);
                    }
                }
            }
            if Instant::now() >= next_sample {
                next_sample = Instant::now() + Duration::from_secs(5);
                let observation = (|| {
                    if monitor.is_none() {
                        monitor = Some(Monitor::new()?);
                    }
                    monitor.as_mut().expect("monitor initialized").observe()
                })();
                match observation {
                    Ok(observation) => {
                        let observed_at = timeutil::now_ms();
                        events.extend(tracker.observe(
                            &observation.session,
                            observed_at,
                            observation.source,
                            observation.sample_locks,
                            observation.sample_active,
                        ));
                        service.publish(
                            epoch,
                            MachineActivityStatus {
                                enabled: true,
                                current_session: Some(observation.session),
                                capabilities: observation.capabilities,
                                last_observed_at_utc: Some(observed_at),
                                error: None,
                            },
                        );
                    }
                    Err(error) => {
                        monitor = None;
                        tracker.reset();
                        let mut status = empty_status(true);
                        status.error = Some(error);
                        service.publish(epoch, status);
                    }
                }
            }
            if !events.is_empty() {
                let result = state.db().and_then(|db| {
                    if service.epoch.load(Ordering::SeqCst) != epoch {
                        return Ok(0);
                    }
                    machine_activity::record(&db, &events, now)
                });
                match result {
                    Ok(count) if count > 0 => {
                        let _ = app.emit("machine-activity-changed", ());
                    }
                    Ok(_) => {}
                    Err(_) => {
                        // Do not put account/session data into diagnostic logs.
                        let mut status = service.status();
                        status.error = Some(
                            "Could not save machine activity. Time tracking is unaffected.".into(),
                        );
                        service.publish(epoch, status);
                        tracker.reset();
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
struct Monitor;
#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
impl Monitor {
    fn new() -> Result<Self, String> {
        Err("Session monitoring is not supported on this platform.".into())
    }
    fn observe(&mut self) -> Result<Observation, String> {
        Err("Session monitoring is unavailable.".into())
    }
    fn drain(&mut self) -> Vec<NativeEvent> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabling_removes_cached_identity_and_rejects_in_flight_publications() {
        let service = Service::default();
        assert!(!service.status().enabled);
        service.invalidate(true);
        let (epoch, enabled) = service.config();
        assert!(enabled);
        let mut status = empty_status(true);
        status.current_session = Some(MachineSession {
            account_id: "test-id".into(),
            user_name: "Test account".into(),
            domain: None,
            machine_name: "Test machine".into(),
            session_id: None,
            login_at_utc: None,
            locked: None,
            active: None,
        });
        service.publish(epoch, status.clone());
        assert!(service.status().current_session.is_some());
        service.invalidate(false);
        service.publish(epoch, status);
        assert!(!service.status().enabled);
        assert!(service.status().current_session.is_none());
        assert!(service
            .status()
            .capabilities
            .iter()
            .all(|cap| cap.status == "disabled"));
    }
}
