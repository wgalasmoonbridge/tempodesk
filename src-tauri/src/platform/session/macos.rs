use std::collections::VecDeque;
use std::ffi::{c_void, CStr};
use std::ptr::NonNull;
use std::sync::{Arc, Mutex};

use block2::RcBlock;
use core_foundation_sys::base::{CFGetTypeID, CFRelease, CFTypeRef};
use core_foundation_sys::dictionary::{CFDictionaryGetValue, CFDictionaryRef};
use core_foundation_sys::number::{
    kCFNumberSInt64Type, CFBooleanGetTypeID, CFBooleanGetValue, CFNumberGetTypeID, CFNumberGetValue,
};
use core_foundation_sys::string::{kCFStringEncodingUTF8, CFStringCreateWithCString};
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceSessionDidBecomeActiveNotification,
    NSWorkspaceSessionDidResignActiveNotification,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};

use super::{capability, unix, NativeEvent, Observation};
use crate::domain::timeutil;

const SOURCE: &str = "macos-workspace";

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
}

pub struct Monitor {
    center: Retained<NSNotificationCenter>,
    observers: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
    events: Arc<Mutex<VecDeque<NativeEvent>>>,
    allowed: bool,
}

impl Monitor {
    pub fn new() -> Result<Self, String> {
        autoreleasepool(|_| {
            let center = NSWorkspace::sharedWorkspace().notificationCenter();
            let events = Arc::new(Mutex::new(VecDeque::new()));
            let mut observers = Vec::new();
            for (name, kind) in unsafe {
                [
                    (
                        NSWorkspaceSessionDidBecomeActiveNotification,
                        "session_active",
                    ),
                    (
                        NSWorkspaceSessionDidResignActiveNotification,
                        "session_inactive",
                    ),
                ]
            } {
                let events = events.clone();
                // NSWorkspace posts notifications for this application's own login session.
                // No distributed/private screen-lock notification names are used.
                let block = RcBlock::new(move |_: NonNull<NSNotification>| {
                    if let Ok(mut events) = events.lock() {
                        if events.len() < 256 {
                            events.push_back(NativeEvent {
                                kind,
                                at: timeutil::now_ms(),
                                source: SOURCE,
                            });
                        }
                    }
                });
                observers.push(unsafe {
                    center.addObserverForName_object_queue_usingBlock(
                        Some(name),
                        None,
                        None,
                        &block,
                    )
                });
            }
            Ok(Self {
                center,
                observers,
                events,
                allowed: false,
            })
        })
    }

    pub fn observe(&mut self) -> Result<Observation, String> {
        let mut session = unix::account()?;
        // CGSession describes the calling process's graphical session. Check its UID before
        // attaching console login information, so sudo/SSH cannot pick another user's login.
        let active = unsafe { own_graphical_session() };
        self.allowed = active.is_some();
        if let Some(active) = active {
            session.active = Some(active);
            session.login_at_utc =
                console_login(&session.user_name).filter(|time| *time <= timeutil::now_ms());
            session.session_id = session
                .login_at_utc
                .map(|time| format!("console:{}:{time}", session.account_id));
        }
        let has_login = session.login_at_utc.is_some();
        Ok(Observation { session, source: SOURCE, sample_locks: false, sample_active: false,
            capabilities: vec![
                capability("identity", "available", "Account and machine identity are read from native OS APIs."),
                capability("login_time", if has_login { "available" } else { "unavailable" },
                    if has_login { "OS console-login record for this account; not application startup." } else { "No matching console-login record is available. Login time remains unknown." }),
                capability("lock", "unsupported", "macOS has no supported public screen-lock notification here. Session switching and display sleep are not labelled as lock/unlock."),
                capability("session", if active.is_some() { "available" } else { "unavailable" }, "NSWorkspace session activation/deactivation notifications. These are not login/logout or screen-lock events."),
            ],
        })
    }

    pub fn drain(&mut self) -> Vec<NativeEvent> {
        self.events
            .lock()
            .map(|mut events| {
                let events: Vec<_> = events.drain(..).collect();
                if self.allowed {
                    events
                } else {
                    Vec::new()
                }
            })
            .unwrap_or_default()
    }
}

impl Drop for Monitor {
    fn drop(&mut self) {
        autoreleasepool(|_| {
            for observer in &self.observers {
                unsafe {
                    self.center.removeObserver((**observer).as_ref());
                }
            }
        });
    }
}

unsafe fn value(dictionary: CFDictionaryRef, key: &CStr) -> CFTypeRef {
    let key =
        unsafe { CFStringCreateWithCString(std::ptr::null(), key.as_ptr(), kCFStringEncodingUTF8) };
    if key.is_null() {
        return std::ptr::null();
    }
    let value = unsafe { CFDictionaryGetValue(dictionary, key.cast()) };
    unsafe {
        CFRelease(key.cast());
    }
    value
}

unsafe fn own_graphical_session() -> Option<bool> {
    let dictionary = unsafe { CGSessionCopyCurrentDictionary() };
    if dictionary.is_null() {
        return None;
    }
    let result = (|| unsafe {
        let uid_value = value(dictionary, c"kCGSessionUserIDKey");
        let active_value = value(dictionary, c"kCGSessionOnConsoleKey");
        if uid_value.is_null()
            || active_value.is_null()
            || CFGetTypeID(uid_value) != CFNumberGetTypeID()
            || CFGetTypeID(active_value) != CFBooleanGetTypeID()
        {
            return None;
        }
        let mut uid: i64 = -1;
        if !CFNumberGetValue(
            uid_value.cast(),
            kCFNumberSInt64Type,
            (&mut uid as *mut i64).cast::<c_void>(),
        ) || uid != i64::from(libc::geteuid())
        {
            return None;
        }
        Some(CFBooleanGetValue(active_value.cast()))
    })();
    unsafe {
        CFRelease(dictionary.cast());
    }
    result
}

fn console_login(user_name: &str) -> Option<i64> {
    // utmpx iteration uses process-global state; serialize it within this integration. Only
    // the matching account's console record is inspected; no other users are persisted.
    static UTMP: Mutex<()> = Mutex::new(());
    let _guard = UTMP.lock().ok()?;
    unsafe {
        libc::setutxent();
        let mut login = None;
        loop {
            let entry = libc::getutxent();
            if entry.is_null() {
                break;
            }
            let entry = &*entry;
            let text = |bytes: &[libc::c_char]| {
                let bytes: Vec<u8> = bytes
                    .iter()
                    .take_while(|value| **value != 0)
                    .map(|value| *value as u8)
                    .collect();
                String::from_utf8_lossy(&bytes).into_owned()
            };
            if entry.ut_type == libc::USER_PROCESS
                && text(&entry.ut_user) == user_name
                && text(&entry.ut_line) == "console"
            {
                let timestamp = entry.ut_tv.tv_sec as i64;
                if timestamp > 0 {
                    login = timestamp.checked_mul(1000);
                }
                break;
            }
        }
        libc::endutxent();
        login
    }
}
