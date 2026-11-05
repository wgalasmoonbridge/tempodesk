use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use ::windows::core::{w, PCWSTR, PWSTR};
use ::windows::Win32::Foundation::{
    CloseHandle, LocalFree, HANDLE, HINSTANCE, HLOCAL, HWND, LPARAM, LRESULT, WPARAM,
};
use ::windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use ::windows::Win32::Security::{
    GetTokenInformation, LookupAccountSidW, TokenUser, SID_NAME_USE, TOKEN_QUERY, TOKEN_USER,
};
use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
use ::windows::Win32::System::RemoteDesktop::*;
use ::windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, OpenProcessToken,
};
use ::windows::Win32::System::WindowsProgramming::GetComputerNameW;
use ::windows::Win32::UI::WindowsAndMessaging::*;

use super::{capability, NativeEvent, Observation};
use crate::domain::timeutil;
use crate::models::MachineSession;

const SOURCE: &str = "windows-wts";
const FILETIME_UNIX_EPOCH: i64 = 116_444_736_000_000_000;

struct Context {
    session_id: u32,
    allowed: bool,
    events: Mutex<VecDeque<NativeEvent>>,
}

pub struct Monitor {
    context: Box<Context>,
    window: Option<HWND>,
    listener_error: Option<String>,
}

impl Monitor {
    pub fn new() -> Result<Self, String> {
        let mut session_id = 0;
        unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut session_id) }
            .map_err(|_| "Windows could not identify this process's session.".to_string())?;
        let mut monitor = Self {
            context: Box::new(Context {
                session_id,
                allowed: false,
                events: Mutex::new(VecDeque::new()),
            }),
            window: None,
            listener_error: None,
        };
        // A hidden native window, not the WebView, receives notifications even in tray mode.
        if monitor.listen().is_err() {
            monitor.listener_error = Some("Native session notifications are unavailable; state changes are sampled every 5 seconds and brief changes may be missed.".into());
        }
        Ok(monitor)
    }

    fn listen(&mut self) -> Result<(), String> {
        static REGISTERED: OnceLock<bool> = OnceLock::new();
        unsafe {
            let instance = HINSTANCE(GetModuleHandleW(None).map_err(|error| error.to_string())?.0);
            let registered = REGISTERED.get_or_init(|| {
                RegisterClassW(&WNDCLASSW {
                    lpfnWndProc: Some(window_proc),
                    hInstance: instance,
                    lpszClassName: w!("TempoDeskSessionMonitor"),
                    ..Default::default()
                }) != 0
            });
            if !registered {
                return Err("Could not register the session notification window.".into());
            }
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("TempoDeskSessionMonitor"),
                w!(""),
                WINDOW_STYLE::default(),
                0,
                0,
                0,
                0,
                None,
                None,
                Some(instance),
                None,
            )
            .map_err(|error| error.to_string())?;
            SetWindowLongPtrW(
                hwnd,
                GWLP_USERDATA,
                (&mut *self.context as *mut Context) as isize,
            );
            if let Err(error) = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) {
                let _ = DestroyWindow(hwnd);
                return Err(error.to_string());
            }
            self.window = Some(hwnd);
        }
        Ok(())
    }

    pub fn observe(&mut self) -> Result<Observation, String> {
        let (account_id, user_name, domain) = token_identity()?;
        let machine_name = computer_name()?;
        let id = self.context.session_id;
        // Run-as must not associate another account's desktop login with this process's token.
        let belongs = query_text(id, WTSUserName)
            .is_some_and(|name| name.eq_ignore_ascii_case(&user_name))
            && query_text(id, WTSDomainName).is_some_and(|name| name.eq_ignore_ascii_case(&domain));
        self.context.allowed = belongs;
        let info = if belongs { query_info(id) } else { None };
        let now = timeutil::now_ms();
        let login = info
            .as_ref()
            .and_then(|value| filetime_ms(value.LogonTime))
            .filter(|value| *value <= now);
        let locked = info
            .as_ref()
            .and_then(|value| match value.SessionFlags as u32 {
                WTS_SESSIONSTATE_LOCK => Some(true),
                WTS_SESSIONSTATE_UNLOCK => Some(false),
                _ => None,
            });
        let active = info.as_ref().and_then(|value| {
            if value.SessionState == WTSActive {
                Some(true)
            } else if value.SessionState == WTSDisconnected {
                Some(false)
            } else {
                None
            }
        });
        let native = self.window.is_some() && belongs;
        let lock_available = native || locked.is_some();
        let session_available = native || active.is_some();
        let detail = self.listener_error.clone().unwrap_or_else(||
            "Native notifications for this account's own Windows session only. Logoff is best-effort during shutdown.".into());
        Ok(Observation {
            session: MachineSession {
                account_id,
                user_name,
                domain: Some(domain),
                machine_name,
                session_id: belongs.then(|| id.to_string()),
                login_at_utc: login,
                locked,
                active,
            },
            source: SOURCE,
            sample_locks: !native,
            sample_active: !native,
            capabilities: vec![
                capability(
                    "identity",
                    "available",
                    "Identity comes from the process security token, not environment variables.",
                ),
                capability(
                    "login_time",
                    if login.is_some() {
                        "available"
                    } else {
                        "unavailable"
                    },
                    if login.is_some() {
                        "Windows-reported logon time for this session."
                    } else {
                        "Windows did not report a matching account/session login time; app startup is not substituted."
                    },
                ),
                capability(
                    "lock",
                    if lock_available {
                        "available"
                    } else {
                        "unavailable"
                    },
                    detail.clone(),
                ),
                capability(
                    "session",
                    if session_available {
                        "available"
                    } else {
                        "unavailable"
                    },
                    detail,
                ),
            ],
        })
    }

    pub fn drain(&mut self) -> Vec<NativeEvent> {
        unsafe {
            let mut message = MSG::default();
            while PeekMessageW(&mut message, self.window, 0, 0, PM_REMOVE).as_bool() {
                let _ = DispatchMessageW(&message);
            }
        }
        self.context
            .events
            .lock()
            .map(|mut events| events.drain(..).collect())
            .unwrap_or_default()
    }
}

