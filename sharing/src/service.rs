use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use crate::{server, tunnel, ReportSource, ShareInput, SharedReport};
use serde::Serialize;
use tempodesk_core::{
    error::{AppError, Result},
    timeutil,
};
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareStatus {
    pub phase: String,
    pub message: String,
    pub url: Option<String>,
    pub expires_at_utc: Option<i64>,
    pub scope: Option<ShareInput>,
}
impl Default for ShareStatus {
    fn default() -> Self {
        Self {
            phase: "stopped".into(),
            message: "Sharing is off".into(),
            url: None,
            expires_at_utc: None,
            scope: None,
        }
    }
}

struct Session {
    source: server::SharedSource,
    closed: AtomicBool,
    cancel: tokio::sync::Notify,
    child: Mutex<Option<tokio::process::Child>>,
    http: Mutex<Option<tokio::task::AbortHandle>>,
}
impl Session {
    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        if let Ok(mut source) = self.source.lock() {
            source.revoke();
        }
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut child) = child.take() {
                let _ = child.start_kill();
            }
        }
        if let Ok(mut http) = self.http.lock() {
            if let Some(handle) = http.take() {
                handle.abort();
            }
        }
        self.cancel.notify_one();
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

#[derive(Default)]
struct Inner {
    generation: u64,
    status: ShareStatus,
    session: Option<Arc<Session>>,
}
#[derive(Clone, Default)]
pub struct SharingService {
    inner: Arc<Mutex<Inner>>,
}

impl SharingService {
    pub fn preview(path: &Path, input: ShareInput) -> Result<SharedReport> {
        let now = timeutil::now_ms();
        let (source, _) = ReportSource::open(path, input, now)?;
        source.preview(now)
    }

    pub fn status(&self) -> ShareStatus {
        self.inner
            .lock()
            .map(|inner| inner.status.clone())
            .unwrap_or_else(|_| ShareStatus {
                phase: "error".into(),
                message: "Sharing status unavailable".into(),
                ..Default::default()
            })
    }

