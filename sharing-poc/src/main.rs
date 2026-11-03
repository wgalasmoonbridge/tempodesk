use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tempodesk_core::timeutil;
use tempodesk_sharing_poc::{server, Demo, SharedFields};

#[derive(Deserialize)]
struct Command {
    id: u64,
    action: String,
}

fn emit(value: serde_json::Value) {
    println!("{value}");
    let _ = std::io::stdout().flush();
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut ttl = 3600u64;
    let mut fields = SharedFields::default();
    let mut args = std::env::args().skip(1);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--ttl-seconds" => ttl = args.next().ok_or("Missing duration")?.parse()?,
            "--include-descriptions" => fields.descriptions = true,
            "--include-billable" => fields.billable = true,
            _ => return Err(format!("Unknown option: {argument}").into()),
        }
    }
    let (demo, token) = Demo::new(timeutil::now_ms(), ttl, fields)?;
    let expires = demo.grant.expires_at_utc;
    let state = Arc::new(Mutex::new(demo));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let shutdown = Arc::new(tokio::sync::Notify::new());
    let controls = state.clone();
    let stop = shutdown.clone();
    let control_origin = origin.clone();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else {
                break;
            };
            if line.len() > 1024 {
                continue;
            }
            let Ok(command) = serde_json::from_str::<Command>(&line) else {
                continue;
            };
            let Ok(mut demo) = controls.lock() else {
                break;
            };
            let mut response = json!({"event":"control", "id":command.id, "ok":true});
            match command.action.as_str() {
                "pause" => demo.paused = true,
                "resume" => demo.paused = false,
                "revoke" => demo.grant.revoke(),
                "expire" => demo.grant.expires_at_utc = timeutil::now_ms() - 1,
                "rotate" => match demo.grant.rotate() {
                    Ok(token) => response["url"] = json!(format!("{control_origin}/s/{token}/")),
                    Err(_) => response["ok"] = json!(false),
                },
                "new-link" => match demo.fresh_link(expires) {
                    Ok(token) => response["url"] = json!(format!("{control_origin}/s/{token}/")),
                    Err(_) => response["ok"] = json!(false),
                },
                "add" => {
                    if demo.add_demo_minute(timeutil::now_ms()).is_err() {
                        response["ok"] = json!(false);
                    }
                }
                "status" => match demo.ledger_fingerprint() {
                    Ok(fingerprint) => response["fingerprint"] = json!(fingerprint),
                    Err(_) => response["ok"] = json!(false),
                },
                "quit" => {
                    stop.notify_one();
                    emit(response);
                    break;
                }
                _ => response["ok"] = json!(false),
            }
            emit(response);
        }
    });
    emit(
        json!({"event":"ready", "origin":origin, "url":format!("{origin}/s/{token}/"), "expiresAtUtc":expires, "demo":true}),
    );
    axum::serve(listener, server::router(state))
        .with_graceful_shutdown(async move {
            tokio::select! {
                _ = shutdown.notified() => {},
                _ = tokio::time::sleep(Duration::from_secs(ttl + 30)) => {},
            }
        })
        .await?;
    Ok(())
}
