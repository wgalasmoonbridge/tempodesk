use std::time::{Duration, Instant};

use serde_json::json;

use crate::domain::summary;
use crate::error::{AppError, Result};
use crate::models::{AiTestResult, SummaryResult};

const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";

fn validate_model(model: &str) -> Result<()> {
    let model = model.trim();
    if model.is_empty()
        || model.chars().count() > 80
        || !model
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(AppError::validation("The AI model name is invalid"));
    }
    Ok(())
}

fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .user_agent(format!("TempoDesk/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| AppError::Internal(format!("Could not initialize the AI client: {err}")))
}

async fn call_gemini(model: &str, api_key: &str, prompt: &str, max_tokens: u32) -> Result<String> {
    validate_model(model)?;
    let url = format!("{GEMINI_BASE}/{model}:generateContent");
    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_tokens
        }
    });

    // The API key is sent in a header (never the URL) and is never logged by this module.
    let response = client()?
        .post(url)
        .header("x-goog-api-key", api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|err| {
            if err.is_timeout() {
                AppError::Unsupported(
                    "Gemini did not respond in time. Check your connection and try again.".into(),
                )
            } else {
                AppError::Unsupported(format!(
                    "Could not reach Gemini. Check your connection and API key: {err}"
                ))
            }
        })?;

    let status = response.status();
    let payload: serde_json::Value = response.json().await.map_err(|_| {
        AppError::Unsupported(format!(
            "Gemini returned an unreadable response ({}). Try again or use the local summary.",
            status.as_u16()
        ))
    })?;

    if !status.is_success() {
        let message = payload
            .pointer("/error/message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("provider error");
        return Err(AppError::Unsupported(format!(
            "Gemini request failed ({}): {message}",
            status.as_u16()
        )));
    }
    summary::extract_gemini_text(&payload)
}

pub async fn generate(
    model: &str,
    api_key: &str,
    prompt: &str,
    report_total_seconds: i64,
    range_label: String,
) -> Result<SummaryResult> {
    let text = call_gemini(model, api_key, prompt, 700).await?;
    Ok(SummaryResult {
        text,
        mode: "ai".into(),
        provider: Some("gemini".into()),
        model: Some(model.to_string()),
        generated_at_utc: crate::timeutil::now_ms(),
        range_label,
        total_seconds: report_total_seconds,
        warning: None,
    })
}

pub async fn test_connection(model: &str, api_key: &str) -> Result<AiTestResult> {
    let started = Instant::now();
    let text = call_gemini(model, api_key, "Reply with the single word OK.", 8).await?;
    Ok(AiTestResult {
        ok: true,
        message: if text.trim().is_empty() {
            "Connected to Gemini.".into()
        } else {
            format!(
                "Connected to Gemini. Reply: {}",
                text.trim().chars().take(80).collect::<String>()
            )
        },
        model: model.to_string(),
        latency_ms: started.elapsed().as_millis() as u64,
    })
}