    pub fn start(&self, path: &Path, tools: PathBuf, input: ShareInput) -> Result<ShareStatus> {
        if !input.consent {
            return Err(AppError::validation(
                "Review and accept link access before starting sharing",
            ));
        }
        // Reserve before opening the read connection so Stop also cancels a pending start.
        let generation = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| AppError::Internal("Sharing lock unavailable".into()))?;
            if inner.session.is_some() || inner.status.phase == "starting" {
                return Err(AppError::conflict(
                    "Stop the current share before creating another",
                ));
            }
            inner.generation += 1;
            inner.status = ShareStatus {
                phase: "starting".into(),
                message: "Validating the selected report…".into(),
                scope: Some(input.clone()),
                ..Default::default()
            };
            inner.generation
        };
        let (source, token) = match ReportSource::open(path, input, timeutil::now_ms()) {
            Ok(source) => source,
            Err(error) => {
                self.update(generation, "error", &error.to_string(), None);
                return Err(error);
            }
        };
        let status = ShareStatus {
            phase: "starting".into(),
            message: "Preparing the verified tunnel helper…".into(),
            url: None,
            expires_at_utc: Some(source.expires_at_utc()),
            scope: Some(source.policy().clone()),
        };
        let session = Arc::new(Session {
            source: Arc::new(Mutex::new(source)),
            closed: AtomicBool::new(false),
            cancel: tokio::sync::Notify::new(),
            child: Mutex::new(None),
            http: Mutex::new(None),
        });
        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| AppError::Internal("Sharing lock unavailable".into()))?;
            if inner.generation != generation {
                return Err(AppError::conflict("Sharing start was cancelled"));
            }
            inner.status = status.clone();
            inner.session = Some(session.clone());
        }
        let service = self.clone();
        tokio::spawn(async move {
            let duration =
                (status.expires_at_utc.unwrap_or_default() - timeutil::now_ms()).max(0) as u64;
            let result = tokio::select! {
                result = service.run(generation,session.clone(),token,tools) => result,
                _ = session.cancel.notified() => Ok(false),
                _ = tokio::time::sleep(Duration::from_millis(duration)) => Ok(true),
            };
            session.close();
            if let Ok(mut inner) = service.inner.lock() {
                if inner.generation == generation {
                    inner.session = None;
                    inner.status.url = None;
                    match result {
                        Ok(true) => {
                            inner.status.phase = "expired".into();
                            inner.status.message = "This sharing link has expired".into();
                        }
                        Ok(false) => {
                            inner.status.phase = "stopped".into();
                            inner.status.message = "Sharing stopped".into();
                        }
                        Err(error) => {
                            inner.status.phase = "error".into();
                            inner.status.message = error.to_string();
                        }
                    }
                }
            }
        });
        Ok(self.status())
    }

    /// Revocation and process termination are synchronous, including during application exit.
    pub fn stop(&self) -> ShareStatus {
        let session = self.inner.lock().ok().and_then(|mut inner| {
            inner.generation += 1;
            inner.status.phase = "stopped".into();
            inner.status.message = "Sharing stopped".into();
            inner.status.url = None;
            inner.session.take()
        });
        if let Some(session) = session {
            session.close();
        }
        self.status()
    }

    pub fn rotate(&self) -> Result<ShareStatus> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| AppError::Internal("Sharing lock unavailable".into()))?;
        if !matches!(inner.status.phase.as_str(), "active" | "reconnecting") {
            return Err(AppError::conflict(
                "Wait for the share to connect before replacing its link",
            ));
        }
        let session = inner
            .session
            .as_ref()
            .ok_or_else(|| AppError::conflict("Sharing has stopped"))?;
        let token = session
            .source
            .lock()
            .map_err(|_| AppError::Internal("Sharing source unavailable".into()))?
            .rotate()?;
        let old = inner
            .status
            .url
            .as_ref()
            .ok_or_else(|| AppError::conflict("Link is unavailable"))?;
        let origin = reqwest::Url::parse(old)
            .map_err(|_| AppError::Internal("Invalid sharing origin".into()))?
            .origin()
            .ascii_serialization();
        let view = &inner
            .status
            .scope
            .as_ref()
            .ok_or_else(|| AppError::conflict("Sharing scope unavailable"))?
            .initial_view;
        inner.status.url = Some(format!("{origin}/s/{token}/#{view}"));
        Ok(inner.status.clone())
    }

    fn update(&self, generation: u64, phase: &str, message: &str, url: Option<String>) {
        if let Ok(mut inner) = self.inner.lock() {
            if inner.generation == generation {
                inner.status.phase = phase.into();
                inner.status.message = message.into();
                if url.is_some() {
                    inner.status.url = url;
                }
            }
        }
    }

    async fn run(
        &self,
        generation: u64,
        session: Arc<Session>,
        token: String,
        tools: PathBuf,
    ) -> Result<bool> {
        if session.closed.load(Ordering::SeqCst) {
            return Ok(false);
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let origin = format!("http://{}", listener.local_addr()?);
        let router = server::router(session.source.clone());
        let http = tokio::spawn(async move { axum::serve(listener, router).await });
        {
            let mut slot = session
                .http
                .lock()
                .map_err(|_| AppError::Internal("Sharing server unavailable".into()))?;
            if session.closed.load(Ordering::SeqCst) {
                http.abort();
                return Ok(false);
            }
            *slot = Some(http.abort_handle());
        }
        let client = reqwest::Client::builder()
            .https_only(true)
            .user_agent("TempoDesk/0.4 live-sharing")
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| AppError::Internal("Cannot initialize HTTPS sharing".into()))?;
        let binary = tunnel::binary(&tools, &client).await?;
        self.update(
            generation,
            "starting",
            "Connecting the temporary tunnel…",
            None,
        );
        let mut command = tokio::process::Command::new(binary);
        command
            .args([
                "tunnel",
                "--url",
                &origin,
                "--no-autoupdate",
                "--protocol",
                "http2",
                "--metrics",
                "127.0.0.1:0",
            ])
            .current_dir(&tools)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let (mut stdout, mut stderr) = {
            let mut slot = session
                .child
                .lock()
                .map_err(|_| AppError::Internal("Sharing helper unavailable".into()))?;
            if session.closed.load(Ordering::SeqCst) {
                return Ok(false);
            }
            let mut child = command.spawn().map_err(|_| {
                AppError::Internal("Cannot start the verified tunnel helper".into())
            })?;
            let streams = (
                child.stdout.take().map(BufReader::new).map(|s| s.lines()),
                child.stderr.take().map(BufReader::new).map(|s| s.lines()),
            );
            *slot = Some(child);
            streams
        };
        let (send, mut receive) = tokio::sync::mpsc::channel(2);
        let out = send.clone();
        tokio::spawn(async move {
            if let Some(ref mut lines) = stdout {
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Some(host) = tunnel::hostname(&line) {
                        let _ = out.try_send(host);
                    }
                }
            }
        });
        tokio::spawn(async move {
            if let Some(ref mut lines) = stderr {
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Some(host) = tunnel::hostname(&line) {
                        let _ = send.try_send(host);
                    }
                }
            }
        });
        let public = tokio::time::timeout(Duration::from_secs(60), receive.recv())
            .await
            .ok()
            .flatten()
            .ok_or_else(|| {
                AppError::Internal(
                    "The tunnel did not provide a link. Check your connection and retry".into(),
                )
            })?;
        let view = session
            .source
            .lock()
            .map_err(|_| AppError::Internal("Sharing source unavailable".into()))?
            .policy()
            .initial_view
            .clone();
        let url = format!("{public}/s/{token}/#{view}");
        let health = format!("{public}/s/{token}/status");
        self.update(
            generation,
            "starting",
            "Waiting for the temporary address to become reachable…",
            None,
        );
        let mut reachable = false;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
        while tokio::time::Instant::now() < deadline {
            if client
                .get(&health)
                .send()
                .await
                .is_ok_and(|reply| reply.status().is_success())
            {
                reachable = true;
                break;
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        if !reachable {
            return Err(AppError::Internal("The temporary link could not be reached. Check your Internet connection and create a new link".into()));
        }
        self.update(generation, "active", "Sharing is live", Some(url));
        let mut next_probe = tokio::time::Instant::now() + Duration::from_secs(15);
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let expired = session
                .source
                .lock()
                .map(|source| timeutil::now_ms() >= source.expires_at_utc())
                .unwrap_or(true);
            if expired {
                return Ok(true);
            }
            if http.is_finished() {
                return Err(AppError::Internal(
                    "The report server stopped. Create a new sharing link".into(),
                ));
            }
            let exited = session
                .child
                .lock()
                .map(|mut child| {
                    child
                        .as_mut()
                        .map(|c| c.try_wait().ok().flatten().is_some())
                        .unwrap_or(true)
                })
                .unwrap_or(true);
            if exited {
                return Err(AppError::Internal(
                    "The sharing tunnel stopped. Create a new link to reconnect".into(),
                ));
            }
            if tokio::time::Instant::now() >= next_probe {
                let current = self.status().url;
                if let Some(current) = current {
                    let health =
                        current.split('#').next().unwrap_or(&current).to_string() + "status";
                    let reachable = client
                        .get(&health)
                        .send()
                        .await
                        .is_ok_and(|r| r.status().is_success());
                    self.update(
                        generation,
                        if reachable { "active" } else { "reconnecting" },
                        if reachable {
                            "Sharing is live"
                        } else {
                            "Connection interrupted; reconnecting automatically…"
                        },
                        None,
                    );
                }
                next_probe = tokio::time::Instant::now() + Duration::from_secs(15);
            }
        }
    }
}
