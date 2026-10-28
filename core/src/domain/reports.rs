use std::collections::HashMap;

use chrono::NaiveDate;
use chrono_tz::Tz;
use rusqlite::Connection;

use crate::domain::timeutil::{
    allocation_in_range, date_range_bounds, format_date, local_date_string, local_time_string,
    parse_date,
};
use crate::error::{AppError, Result};
use crate::models::{
    DailyTotal, GroupTotal, ReportEntry, ReportFilter, ReportResult, TimeEntry, Timesheet,
    TimesheetDay, TimesheetRow,
};
use crate::storage::repo_entries;

fn report_tz(name: &str) -> Result<Tz> {
    if name.eq_ignore_ascii_case("system") {
        return Ok(chrono_tz::UTC);
    }
    name.parse::<Tz>()
        .map_err(|_| AppError::validation(format!("Unknown time zone: {name}")))
}

fn matches_filter(entry: &TimeEntry, filter: &ReportFilter) -> bool {
    if let Some(project_id) = filter.project_id.as_deref().filter(|s| !s.is_empty()) {
        if entry.project_id.as_deref() != Some(project_id) {
            return false;
        }
    }
    if let Some(client_id) = filter.client_id.as_deref().filter(|s| !s.is_empty()) {
        if entry.client_id.as_deref() != Some(client_id) {
            return false;
        }
    }
    if let Some(tag_id) = filter.tag_id.as_deref().filter(|s| !s.is_empty()) {
        if !entry.tags.iter().any(|t| t.id == tag_id) {
            return false;
        }
    }
    if let Some(billable) = filter.billable {
        if entry.is_billable != billable {
            return false;
        }
    }
    if let Some(search) = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if !entry
            .description
            .to_lowercase()
            .contains(&search.to_lowercase())
        {
            return false;
        }
    }
    true
}

fn effective_end(entry: &TimeEntry, now: i64) -> i64 {
    entry.end_at_utc.unwrap_or(now).max(entry.start_at_utc)
}

pub fn get_report(conn: &Connection, filter: &ReportFilter, now: i64) -> Result<ReportResult> {
    let tz = report_tz(&filter.timezone)?;
    let date_from = parse_date(&filter.date_from)?;
    let date_to = parse_date(&filter.date_to)?;
    let (range_start, range_end, days) = date_range_bounds(date_from, date_to, tz)?;

    let entries = repo_entries::list_overlapping(conn, range_start, range_end, now, false)?;

    let mut total_seconds = 0i64;
    let mut billable_seconds = 0i64;
    let mut daily: HashMap<NaiveDate, (i64, i64)> =
        days.iter().map(|d| (*d, (0i64, 0i64))).collect();
    let mut by_project: HashMap<String, GroupTotal> = HashMap::new();
    let mut by_client: HashMap<String, GroupTotal> = HashMap::new();
    let mut report_entries: Vec<ReportEntry> = Vec::new();

    for entry in entries {
        if !matches_filter(&entry, filter) {
            continue;
        }
        let end = effective_end(&entry, now);
        let allocations = allocation_in_range(entry.start_at_utc, end, range_start, range_end, tz);
        let in_range: i64 = allocations.iter().map(|(_, s)| *s).sum();
        if in_range <= 0 {
            continue;
        }

        total_seconds += in_range;
        if entry.is_billable {
            billable_seconds += in_range;
        }
        for (date, seconds) in &allocations {
            let slot = daily.entry(*date).or_insert((0, 0));
            slot.0 += *seconds;
            if entry.is_billable {
                slot.1 += *seconds;
            }
        }

        let project_key = entry
            .project_id
            .clone()
            .unwrap_or_else(|| "__none__".to_string());
        let project_group = by_project.entry(project_key).or_insert_with(|| GroupTotal {
            id: entry.project_id.clone(),
            name: entry
                .project_name
                .clone()
                .unwrap_or_else(|| "No project".to_string()),
            color: entry.project_color.clone(),
            seconds: 0,
            billable_seconds: 0,
        });
        project_group.seconds += in_range;
        if entry.is_billable {
            project_group.billable_seconds += in_range;
        }

        let client_key = entry
            .client_id
            .clone()
            .unwrap_or_else(|| "__none__".to_string());
        let client_group = by_client.entry(client_key).or_insert_with(|| GroupTotal {
            id: entry.client_id.clone(),
            name: entry
                .client_name
                .clone()
                .unwrap_or_else(|| "No client".to_string()),
            color: None,
            seconds: 0,
            billable_seconds: 0,
        });
        client_group.seconds += in_range;
        if entry.is_billable {
            client_group.billable_seconds += in_range;
        }

        report_entries.push(ReportEntry {
            entry,
            in_range_seconds: in_range,
        });
    }

    let mut daily_vec: Vec<DailyTotal> = days
        .iter()
        .map(|date| {
            let (seconds, billable) = daily.get(date).copied().unwrap_or((0, 0));
            DailyTotal {
                date: format_date(*date),
                seconds,
                billable_seconds: billable,
            }
        })
        .collect();
    daily_vec.sort_by_key(|d| d.date.clone());

    let mut project_vec: Vec<GroupTotal> = by_project.into_values().collect();
    project_vec.sort_by(|a, b| b.seconds.cmp(&a.seconds).then(a.name.cmp(&b.name)));
    let mut client_vec: Vec<GroupTotal> = by_client.into_values().collect();
    client_vec.sort_by(|a, b| b.seconds.cmp(&a.seconds).then(a.name.cmp(&b.name)));

    report_entries.sort_by(|a, b| {
        b.entry
            .start_at_utc
            .cmp(&a.entry.start_at_utc)
            .then(b.entry.created_at_utc.cmp(&a.entry.created_at_utc))
    });

    Ok(ReportResult {
        date_from: filter.date_from.clone(),
        date_to: filter.date_to.clone(),
        timezone: filter.timezone.clone(),
        total_seconds,
        billable_seconds,
        non_billable_seconds: total_seconds - billable_seconds,
        entry_count: report_entries.len() as i64,
        daily: daily_vec,
        by_project: project_vec,
        by_client: client_vec,
        entries: report_entries,
    })
}

