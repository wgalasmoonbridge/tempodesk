use reqwest::StatusCode;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tempodesk_core::{
    domain::timer,
    models::{ManualEntryInput, ProjectInput, ReportFilter},
    storage::{db, repo_projects},
    timeutil,
};
use tempodesk_sharing::{
    server, AccessError, ReportSource, ShareInput, SharedFields, SharingService,
};

fn fixture() -> (tempfile::TempDir, PathBuf, rusqlite::Connection, ShareInput) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let mut conn = db::open_at(&path).unwrap();
    let now = timeutil::now_ms();
    let project = repo_projects::save(
        &conn,
        &ProjectInput {
            name: "Approved project".into(),
            ..Default::default()
        },
        now,
    )
    .unwrap();
    let private = repo_projects::save(
        &conn,
        &ProjectInput {
            name: "PRIVATE_CLIENT_CANARY".into(),
            ..Default::default()
        },
        now,
    )
    .unwrap();
    for (id, description) in [
        (project.id.clone(), "Private work details"),
        (private.id, "PRIVATE_CLIENT_CANARY"),
    ] {
        timer::create_manual(
            &mut conn,
            &ManualEntryInput {
                description: Some(description.into()),
                project_id: Some(id),
                tag_ids: None,
                is_billable: Some(true),
                start_at_utc: timeutil::align_second(now - 3_600_000),
                end_at_utc: timeutil::align_second(now - 1_800_000),
            },
            now,
        )
        .unwrap();
    }
    let today = timeutil::local_date(now, chrono_tz::Asia::Manila);
    let input = ShareInput {
        title: "Approved report".into(),
        filter: ReportFilter {
            date_from: timeutil::format_date(today.pred_opt().unwrap()),
            date_to: timeutil::format_date(today),
            timezone: "Asia/Manila".into(),
            project_id: Some(project.id),
            client_id: None,
            tag_id: None,
            billable: None,
            search: None,
        },
        fields: SharedFields::default(),
        ttl_seconds: 60,
        initial_view: "report".into(),
        consent: true,
    };
    (dir, path, conn, input)
}

fn ledger(conn: &rusqlite::Connection) -> String {
    let mut stmt = conn.prepare("SELECT id,description,project_id,start_at_utc,end_at_utc,duration_seconds,updated_at_utc FROM time_entries ORDER BY id").unwrap();
    let rows = stmt
        .query_map([], |row| {
            Ok((0..7)
                .map(|i| format!("{:?}", row.get_ref(i).unwrap()))
                .collect::<Vec<_>>()
                .join("|"))
        })
        .unwrap();
    rows.map(|row| row.unwrap()).collect::<Vec<_>>().join("\n")
}

#[test]
fn preview_is_scoped_minimized_and_does_not_change_saved_records() {
    let (_dir, path, conn, mut input) = fixture();
    let before = ledger(&conn);
    input.consent = false;
    let report = SharingService::preview(&path, input.clone()).unwrap();
    assert_eq!(report.entry_count, 1);
    assert_eq!(report.total_seconds, 1800);
    assert!(!report.demo);
    let body = serde_json::to_string(&report).unwrap();
    for private in [
        "PRIVATE_CLIENT_CANARY",
        "Private work details",
        "projectId",
        "clientId",
        "createdAtUtc",
        "billableSeconds",
        "description",
    ] {
        assert!(!body.contains(private), "{private}");
    }
    assert_eq!(ledger(&conn), before);
    input.fields = SharedFields {
        descriptions: true,
        billable: true,
    };
    let report = SharingService::preview(&path, input).unwrap();
    assert_eq!(report.billable_seconds, Some(1800));
    assert!(serde_json::to_string(&report)
        .unwrap()
        .contains("Private work details"));
}