impl Drop for Monitor {
    fn drop(&mut self) {
        if let Some(window) = self.window.take() {
            unsafe {
                let _ = WTSUnRegisterSessionNotification(window);
                SetWindowLongPtrW(window, GWLP_USERDATA, 0);
                let _ = DestroyWindow(window);
            }
        }
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_WTSSESSION_CHANGE {
        // This pointer belongs to the same worker thread; it is cleared before window teardown.
        let context = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Context };
        if let Some(context) = unsafe { context.as_ref() } {
            if context.allowed && lparam.0 == context.session_id as isize {
                let kind = match wparam.0 as u32 {
                    WTS_SESSION_LOCK => Some("lock"),
                    WTS_SESSION_UNLOCK => Some("unlock"),
                    WTS_CONSOLE_CONNECT | WTS_REMOTE_CONNECT => Some("session_active"),
                    WTS_CONSOLE_DISCONNECT | WTS_REMOTE_DISCONNECT => Some("session_inactive"),
                    WTS_SESSION_LOGOFF => Some("logoff"),
                    _ => None,
                };
                if let Some(kind) = kind {
                    if let Ok(mut events) = context.events.lock() {
                        if events.len() < 256 {
                            events.push_back(NativeEvent {
                                kind,
                                at: timeutil::now_ms(),
                                source: SOURCE,
                            });
                        }
                    }
                }
            }
        }
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

fn filetime_ms(raw: i64) -> Option<i64> {
    raw.checked_sub(FILETIME_UNIX_EPOCH)
        .filter(|value| *value >= 0)
        .map(|value| (value / 10_000) / 1000 * 1000)
}

fn query_text(session_id: u32, class: WTS_INFO_CLASS) -> Option<String> {
    unsafe {
        let mut buffer = PWSTR::null();
        let mut bytes = 0;
        if WTSQuerySessionInformationW(None, session_id, class, &mut buffer, &mut bytes).is_err() {
            return None;
        }
        let value = if !buffer.is_null() && bytes >= 2 {
            let units = std::slice::from_raw_parts(buffer.0, bytes as usize / 2);
            Some(String::from_utf16_lossy(
                units.split(|unit| *unit == 0).next().unwrap_or_default(),
            ))
        } else {
            None
        };
        WTSFreeMemory(buffer.0.cast());
        value
    }
}

fn query_info(session_id: u32) -> Option<WTSINFOEX_LEVEL1_W> {
    unsafe {
        let mut buffer = PWSTR::null();
        let mut bytes = 0;
        if WTSQuerySessionInformationW(None, session_id, WTSSessionInfoEx, &mut buffer, &mut bytes)
            .is_err()
        {
            return None;
        }
        let result = if !buffer.is_null() && bytes as usize >= std::mem::size_of::<WTSINFOEXW>() {
            let info = &*buffer.0.cast::<WTSINFOEXW>();
            if info.Level == 1 {
                Some(info.Data.WTSInfoExLevel1)
            } else {
                None
            }
        } else {
            None
        };
        WTSFreeMemory(buffer.0.cast());
        result
    }
}

fn token_identity() -> Result<(String, String, String), String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|_| "Windows account identity is unavailable.".to_string())?;
        // u64 provides alignment for TOKEN_USER and its variable-length SID.
        let mut buffer = [0u64; 128];
        let mut length = 0;
        let result = GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            std::mem::size_of_val(&buffer) as u32,
            &mut length,
        );
        let _ = CloseHandle(token);
        result.map_err(|_| "Windows account identity is unavailable.".to_string())?;
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        let mut sid = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid)
            .map_err(|_| "Windows account identifier is unavailable.".to_string())?;
        let account_id = sid.to_string().unwrap_or_default();
        let _ = LocalFree(Some(HLOCAL(sid.0.cast())));
        let mut name = [0u16; 512];
        let mut name_len = name.len() as u32;
        let mut domain = [0u16; 512];
        let mut domain_len = domain.len() as u32;
        let mut usage = SID_NAME_USE::default();
        LookupAccountSidW(
            PCWSTR::null(),
            user.User.Sid,
            Some(PWSTR(name.as_mut_ptr())),
            &mut name_len,
            Some(PWSTR(domain.as_mut_ptr())),
            &mut domain_len,
            &mut usage,
        )
        .map_err(|_| "Windows could not resolve this account's name.".to_string())?;
        Ok((
            account_id,
            String::from_utf16_lossy(&name[..name_len as usize]),
            String::from_utf16_lossy(&domain[..domain_len as usize]),
        ))
    }
}

