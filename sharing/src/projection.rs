use crate::ShareInput;
use chrono_tz::Tz;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tempodesk_core::{
    domain::reports,
    error::{AppError, Result},
    timeutil,
};
/// Only this projection crosses the HTTP boundary. Raw TimeEntry/ReportResult is never serialized.
#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedDay {
    pub date: String,
    pub seconds: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedRow {
    pub project: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub day_seconds: Vec<i64>,
    pub total_seconds: i64,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedFields {
    pub descriptions: bool,
    pub billable: bool,
}

pub fn project(
    conn: &Connection,
    policy: &ShareInput,
    expires_at_utc: i64,
    now: i64,
) -> Result<SharedReport> {
    let now = timeutil::align_second(now);
    let report = reports::get_report(conn, &policy.filter, now)?;
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
        let description = policy.fields.descriptions.then_some(entry.description);
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
            billable: policy.fields.billable.then_some(entry.is_billable),
        });
    }
    Ok(SharedReport {
        demo: false,
        title: policy.title.clone(),
        date_from: report.date_from,
        date_to: report.date_to,
        timezone: report.timezone,
        generated_at_utc: now,
        expires_at_utc,
        total_seconds: report.total_seconds,
        entry_count: report.entry_count,
        billable_seconds: policy.fields.billable.then_some(report.billable_seconds),
        days,
        rows: rows.into_values().collect(),
        entries,
    })
}