#[test]
fn validation_and_consent_fail_before_network_or_database_creation() {
    let (_dir, path, _conn, mut input) = fixture();
    let service = SharingService::default();
    input.consent = false;
    assert!(service
        .start(&path, path.with_file_name("tools"), input.clone())
        .is_err());
    assert_eq!(service.status().phase, "stopped");
    input.ttl_seconds = 86401;
    assert!(input.validate().is_err());
    input.ttl_seconds = 60;
    input.filter.date_from = "1900-01-01".into();
    assert!(input.validate().is_err());
    let missing = path.with_file_name("must-not-be-created.db");
    assert!(SharingService::preview(&missing, input).is_err());
    assert!(!missing.exists());
}

#[tokio::test]
async fn real_http_is_read_only_checks_each_capability_and_observes_live_wal_changes() {
    let (_dir, path, mut conn, input) = fixture();
    let before = ledger(&conn);
    let (source, token) = ReportSource::open(&path, input.clone(), timeutil::now_ms()).unwrap();
    let state = Arc::new(Mutex::new(source));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let app = server::router(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::new();
    let url = format!("{origin}/s/{token}/data.json");
    let response = client.get(&url).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    for (header, expected) in [
        ("cache-control", "no-store"),
        ("referrer-policy", "no-referrer"),
        ("content-security-policy", "frame-ancestors 'none'"),
        ("x-content-type-options", "nosniff"),
    ] {
        assert!(response.headers()[header]
            .to_str()
            .unwrap()
            .contains(expected));
    }
    assert!(response
        .headers()
        .get("access-control-allow-origin")
        .is_none());
    let initial: Value = response.json().await.unwrap();
    assert_eq!(initial["totalSeconds"], 1800);
    for query in [
        "projectId=private",
        "dateFrom=1900-01-01",
        "includeDescriptions=true",
    ] {
        assert_eq!(
            client
                .get(format!("{url}?{query}"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    for method in [
        reqwest::Method::POST,
        reqwest::Method::PUT,
        reqwest::Method::DELETE,
    ] {
        assert_eq!(
            client
                .request(method, &url)
                .body("modify")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }
    for path in [
        "/tempodesk.db",
        "/invoke",
        "/backups",
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
    assert_eq!(
        client.head(&url).send().await.unwrap().status(),
        StatusCode::OK
    );
    assert_eq!(ledger(&conn), before);
    let now = timeutil::now_ms();
    timer::create_manual(
        &mut conn,
        &ManualEntryInput {
            description: Some("New live work".into()),
            project_id: input.filter.project_id.clone(),
            tag_ids: None,
            is_billable: Some(false),
            start_at_utc: timeutil::align_second(now - 600_000),
            end_at_utc: timeutil::align_second(now - 540_000),
        },
        now,
    )
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let live: Value = client.get(&url).send().await.unwrap().json().await.unwrap();
    assert_eq!(live["entryCount"], 2);
    assert_eq!(live["totalSeconds"], 1860);
    assert!(!live.to_string().contains("PRIVATE_CLIENT_CANARY"));
    let next = state.lock().unwrap().rotate().unwrap();
    assert_eq!(
        client.get(&url).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
    let next_url = format!("{origin}/s/{next}/data.json");
    assert_eq!(
        client.get(&next_url).send().await.unwrap().status(),
        StatusCode::OK
    );
    state.lock().unwrap().revoke();
    assert_eq!(
        client.get(&next_url).send().await.unwrap().status(),
        StatusCode::GONE
    );
    assert!(state.lock().unwrap().rotate().is_err());
    task.abort();
}

#[test]
fn expiry_and_clipped_totals_use_the_fixed_owner_timezone() {
    let (_dir, path, _conn, input) = fixture();
    let now = timeutil::now_ms();
    let (source, token) = ReportSource::open(&path, input, now).unwrap();
    assert_eq!(
        source.authorize(&token, now + 60000),
        Err(AccessError::Expired)
    );
    let report = source.preview(now).unwrap();
    assert_eq!(
        report.total_seconds,
        report.days.iter().map(|day| day.seconds).sum::<i64>()
    );
    assert_eq!(
        report.total_seconds,
        report.rows.iter().map(|row| row.total_seconds).sum::<i64>()
    );
}