fn computer_name() -> Result<String, String> {
    let mut name = [0u16; 256];
    let mut length = name.len() as u32;
    unsafe { GetComputerNameW(Some(PWSTR(name.as_mut_ptr())), &mut length) }
        .map_err(|_| "Windows machine name is unavailable.".to_string())?;
    Ok(String::from_utf16_lossy(&name[..length as usize]))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_identity_query_and_notification_filter_work_without_elevation() {
        let mut monitor = Monitor::new().unwrap();
        let observation = monitor.observe().unwrap();
        assert!(!observation.session.user_name.is_empty());
        assert!(!observation.session.machine_name.is_empty());
        assert!(observation.session.account_id.starts_with("S-1-"));
        // Simulated notifications exercise filtering without locking the user's workstation.
        if let Some(window) = monitor.window {
            monitor.context.allowed = true;
            unsafe {
                SendMessageW(
                    window,
                    WM_WTSSESSION_CHANGE,
                    Some(WPARAM(WTS_SESSION_LOCK as usize)),
                    Some(LPARAM(monitor.context.session_id as isize + 1)),
                );
                SendMessageW(
                    window,
                    WM_WTSSESSION_CHANGE,
                    Some(WPARAM(WTS_SESSION_LOCK as usize)),
                    Some(LPARAM(monitor.context.session_id as isize)),
                );
                SendMessageW(
                    window,
                    WM_WTSSESSION_CHANGE,
                    Some(WPARAM(WTS_SESSION_UNLOCK as usize)),
                    Some(LPARAM(monitor.context.session_id as isize)),
                );
            }
            let events = monitor.drain();
            assert_eq!(events.len(), 2);
            assert_eq!(events[0].kind, "lock");
            assert_eq!(events[1].kind, "unlock");
        }
    }

    #[test]
    fn filetime_conversion_is_second_aligned_and_rejects_invalid_times() {
        assert_eq!(filetime_ms(FILETIME_UNIX_EPOCH + 12_345_678), Some(1000));
        assert_eq!(filetime_ms(0), None);
        assert_eq!(filetime_ms(i64::MIN), None);
    }
}