pub fn get_timesheet(
    conn: &Connection,
    week_start: NaiveDate,
    sunday_start: bool,
    tz_name: &str,
    now: i64,
) -> Result<Timesheet> {
    let tz = report_tz(tz_name)?;
    let week_start = crate::domain::timeutil::start_of_week(week_start, sunday_start);
    let week_end = week_start + chrono::Duration::days(6);
    let (range_start, range_end, days) = date_range_bounds(week_start, week_end, tz)?;
    let entries = repo_entries::list_overlapping(conn, range_start, range_end, now, false)?;

    let mut day_totals: HashMap<NaiveDate, i64> = days.iter().map(|d| (*d, 0)).collect();
    struct RowAccum {
        project_id: Option<String>,
        project_name: Option<String>,
        project_color: Option<String>,
        description: String,
        cells: Vec<Vec<TimeEntry>>,
        cell_seconds: Vec<i64>,
    }
    let mut rows: HashMap<String, RowAccum> = HashMap::new();

    for entry in entries {
        let end = effective_end(&entry, now);
        let allocations = allocation_in_range(entry.start_at_utc, end, range_start, range_end, tz);
        if allocations.is_empty() {
            continue;
        }
        let key = format!(
            "{}\u{1f}{}",
            entry.project_id.as_deref().unwrap_or(""),
            entry.description
        );
        let row = rows.entry(key.clone()).or_insert_with(|| RowAccum {
            project_id: entry.project_id.clone(),
            project_name: entry.project_name.clone(),
            project_color: entry.project_color.clone(),
            description: entry.description.clone(),
            cells: vec![Vec::new(); 7],
            cell_seconds: vec![0; 7],
        });
        for (date, seconds) in allocations {
            let index = days.iter().position(|d| *d == date);
            if let Some(index) = index {
                if seconds > 0 && !row.cells[index].iter().any(|e| e.id == entry.id) {
                    row.cells[index].push(entry.clone());
                }
                row.cell_seconds[index] += seconds;
                *day_totals.entry(date).or_insert(0) += seconds;
            }
        }
    }

    let mut rows_vec: Vec<TimesheetRow> = rows
        .into_iter()
        .map(|(key, row)| TimesheetRow {
            key,
            project_id: row.project_id,
            project_name: row.project_name,
            project_color: row.project_color,
            description: row.description,
            total_seconds: row.cell_seconds.iter().sum(),
            cells: row.cells,
            cell_seconds: row.cell_seconds,
        })
        .collect();
    rows_vec.sort_by(|a, b| {
        a.project_name
            .as_deref()
            .unwrap_or("~")
            .to_lowercase()
            .cmp(&b.project_name.as_deref().unwrap_or("~").to_lowercase())
            .then(
                a.description
                    .to_lowercase()
                    .cmp(&b.description.to_lowercase()),
            )
    });

    let days_vec: Vec<TimesheetDay> = days
        .iter()
        .map(|date| TimesheetDay {
            date: format_date(*date),
            total_seconds: day_totals.get(date).copied().unwrap_or(0),
        })
        .collect();
    let total = days_vec.iter().map(|d| d.total_seconds).sum();

    Ok(Timesheet {
        week_start: format_date(week_start),
        week_end: format_date(week_end),
        days: days_vec,
        rows: rows_vec,
        total_seconds: total,
    })
}

