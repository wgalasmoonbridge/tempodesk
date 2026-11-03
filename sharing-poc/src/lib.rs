pub mod server;

use std::collections::BTreeMap;

use chrono::Duration;
use chrono_tz::Tz;
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tempodesk_core::domain::{reports, timer, timeutil};
use tempodesk_core::error::{AppError, Result};
use tempodesk_core::models::{ClientInput, ManualEntryInput, ProjectInput, ReportFilter};
use tempodesk_core::storage::{db, repo_clients, repo_projects};

pub const PRIVATE_CANARY: &str = "PRIVATE_BETA_CANARY_7492";

/// Only this projection crosses the HTTP boundary. Raw TimeEntry/ReportResult is never serialized.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedReport {
    pub demo: bool,
    pub title: String,
    pub date_from: String,
    pub date_to: String,
    pub timezone: String,
    pub generated_at_utc: i64,
    pub expires_at_utc: i64,
    pub total_seconds: i64,
    pub entry_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billable_seconds: Option<i64>,
    pub days: Vec<SharedDay>,
    pub rows: Vec<SharedRow>,
    pub entries: Vec<SharedEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedDay {
    pub date: String,
    pub seconds: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedRow {
    pub project: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub day_seconds: Vec<i64>,
    pub total_seconds: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedEntry {
    pub project: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub start_at_utc: i64,
    pub end_at_utc: i64,
    pub seconds: i64,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub billable: Option<bool>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SharedFields {
    pub descriptions: bool,
    pub billable: bool,
}

pub struct Grant {
    token_hash: [u8; 32],
    pub expires_at_utc: i64,
    revoked: bool,
    // Scope is private and fixed when the grant is created. Browser input cannot modify it.
    filter: ReportFilter,
    fields: SharedFields,
}

#[derive(Debug, PartialEq)]
pub enum AccessError {
    Unknown,
    Expired,
    Revoked,
}

impl Grant {
    fn new(
        filter: ReportFilter,
        fields: SharedFields,
        expires_at_utc: i64,
    ) -> Result<(Self, String)> {
        let token = random_token()?;
        Ok((
            Self {
                token_hash: Sha256::digest(token.as_bytes()).into(),
                expires_at_utc,
                revoked: false,
                filter,
                fields,
            },
            token,
        ))
    }

    pub fn authorize(&self, token: &str, now: i64) -> std::result::Result<(), AccessError> {
        if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(AccessError::Unknown);
        }
        let candidate: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        if !bool::from(candidate.ct_eq(&self.token_hash)) {
            return Err(AccessError::Unknown);
        }
        if self.revoked {
            return Err(AccessError::Revoked);
        }
        if now >= self.expires_at_utc {
            return Err(AccessError::Expired);
        }
        Ok(())
    }

    pub fn revoke(&mut self) {
        self.revoked = true;
    }

    pub fn rotate(&mut self) -> Result<String> {
        if self.revoked {
            return Err(AppError::conflict("A revoked share cannot be renewed"));
        }
        let token = random_token()?;
        self.token_hash = Sha256::digest(token.as_bytes()).into();
        Ok(token)
    }
}

fn random_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| AppError::Internal("Secure random source unavailable".into()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub struct Demo {
    conn: Connection,
    pub grant: Grant,
    pub paused: bool,
    project_id: String,
}

impl Demo {
    /// There is deliberately no database-path argument or environment override.
    pub fn new(now: i64, ttl_seconds: u64, fields: SharedFields) -> Result<(Self, String)> {
        if !(1..=3600).contains(&ttl_seconds) {
            return Err(AppError::validation("Demo links last 1–3,600 seconds"));
        }
        let mut conn = db::open_in_memory()?;
        let client = repo_clients::save(
            &conn,
            &ClientInput {
                name: "Demo client Alpha".into(),
                ..Default::default()
            },
            now,
        )?;
        let project = repo_projects::save(
            &conn,
            &ProjectInput {
                name: "Website refresh".into(),
                client_id: Some(client.id),
                default_billable: Some(true),
                ..Default::default()
            },
            now,
        )?;
        let private_project = repo_projects::save(
            &conn,
            &ProjectInput {
                name: PRIVATE_CANARY.into(),
                ..Default::default()
            },
            now,
        )?;
        for (hours_ago, description) in [
            (50, "Design exploration"),
            (26, "Build layouts"),
            (3, "Review and polish"),
        ] {
            timer::create_manual(
                &mut conn,
                &ManualEntryInput {
                    description: Some(description.into()),
                    project_id: Some(project.id.clone()),
                    tag_ids: None,
                    is_billable: Some(true),
                    start_at_utc: timeutil::align_second(now - hours_ago * 3_600_000),
                    end_at_utc: timeutil::align_second(now - hours_ago * 3_600_000 + 2_700_000),
                },
                now,
            )?;
        }
        timer::create_manual(
            &mut conn,
            &ManualEntryInput {
                description: Some(PRIVATE_CANARY.into()),
                project_id: Some(private_project.id),
                tag_ids: None,
                is_billable: Some(false),
                start_at_utc: timeutil::align_second(now - 36_000_000),
                end_at_utc: timeutil::align_second(now - 18_000_000),
            },
            now,
        )?;
        let source_id = tempodesk_core::storage::repo_entries::recent_completed(&conn, 1)?
            .first()
            .ok_or_else(|| AppError::Internal("Demo entry missing".into()))?
            .id
            .clone();
        timer::start_from_entry(
            &mut conn,
            &source_id,
            timeutil::align_second(now - 180_000),
            "timer",
            now,
        )?;
        // Ensure the live timer belongs to Alpha, independent of fixture ordering.
        let active = tempodesk_core::storage::repo_entries::get_active(&conn)?
            .ok_or_else(|| AppError::Internal("Demo timer missing".into()))?;
        if active.project_id.as_deref() != Some(&project.id) {
            return Err(AppError::Internal("Demo scope setup failed".into()));
        }
        let tz = chrono_tz::Asia::Manila;
        let date_to = timeutil::local_date(now, tz);
        let filter = ReportFilter {
            date_from: timeutil::format_date(date_to - Duration::days(6)),
            date_to: timeutil::format_date(date_to),
            timezone: tz.name().into(),
            project_id: Some(project.id.clone()),
            client_id: None,
            tag_id: None,
            billable: None,
            search: None,
        };
        let (grant, token) = Grant::new(filter, fields, now + ttl_seconds as i64 * 1000)?;
        Ok((
            Self {
                conn,
                grant,
                paused: false,
                project_id: project.id,
            },
            token,
        ))
    }

    pub fn report(&self, now: i64) -> Result<SharedReport> {
        let now = timeutil::align_second(now);
        let report = reports::get_report(&self.conn, &self.grant.filter, now)?;
        let timezone: Tz = report
            .timezone
            .parse()
            .map_err(|_| AppError::validation("Invalid report timezone"))?;
        let from = timeutil::day_start_ms(timeutil::parse_date(&report.date_from)?, timezone);
        let to = timeutil::day_end_ms(timeutil::parse_date(&report.date_to)?, timezone);
        let days: Vec<_> = report
            .daily
            .iter()
            .map(|day| SharedDay {
                date: day.date.clone(),
                seconds: day.seconds,
            })
            .collect();
        let mut rows: BTreeMap<(String, String), SharedRow> = BTreeMap::new();
        let mut entries = Vec::new();
        for item in report.entries {
            let entry = item.entry;
            let start = entry.start_at_utc.max(from);
            let end = entry.end_at_utc.unwrap_or(now).min(to).max(start);
            let project = entry.project_name.unwrap_or_else(|| "No project".into());
            let description = self.grant.fields.descriptions.then_some(entry.description);
            let row = rows
                .entry((project.clone(), description.clone().unwrap_or_default()))
                .or_insert_with(|| SharedRow {
                    project: project.clone(),
                    description: description.clone(),
                    day_seconds: vec![0; days.len()],
                    total_seconds: 0,
                });
            for (date, seconds) in timeutil::allocation_in_range(start, end, from, to, timezone) {
                if let Some(index) = days
                    .iter()
                    .position(|day| day.date == timeutil::format_date(date))
                {
                    row.day_seconds[index] += seconds;
                    row.total_seconds += seconds;
                }
            }
            entries.push(SharedEntry {
                project,
                description,
                start_at_utc: start,
                end_at_utc: end,
                seconds: item.in_range_seconds,
                running: entry.running,
                billable: self.grant.fields.billable.then_some(entry.is_billable),
            });
        }
        Ok(SharedReport {
            demo: true,
            title: "Demo client Alpha".into(),
            date_from: report.date_from,
            date_to: report.date_to,
            timezone: report.timezone,
            generated_at_utc: now,
            expires_at_utc: self.grant.expires_at_utc,
            total_seconds: report.total_seconds,
            entry_count: report.entry_count,
            billable_seconds: self
                .grant
                .fields
                .billable
                .then_some(report.billable_seconds),
            days,
            rows: rows.into_values().collect(),
            entries,
        })
    }

    /// Owner controls are stdin-only. This writes generated records into memory, never real files.
    pub fn add_demo_minute(&mut self, now: i64) -> Result<()> {
        timer::create_manual(
            &mut self.conn,
            &ManualEntryInput {
                description: Some("New demo work".into()),
                project_id: Some(self.project_id.clone()),
                tag_ids: None,
                is_billable: Some(true),
                start_at_utc: timeutil::align_second(now - 3_660_000),
                end_at_utc: timeutil::align_second(now - 3_600_000),
            },
            now,
        )?;
        Ok(())
    }

    pub fn fresh_link(&mut self, expires_at_utc: i64) -> Result<String> {
        let (grant, token) =
            Grant::new(self.grant.filter.clone(), self.grant.fields, expires_at_utc)?;
        self.grant = grant;
        Ok(token)
    }

    pub fn ledger_fingerprint(&self) -> Result<String> {
        let sql = "SELECT id, description, project_id, start_at_utc, end_at_utc, duration_seconds, is_billable, source, deleted_at_utc, created_at_utc, updated_at_utc FROM time_entries ORDER BY id";
        let mut statement = self.conn.prepare(sql)?;
        let mut rows = statement.query([])?;
        let mut hash = Sha256::new();
        while let Some(row) = rows.next()? {
            for index in 0..11 {
                hash.update(format!("{:?}|", row.get_ref(index)?).as_bytes());
            }
        }
        Ok(format!("{:x}", hash.finalize()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000;

    #[test]
    fn grants_expire_rotate_and_revoke_without_reactivation() {
        let (mut demo, token) = Demo::new(NOW, 60, SharedFields::default()).unwrap();
        assert_eq!(token.len(), 64);
        assert_eq!(demo.grant.authorize(&token, NOW), Ok(()));
        assert_eq!(
            demo.grant.authorize(&token, NOW + 60_000),
            Err(AccessError::Expired)
        );
        assert_eq!(
            demo.grant.authorize("not-a-token", NOW),
            Err(AccessError::Unknown)
        );
        let next = demo.grant.rotate().unwrap();
        assert_ne!(next, token);
        assert_eq!(demo.grant.authorize(&token, NOW), Err(AccessError::Unknown));
        assert_eq!(demo.grant.authorize(&next, NOW), Ok(()));
        demo.grant.revoke();
        assert_eq!(demo.grant.authorize(&next, NOW), Err(AccessError::Revoked));
        assert!(demo.grant.rotate().is_err());
    }

    #[test]
    fn projection_matches_core_totals_and_preserves_the_ledger() {
        let (demo, _) = Demo::new(NOW, 60, SharedFields::default()).unwrap();
        let before = demo.ledger_fingerprint().unwrap();
        let report = demo.report(NOW).unwrap();
        let core = reports::get_report(&demo.conn, &demo.grant.filter, NOW).unwrap();
        assert_eq!(report.total_seconds, core.total_seconds);
        assert_eq!(report.total_seconds, 8280);
        assert_eq!(
            report
                .entries
                .iter()
                .map(|entry| entry.seconds)
                .sum::<i64>(),
            report.total_seconds
        );
        assert_eq!(
            report.days.iter().map(|day| day.seconds).sum::<i64>(),
            report.total_seconds
        );
        assert_eq!(
            report.rows.iter().map(|row| row.total_seconds).sum::<i64>(),
            report.total_seconds
        );
        for (index, day) in report.days.iter().enumerate() {
            assert_eq!(
                report
                    .rows
                    .iter()
                    .map(|row| row.day_seconds[index])
                    .sum::<i64>(),
                day.seconds
            );
        }
        let after_tick = demo.report(NOW + 2000).unwrap();
        assert_eq!(after_tick.total_seconds, report.total_seconds + 2);
        assert_eq!(demo.ledger_fingerprint().unwrap(), before);
        let raw = serde_json::to_string(&report).unwrap();
        assert!(!raw.contains(PRIVATE_CANARY));
        assert!(!raw.contains("Design exploration"));
    }

    #[test]
    fn field_opt_in_does_not_expand_client_scope() {
        let (demo, _) = Demo::new(
            NOW,
            60,
            SharedFields {
                descriptions: true,
                billable: true,
            },
        )
        .unwrap();
        let report = demo.report(NOW).unwrap();
        assert_eq!(report.billable_seconds, Some(report.total_seconds));
        assert!(report
            .entries
            .iter()
            .all(|entry| entry.description.is_some() && entry.billable == Some(true)));
        let value = serde_json::to_string(&report).unwrap();
        assert!(value.contains("Design exploration"));
        assert!(!value.contains(PRIVATE_CANARY));
    }

    #[test]
    fn public_intervals_are_clipped_to_the_shared_range() {
        let (mut demo, _) = Demo::new(NOW, 60, SharedFields::default()).unwrap();
        let tz: Tz = demo.grant.filter.timezone.parse().unwrap();
        let from = timeutil::day_start_ms(
            timeutil::parse_date(&demo.grant.filter.date_from).unwrap(),
            tz,
        );
        let entry = tempodesk_core::storage::repo_entries::recent_completed(&demo.conn, 1)
            .unwrap()
            .remove(0);
        timer::update(
            &mut demo.conn,
            &entry.id,
            &tempodesk_core::models::EntryUpdateInput {
                description: entry.description,
                project_id: entry.project_id,
                tag_ids: vec![],
                is_billable: entry.is_billable,
                start_at_utc: from - 1_800_000,
                end_at_utc: Some(from + 1_800_000),
            },
            NOW,
        )
        .unwrap();
        let report = demo.report(NOW).unwrap();
        assert!(report
            .entries
            .iter()
            .all(|entry| entry.start_at_utc >= from));
        assert!(report
            .entries
            .iter()
            .any(|entry| entry.start_at_utc == from && entry.seconds == 1800));
    }
}
