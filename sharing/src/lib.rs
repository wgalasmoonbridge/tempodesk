pub mod projection;
pub mod server;
pub mod service;
mod tunnel;

use std::path::Path;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tempodesk_core::error::{AppError, Result};
use tempodesk_core::{models::ReportFilter, timeutil};

pub use projection::{SharedFields, SharedReport};
pub use service::{ShareStatus, SharingService};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShareInput {
    pub title: String,
    pub filter: ReportFilter,
    pub fields: SharedFields,
    pub ttl_seconds: u64,
    pub initial_view: String,
    pub consent: bool,
}

impl ShareInput {
    pub fn validate(&mut self) -> Result<()> {
        self.title = self.title.trim().to_string();
        if self.title.is_empty()
            || self.title.chars().count() > 100
            || self.title.contains(['\r', '\n'])
        {
            return Err(AppError::validation(
                "Use a report title of 1–100 characters",
            ));
        }
        if !(60..=86400).contains(&self.ttl_seconds) {
            return Err(AppError::validation("Links must expire within 24 hours"));
        }
        if !matches!(self.initial_view.as_str(), "report" | "timesheet") {
            return Err(AppError::validation("Unknown shared report view"));
        }
        let start = timeutil::parse_date(&self.filter.date_from)?;
        let end = timeutil::parse_date(&self.filter.date_to)?;
        if end < start || (end - start).num_days() >= 366 {
            return Err(AppError::validation(
                "Choose a report range of at most 366 days",
            ));
        }
        self.filter
            .timezone
            .parse::<chrono_tz::Tz>()
            .map_err(|_| AppError::validation("Choose a valid report timezone"))?;
        for id in [
            &self.filter.project_id,
            &self.filter.client_id,
            &self.filter.tag_id,
        ] {
            if id.as_ref().is_some_and(|id| id.len() > 128) {
                return Err(AppError::validation("Invalid report scope"));
            }
        }
        if self
            .filter
            .search
            .as_ref()
            .is_some_and(|search| search.len() > 1000)
        {
            return Err(AppError::validation("Report search is too long"));
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq)]
pub enum AccessError {
    Unknown,
    Expired,
    Revoked,
}

pub struct ReportSource {
    conn: Connection,
    policy: ShareInput,
    expires_at_utc: i64,
    token_hash: [u8; 32],
    revoked: bool,
    cached: Option<(Instant, SharedReport)>,
}

impl ReportSource {
    /// A separate READ_ONLY connection sees committed WAL changes and cannot mutate app records.
    pub fn open(path: &Path, mut policy: ShareInput, now: i64) -> Result<(Self, String)> {
        policy.validate()?;
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(Duration::from_millis(750))?;
        conn.pragma_update(None, "query_only", true)?;
        let token = random_token()?;
        let source = Self {
            conn,
            expires_at_utc: now + policy.ttl_seconds as i64 * 1000,
            policy,
            token_hash: Sha256::digest(token.as_bytes()).into(),
            revoked: false,
            cached: None,
        };
        // Validate the complete projection before allowing a network listener to start.
        source.preview(now)?;
        Ok((source, token))
    }

    pub fn preview(&self, now: i64) -> Result<SharedReport> {
        let transaction = self.conn.unchecked_transaction()?;
        let report = projection::project(&transaction, &self.policy, self.expires_at_utc, now)?;
        if report.entries.len() > 10000 {
            return Err(AppError::validation(
                "Limit sharing to 10,000 sessions by narrowing the filters",
            ));
        }
        Ok(report)
    }

    pub fn report(&mut self, now: i64) -> Result<SharedReport> {
        if let Some((created, report)) = &self.cached {
            if created.elapsed() < Duration::from_secs(1) {
                return Ok(report.clone());
            }
        }
        let report = self.preview(now)?;
        self.cached = Some((Instant::now(), report.clone()));
        Ok(report)
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

    pub fn rotate(&mut self) -> Result<String> {
        if self.revoked || timeutil::now_ms() >= self.expires_at_utc {
            return Err(AppError::conflict("Create a new link after sharing ends"));
        }
        let token = random_token()?;
        self.token_hash = Sha256::digest(token.as_bytes()).into();
        Ok(token)
    }

    pub fn revoke(&mut self) {
        self.revoked = true;
        self.cached = None;
    }
    pub fn policy(&self) -> &ShareInput {
        &self.policy
    }
    pub fn expires_at_utc(&self) -> i64 {
        self.expires_at_utc
    }
}

fn random_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| AppError::Internal("Secure random source unavailable".into()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_sharing_connection_cannot_write_and_expired_grants_cannot_rotate() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.db");
        let conn = tempodesk_core::storage::db::open_at(&path).unwrap();
        let now = timeutil::now_ms();
        let date = timeutil::format_date(timeutil::local_date(now, chrono_tz::UTC));
        let input = ShareInput {
            title: "Read-only test".into(),
            filter: ReportFilter {
                date_from: date.clone(),
                date_to: date,
                timezone: "UTC".into(),
                project_id: None,
                client_id: None,
                tag_id: None,
                billable: None,
                search: None,
            },
            fields: SharedFields::default(),
            ttl_seconds: 60,
            initial_view: "report".into(),
            consent: false,
        };
        let (mut source, token) = ReportSource::open(&path, input, now - 60000).unwrap();
        assert!(source.conn.execute("DELETE FROM time_entries", []).is_err());
        assert_eq!(source.authorize(&token, now), Err(AccessError::Expired));
        assert!(source.rotate().is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM time_entries", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