fn csv_field(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn decimal_hours(seconds: i64) -> String {
    format!("{:.4}", seconds as f64 / 3600.0)
}

/// RFC 4180 CSV for the exact filtered report, using per-range duration seconds so the CSV
/// total always equals the report total.
pub fn build_csv(conn: &Connection, filter: &ReportFilter, now: i64) -> Result<(String, i64, i64)> {
    let tz = report_tz(&filter.timezone)?;
    let report = get_report(conn, filter, now)?;
    let mut out = String::new();
    out.push_str(
        "Entry ID,Description,Project,Client,Tags,Billable,Start date,Start time,End date,End time,Duration seconds,Decimal hours,Time zone\r\n",
    );
    for item in &report.entries {
        let entry = &item.entry;
        let start_date = local_date_string(entry.start_at_utc, tz);
        let start_time = local_time_string(entry.start_at_utc, tz);
        let (end_date, end_time) = match entry.end_at_utc {
            Some(end) => (local_date_string(end, tz), local_time_string(end, tz)),
            None => (String::new(), String::new()),
        };
        let tags = entry
            .tags
            .iter()
            .map(|t| t.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        // The IANA zone is stable and interpretable across DST boundaries.
        let zone = tz.name().to_string();
        let row = [
            entry.id.as_str(),
            entry.description.as_str(),
            entry.project_name.as_deref().unwrap_or(""),
            entry.client_name.as_deref().unwrap_or(""),
            tags.as_str(),
            if entry.is_billable { "true" } else { "false" },
            start_date.as_str(),
            start_time.as_str(),
            end_date.as_str(),
            end_time.as_str(),
            &item.in_range_seconds.to_string(),
            &decimal_hours(item.in_range_seconds),
            zone.as_str(),
        ];
        out.push_str(
            &row.iter()
                .map(|f| csv_field(f))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push_str("\r\n");
    }
    Ok((out, report.entry_count, report.total_seconds))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::timer;
    use crate::models::{ManualEntryInput, TagInput};
    use crate::storage::{db, repo_tags};

    fn tz(name: &str) -> Tz {
        name.parse().unwrap()
    }

    fn ms(tz: Tz, y: i32, m: u32, d: u32, h: u32, min: u32, s: u32) -> i64 {
        use chrono::TimeZone;
        tz.with_ymd_and_hms(y, m, d, h, min, s)
            .single()
            .unwrap()
            .timestamp_millis()
    }

    fn add_manual(
        conn: &mut Connection,
        start: i64,
        end: i64,
        description: &str,
        billable: bool,
        tag_ids: Vec<String>,
        now: i64,
    ) -> String {
        timer::create_manual(
            conn,
            &ManualEntryInput {
                description: Some(description.into()),
                project_id: None,
                tag_ids: Some(tag_ids),
                is_billable: Some(billable),
                start_at_utc: start,
                end_at_utc: end,
            },
            now,
        )
        .unwrap()
        .entry
        .id
    }

    #[test]
    fn report_splits_midnight_and_dst_consistently() {
        let mut conn = db::open_in_memory().unwrap();
        let z = tz("America/New_York");
        let now = ms(z, 2026, 3, 10, 12, 0, 0);
        // Cross-midnight entry on a normal day.
        add_manual(
            &mut conn,
            ms(z, 2026, 3, 9, 23, 30, 0),
            ms(z, 2026, 3, 10, 0, 30, 0),
            "midnight",
            false,
            vec![],
            now,
        );
        // DST spring-forward day: 00:30 EST -> 04:30 EDT = 3 real hours.
        add_manual(
            &mut conn,
            ms(z, 2026, 3, 8, 0, 30, 0),
            ms(z, 2026, 3, 8, 4, 30, 0),
            "dst",
            true,
            vec![],
            now,
        );
        let report = get_report(
            &conn,
            &ReportFilter {
                date_from: "2026-03-08".into(),
                date_to: "2026-03-10".into(),
                timezone: "America/New_York".into(),
                project_id: None,
                client_id: None,
                tag_id: None,
                billable: None,
                search: None,
            },
            now,
        )
        .unwrap();
        assert_eq!(report.total_seconds, 3 * 3600 + 1800 + 1800);
        assert_eq!(report.billable_seconds, 3 * 3600);
        assert_eq!(report.daily[0].seconds, 3 * 3600);
        assert_eq!(report.daily[1].seconds, 1800);
        assert_eq!(report.daily[2].seconds, 1800);
        assert_eq!(report.entry_count, 2);
        assert_eq!(
            report.total_seconds,
            report.daily.iter().map(|d| d.seconds).sum::<i64>()
        );
    }

    #[test]
    fn report_filters_are_shared_with_csv() {
        let mut conn = db::open_in_memory().unwrap();
        let z = tz("UTC");
        let now = ms(z, 2026, 6, 10, 12, 0, 0);
        let tag = repo_tags::save(
            &conn,
            &TagInput {
                id: None,
                name: "focus".into(),
                color: None,
            },
            now,
        )
        .unwrap();
        add_manual(
            &mut conn,
            ms(z, 2026, 6, 1, 9, 0, 0),
            ms(z, 2026, 6, 1, 10, 0, 0),
            "With comma, and \"quote\"\nline",
            true,
            vec![tag.id.clone()],
            now,
        );
        add_manual(
            &mut conn,
            ms(z, 2026, 6, 1, 10, 0, 0),
            ms(z, 2026, 6, 1, 11, 0, 0),
            "Other",
            false,
            vec![],
            now,
        );
        let filter = ReportFilter {
            date_from: "2026-06-01".into(),
            date_to: "2026-06-07".into(),
            timezone: "UTC".into(),
            project_id: None,
            client_id: None,
            tag_id: Some(tag.id.clone()),
            billable: Some(true),
            search: None,
        };
        let report = get_report(&conn, &filter, now).unwrap();
        assert_eq!(report.total_seconds, 3600);
        assert_eq!(report.entry_count, 1);
        let (csv, rows, total) = build_csv(&conn, &filter, now).unwrap();
        assert_eq!((rows, total), (1, 3600));
        assert!(csv.contains("\"With comma, and \"\"quote\"\"\nline\""));
        assert!(csv.ends_with("\r\n"));
        assert!(csv.contains(",3600,1.0000,"));
    }

    #[test]
    fn timesheet_groups_by_project_and_description() {
        let mut conn = db::open_in_memory().unwrap();
        let z = tz("Europe/Berlin");
        // 2026-10-28 is a Wednesday.
        let now = ms(z, 2026, 10, 30, 12, 0, 0);
        add_manual(
            &mut conn,
            ms(z, 2026, 10, 28, 9, 0, 0),
            ms(z, 2026, 10, 28, 10, 30, 0),
            "Build API",
            false,
            vec![],
            now,
        );
        add_manual(
            &mut conn,
            ms(z, 2026, 10, 28, 11, 0, 0),
            ms(z, 2026, 10, 28, 11, 30, 0),
            "Build API",
            false,
            vec![],
            now,
        );
        let sheet = get_timesheet(
            &conn,
            NaiveDate::from_ymd_opt(2026, 10, 28).unwrap(),
            false,
            "Europe/Berlin",
            now,
        )
        .unwrap();
        assert_eq!(sheet.week_start, "2026-10-26");
        assert_eq!(sheet.rows.len(), 1);
        let row = &sheet.rows[0];
        assert_eq!(row.description, "Build API");
        assert_eq!(row.total_seconds, 7200);
        assert_eq!(row.cells[2].len(), 2);
        assert_eq!(sheet.days[2].total_seconds, 7200);
        assert_eq!(sheet.total_seconds, 7200);
    }
}
