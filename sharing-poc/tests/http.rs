use std::sync::{Arc, Mutex};

use reqwest::{Client, StatusCode};
use serde_json::Value;
use tempodesk_core::timeutil;
use tempodesk_sharing_poc::{server, Demo, SharedFields, PRIVATE_CANARY};

async fn serve() -> (
    server::SharedDemo,
    String,
    String,
    tokio::task::JoinHandle<()>,
) {
    let (demo, token) = Demo::new(timeutil::now_ms(), 60, SharedFields::default()).unwrap();
    let state = Arc::new(Mutex::new(demo));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let router = server::router(state.clone());
    let handle = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (state, origin, token, handle)
}

#[tokio::test]
async fn public_surface_is_scoped_read_only_and_does_not_change_records() {
    let (state, origin, token, task) = serve().await;
    let fingerprint = state.lock().unwrap().ledger_fingerprint().unwrap();
    let client = Client::new();
    let data_url = format!("{origin}/s/{token}/data.json");
    let response = client.get(&data_url).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()["cache-control"]
        .to_str()
        .unwrap()
        .contains("no-store"));
    assert_eq!(response.headers()["referrer-policy"], "no-referrer");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert!(response.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("frame-ancestors 'none'"));
    assert!(response
        .headers()
        .get("access-control-allow-origin")
        .is_none());
    let body = response.text().await.unwrap();
    assert!(!body.contains(PRIVATE_CANARY));
    let report: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(report["demo"], true);
    assert_eq!(report["entryCount"], 4);
    assert!(report["totalSeconds"].as_i64().unwrap() >= 8280);
    assert!(report.get("billableSeconds").is_none());
    for entry in report["entries"].as_array().unwrap() {
        for field in [
            "id",
            "projectId",
            "clientId",
            "clientName",
            "description",
            "billable",
            "source",
            "createdAtUtc",
        ] {
            assert!(entry.get(field).is_none(), "private field: {field}");
        }
    }
    for path in [
        "/",
        "/tempodesk.db",
        "/backups",
        "/get_report",
        "/invoke",
        "/s/invalid/data.json",
    ] {
        assert_eq!(
            client
                .get(format!("{origin}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    for query in [
        "projectId=other",
        "clientId=other",
        "dateFrom=2000-01-01",
        "includeDescriptions=true",
        "token=other",
    ] {
        let response = client
            .get(format!("{data_url}?{query}"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(!response.text().await.unwrap().contains(PRIVATE_CANARY));
    }
    for method in [
        reqwest::Method::POST,
        reqwest::Method::PUT,
        reqwest::Method::PATCH,
        reqwest::Method::DELETE,
    ] {
        assert_eq!(
            client
                .request(method, &data_url)
                .body("change records")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }
    assert_eq!(
        state.lock().unwrap().ledger_fingerprint().unwrap(),
        fingerprint
    );
    task.abort();
}

#[tokio::test]
async fn rotation_revocation_and_expiry_are_checked_on_every_request() {
    let (state, origin, token, task) = serve().await;
    let client = Client::new();
    let next = state.lock().unwrap().grant.rotate().unwrap();
    assert_eq!(
        client
            .get(format!("{origin}/s/{token}/data.json"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let url = format!("{origin}/s/{next}/data.json");
    assert_eq!(
        client.get(&url).send().await.unwrap().status(),
        StatusCode::OK
    );
    state.lock().unwrap().grant.expires_at_utc = timeutil::now_ms() - 1;
    let expired = client.get(&url).send().await.unwrap();
    assert_eq!(expired.status(), StatusCode::GONE);
    assert_eq!(expired.json::<Value>().await.unwrap()["code"], "expired");
    state.lock().unwrap().grant.revoke();
    let revoked = client.get(&url).send().await.unwrap();
    assert_eq!(revoked.status(), StatusCode::GONE);
    assert_eq!(revoked.json::<Value>().await.unwrap()["code"], "revoked");
    task.abort();
}

#[tokio::test]
async fn live_changes_and_reconnection_keep_the_same_scope() {
    let (state, origin, token, task) = serve().await;
    let url = format!("{origin}/s/{token}/data.json");
    let client = Client::new();
    let before = client
        .get(&url)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    state.lock().unwrap().paused = true;
    assert_eq!(
        client.get(&url).send().await.unwrap().status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    {
        let mut demo = state.lock().unwrap();
        demo.add_demo_minute(timeutil::now_ms()).unwrap();
        demo.paused = false;
    }
    let after = client
        .get(&url)
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        after["entryCount"].as_i64().unwrap(),
        before["entryCount"].as_i64().unwrap() + 1
    );
    assert!(
        after["totalSeconds"].as_i64().unwrap() >= before["totalSeconds"].as_i64().unwrap() + 60
    );
    assert!(!after.to_string().contains(PRIVATE_CANARY));
    task.abort();
}
