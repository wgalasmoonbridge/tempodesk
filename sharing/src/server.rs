use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Path, RawQuery, State};
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use tempodesk_core::timeutil;

use crate::{AccessError, ReportSource};

pub type SharedSource = Arc<Mutex<ReportSource>>;

#[derive(Serialize)]
struct Problem {
    code: &'static str,
    message: &'static str,
}

fn problem(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    (status, Json(Problem { code, message })).into_response()
}

fn access(demo: &ReportSource, token: &str) -> Option<Response> {
    match demo.authorize(token, timeutil::now_ms()) {
        Ok(()) => None,
        Err(AccessError::Unknown) => Some(problem(
            StatusCode::NOT_FOUND,
            "not_found",
            "Share link not found.",
        )),
        Err(AccessError::Expired) => Some(problem(
            StatusCode::GONE,
            "expired",
            "This share link has expired.",
        )),
        Err(AccessError::Revoked) => Some(problem(
            StatusCode::GONE,
            "revoked",
            "The owner stopped sharing this report.",
        )),
    }
}

async fn viewer(
    State(state): State<SharedSource>,
    Path(token): Path<String>,
    RawQuery(query): RawQuery,
) -> Response {
    if query.is_some() {
        return fixed_scope();
    }
    let Ok(demo) = state.lock() else {
        return unavailable();
    };
    if let Some(response) = access(&demo, &token) {
        return response;
    }
    Html(include_str!("../web/index.html")).into_response()
}

async fn data(
    State(state): State<SharedSource>,
    Path(token): Path<String>,
    RawQuery(query): RawQuery,
) -> Response {
    if query.is_some() {
        return fixed_scope();
    }
    // Keep both authorization and projection inside one lock so revocation cannot race a new read.
    match tokio::task::spawn_blocking(move || {
        let Ok(mut demo) = state.lock() else {
            return unavailable();
        };
        if let Some(response) = access(&demo, &token) {
            return response;
        }
        match demo.report(timeutil::now_ms()) {
            Ok(report) => Json(report).into_response(),
            Err(_) => unavailable(), // Never return internal SQL, metadata, or paths.
        }
    })
    .await
    {
        Ok(response) => response,
        Err(_) => unavailable(),
    }
}

async fn health(
    State(state): State<SharedSource>,
    Path(token): Path<String>,
    RawQuery(query): RawQuery,
) -> Response {
    if query.is_some() {
        return fixed_scope();
    }
    let Ok(source) = state.lock() else {
        return unavailable();
    };
    if let Some(response) = access(&source, &token) {
        return response;
    }
    Json(serde_json::json!({"online":true})).into_response()
}

fn fixed_scope() -> Response {
    problem(
        StatusCode::BAD_REQUEST,
        "fixed_scope",
        "Report filters are fixed by the owner of this link.",
    )
}

fn unavailable() -> Response {
    problem(
        StatusCode::SERVICE_UNAVAILABLE,
        "unavailable",
        "Report temporarily unavailable. Please retry.",
    )
}

struct Limits {
    concurrent: Arc<tokio::sync::Semaphore>,
    window: Mutex<(Instant, u32)>,
}

async fn harden(
    State(limits): State<Arc<Limits>>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let permit = limits.concurrent.clone().try_acquire_owned();
    let allowed = limits
        .window
        .lock()
        .map(|mut window| {
            if window.0.elapsed() >= Duration::from_secs(1) {
                *window = (Instant::now(), 0);
            }
            window.1 += 1;
            window.1 <= 120
        })
        .unwrap_or(false);
    let mut response = if permit.is_err() || !allowed {
        problem(
            StatusCode::TOO_MANY_REQUESTS,
            "busy",
            "Please retry shortly.",
        )
    } else if request.method() != Method::GET && request.method() != Method::HEAD {
        let mut response = problem(
            StatusCode::METHOD_NOT_ALLOWED,
            "read_only",
            "Shared reports are read-only.",
        );
        response
            .headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
        response
    } else if request.uri().path().len() > 256 {
        problem(StatusCode::NOT_FOUND, "not_found", "Share link not found.")
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, private, max-age=0"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    ));
    headers.insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow, noarchive"),
    );
    response
}

pub fn router(state: SharedSource) -> Router {
    Router::new()
        .route(
            "/",
            get(|| async {
                (
                    StatusCode::NOT_FOUND,
                    "Open the complete report link supplied by its owner.",
                )
            }),
        )
        .route("/s/{token}/", get(viewer))
        .route("/s/{token}/data.json", get(data))
        .route("/s/{token}/status", get(health))
        .route(
            "/assets/viewer.js",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
                    include_str!("../web/viewer.js"),
                )
            }),
        )
        .route(
            "/assets/viewer.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    include_str!("../web/viewer.css"),
                )
            }),
        )
        .fallback(|| async { problem(StatusCode::NOT_FOUND, "not_found", "Share link not found.") })
        .layer(middleware::from_fn_with_state(
            Arc::new(Limits {
                concurrent: Arc::new(tokio::sync::Semaphore::new(8)),
                window: Mutex::new((Instant::now(), 0)),
            }),
            harden,
        ))
        .with_state(state)
}
