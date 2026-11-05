use std::time::Duration;

use zbus::blocking::{connection::Builder, Connection, Proxy};
use zbus::zvariant::OwnedObjectPath;

use super::{capability, unix, NativeEvent, Observation};
use crate::domain::timeutil;
use crate::models::MachineSession;

const SERVICE: &str = "org.freedesktop.login1";
const SOURCE: &str = "linux-logind";

pub struct Monitor {
    connection: Option<Connection>,
}

impl Monitor {
    pub fn new() -> Result<Self, String> {
        Ok(Self { connection: None })
    }

    pub fn observe(&mut self) -> Result<Observation, String> {
        let mut session = unix::account()?;
        let result = (|| {
            if self.connection.is_none() {
                self.connection = Some(
                    Builder::system()?
                        .method_timeout(Duration::from_secs(2))
                        .build()?,
                );
            }
            query_session(
                self.connection.as_ref().expect("connection initialized"),
                &mut session,
            )
        })();
        let capabilities = match result {
            Ok(()) => vec![
                capability("identity", "available", "Account identity comes from libc; the session UID is checked against this process."),
                capability("login_time", if session.login_at_utc.is_some() { "available" } else { "unavailable" }, "OS session-start timestamp from logind/elogind. App startup is never substituted."),
                capability("lock", if session.locked.is_some() { "available" } else { "unsupported" }, "Advisory LockedHint, sampled every 5 seconds. Requires desktop/compositor support; brief transitions may be missed. Works independently of X11/Wayland input APIs."),
                capability("session", if session.active.is_some() { "available" } else { "unavailable" }, "Session Active property sampled every 5 seconds. Switching sessions is not labelled as login/logout."),
            ],
            Err(error) => {
                self.connection = None;
                let permission = error.to_string().contains("AccessDenied") || error.to_string().contains("AuthFailed");
                let status = if permission { "permission_required" } else { "unavailable" };
                let detail = if permission {
                    "The system session service denied access. TempoDesk does not request administrator privileges."
                } else {
                    "logind/elogind is unavailable, or this process is not attached to a matching login session. Other users' or guessed active sessions are never used."
                };
                vec![capability("identity", "available", "Native account and machine identity are available without a session service."),
                    capability("login_time", status, detail), capability("lock", status, detail), capability("session", status, detail)]
            }
        };
        Ok(Observation {
            session,
            source: SOURCE,
            capabilities,
            sample_locks: true,
            sample_active: true,
        })
    }

    pub fn drain(&mut self) -> Vec<NativeEvent> {
        Vec::new()
    }
}

fn query_session(connection: &Connection, session: &mut MachineSession) -> zbus::Result<()> {
    let manager = Proxy::new(
        connection,
        SERVICE,
        "/org/freedesktop/login1",
        "org.freedesktop.login1.Manager",
    )?;
    // Do not use GetSession("auto") or enumerate users: an unrelated active console session
    // must not be attached to an SSH, sudo, or user-service process.
    let path: OwnedObjectPath = manager.call("GetSessionByPID", &(std::process::id(),))?;
    let proxy = Proxy::new(connection, SERVICE, path, "org.freedesktop.login1.Session")?;
    let (uid, _): (u32, OwnedObjectPath) = proxy.get_property("User")?;
    if uid != unsafe { libc::geteuid() } {
        return Err(zbus::Error::Failure(
            "The login session belongs to a different account.".into(),
        ));
    }
    let id: String = proxy.get_property("Id")?;
    let timestamp: Option<u64> = proxy.get_property("Timestamp").ok();
    session.session_id = Some(id);
    session.login_at_utc = timestamp
        .and_then(login_timestamp)
        .filter(|value| *value <= timeutil::now_ms());
    session.locked = proxy.get_property("LockedHint").ok();
    session.active = proxy.get_property("Active").ok();
    Ok(())
}

fn login_timestamp(microseconds: u64) -> Option<i64> {
    if microseconds == 0 {
        return None;
    }
    i64::try_from(microseconds / 1_000_000)
        .ok()?
        .checked_mul(1000)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logind_timestamp_is_not_an_application_start_time() {
        assert_eq!(login_timestamp(1_234_567), Some(1000));
        assert_eq!(login_timestamp(0), None);
    }
}
