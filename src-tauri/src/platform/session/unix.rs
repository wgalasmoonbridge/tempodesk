use std::ffi::CStr;

use crate::models::MachineSession;

/// Resolve the effective account through libc, never USER/LOGNAME/HOSTNAME environment variables.
/// A sudo/run-as process is not associated with someone else's desktop session.
pub fn account() -> Result<MachineSession, String> {
    unsafe {
        let uid = libc::geteuid();
        let mut size = 16_384;
        let user_name = loop {
            let mut buffer = vec![0u8; size];
            let mut account: libc::passwd = std::mem::zeroed();
            let mut result = std::ptr::null_mut();
            let code = libc::getpwuid_r(
                uid,
                &mut account,
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                &mut result,
            );
            if code == libc::ERANGE && size < 1_048_576 {
                size *= 2;
                continue;
            }
            if code != 0 || result.is_null() || account.pw_name.is_null() {
                return Err("The OS could not resolve this process's account identity.".into());
            }
            break CStr::from_ptr(account.pw_name)
                .to_string_lossy()
                .into_owned();
        };
        let mut hostname = [0u8; 1024];
        if libc::gethostname(hostname.as_mut_ptr().cast(), hostname.len()) != 0 {
            return Err("The OS could not resolve this machine's name.".into());
        }
        hostname[1023] = 0;
        let machine_name = CStr::from_ptr(hostname.as_ptr().cast())
            .to_string_lossy()
            .into_owned();
        Ok(MachineSession {
            account_id: format!("uid:{uid}"),
            user_name,
            domain: None,
            machine_name,
            session_id: None,
            login_at_utc: None,
            locked: None,
            active: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_identity_does_not_invent_session_or_login_metadata() {
        let session = account().unwrap();
        assert_eq!(
            session.account_id,
            format!("uid:{}", unsafe { libc::geteuid() })
        );
        assert!(!session.user_name.is_empty());
        assert!(!session.machine_name.is_empty());
        assert!(session.session_id.is_none());
        assert!(session.login_at_utc.is_none());
        assert!(session.locked.is_none());
    }
}
