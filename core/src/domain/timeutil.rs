use chrono::{Datelike, Duration, LocalResult, NaiveDate, TimeZone};
use chrono_tz::Tz;

use crate::error::{AppError, Result};

pub const MS_PER_DAY: i64 = 86_400_000;

/// Resolve an IANA timezone name. "system" and unknown names fall back to UTC on the
/// backend; the frontend resolves "system" to the OS IANA zone before calling commands.
pub fn resolve_tz(name: Option<&str>) -> Tz {
    name.and_then(|n| n.parse::<Tz>().ok())
        .unwrap_or(chrono_tz::UTC)
}

pub fn parse_date(value: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation(format!("Invalid date '{value}', expected YYYY-MM-DD")))
}

pub fn format_date(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

pub fn local_date(ms: i64, tz: Tz) -> NaiveDate {
    tz.timestamp_millis_opt(ms)
        .single()
        .or_else(|| tz.timestamp_millis_opt(ms).earliest())
        .map(|dt| dt.date_naive())
        .unwrap_or_else(|| {
            chrono::DateTime::from_timestamp_millis(ms)
                .unwrap_or_default()
                .date_naive()
        })
}

/// First instant (epoch ms) of the local calendar day `date` in `tz`.
///
/// The first instant is used for ambiguous midnights (clock moved back). If local midnight
/// does not exist (spring-forward at midnight), the earliest existing instant of that day is
/// returned. Both cases are rare but must not lose time.
pub fn day_start_ms(date: NaiveDate, tz: Tz) -> i64 {
    let naive = date.and_hms_opt(0, 0, 0).expect("valid midnight");
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt.timestamp_millis(),
        LocalResult::Ambiguous(earlier, later) => {
            earlier.timestamp_millis().min(later.timestamp_millis())
        }
        LocalResult::None => {
            // Walk forward in 1-minute steps (max 26h) to find the first valid local instant.
            let mut probe = naive;
            for _ in 0..(26 * 60) {
                if let Some(dt) = tz.from_local_datetime(&probe).earliest() {
                    return dt.timestamp_millis();
                }
                probe += Duration::minutes(1);
            }
            naive.and_utc().timestamp_millis()
        }
    }
}

/// Exclusive end instant for a local calendar day.
pub fn day_end_ms(date: NaiveDate, tz: Tz) -> i64 {
    let next = date.succ_opt().unwrap_or(date);
    let end = day_start_ms(next, tz);
    if end <= day_start_ms(date, tz) {
        day_start_ms(date, tz) + MS_PER_DAY
    } else {
        end
    }
}

/// Local-day start for a display instant.
pub fn local_day_bounds(ms: i64, tz: Tz) -> (NaiveDate, i64, i64) {
    let date = local_date(ms, tz);
    (date, day_start_ms(date, tz), day_end_ms(date, tz))
}

/// Split `[start_ms, end_ms)` into whole-second allocations per local calendar day.
///
/// Timestamps are stored second-aligned, so the returned seconds always sum to
/// `(end_ms - start_ms) / 1000` exactly, including DST transitions and midnight crossings.
pub fn split_by_local_day(start_ms: i64, end_ms: i64, tz: Tz) -> Vec<(NaiveDate, i64)> {
    if end_ms <= start_ms {
        return Vec::new();
    }
    let mut out: Vec<(NaiveDate, i64)> = Vec::new();
    let mut cursor = start_ms;
    let mut guard = 0;
    while cursor < end_ms && guard < 1000 {
        guard += 1;
        let date = local_date(cursor, tz);
        let mut boundary = day_end_ms(date, tz);
        if boundary <= cursor {
            boundary = cursor + MS_PER_DAY;
        }
        let segment_end = end_ms.min(boundary);
        let seconds = (segment_end - cursor) / 1000;
        if seconds > 0 {
            if let Some(last) = out.last_mut() {
                if last.0 == date {
                    last.1 += seconds;
                    cursor = segment_end;
                    continue;
                }
            }
            out.push((date, seconds));
        }
        cursor = segment_end;
    }
    out
}

/// Seconds of `[start,end)` that fall inside `[range_start, range_end)`, allocated per local day.
pub fn allocation_in_range(
    start_ms: i64,
    end_ms: i64,
    range_start_ms: i64,
    range_end_ms: i64,
    tz: Tz,
) -> Vec<(NaiveDate, i64)> {
    let s = start_ms.max(range_start_ms);
    let e = end_ms.min(range_end_ms);
    if e <= s {
        return Vec::new();
    }
    split_by_local_day(s, e, tz)
}

pub fn start_of_week(date: NaiveDate, sunday_start: bool) -> NaiveDate {
    let from_monday = date.weekday().num_days_from_monday() as i64;
    let offset = if sunday_start {
        (from_monday + 1) % 7
    } else {
        from_monday
    };
    date - Duration::days(offset)
}

/// Inclusive date range for a report expressed as local dates.
pub fn date_range_bounds(
    date_from: NaiveDate,
    date_to: NaiveDate,
    tz: Tz,
) -> Result<(i64, i64, Vec<NaiveDate>)> {
    if date_to < date_from {
        return Err(AppError::validation(
            "The end date must be on or after the start date",
        ));
    }
    let start = day_start_ms(date_from, tz);
    let end = day_start_ms(
        date_to
            .succ_opt()
            .ok_or_else(|| AppError::validation("Date range is too large"))?,
        tz,
    );
    let mut days = Vec::new();
    let mut cursor = date_from;
    while cursor <= date_to {
        days.push(cursor);
        cursor = match cursor.succ_opt() {
            Some(d) => d,
            None => break,
        };
    }
    Ok((start, end, days))
}

pub fn local_date_string(ms: i64, tz: Tz) -> String {
    format_date(local_date(ms, tz))
}

pub fn local_datetime_string(ms: i64, tz: Tz) -> String {
    match tz.timestamp_millis_opt(ms).single() {
        Some(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        None => {
            let dt = chrono::DateTime::from_timestamp_millis(ms)
                .unwrap_or_default()
                .naive_utc();
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        }
    }
}

pub fn local_time_string(ms: i64, tz: Tz) -> String {
    match tz.timestamp_millis_opt(ms).single() {
        Some(dt) => dt.format("%H:%M:%S").to_string(),
        None => "00:00:00".to_string(),
    }
}

/// Human-friendly timezone abbreviation for a given instant (e.g. "EST", "EDT").
pub fn tz_abbreviation(ms: i64, tz: Tz) -> String {
    tz.timestamp_millis_opt(ms)
        .single()
        .map(|dt| dt.format("%Z").to_string())
        .unwrap_or_else(|| tz.name().to_string())
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Truncate a timestamp to whole seconds and ensure it is non-negative.
pub fn align_second(ms: i64) -> i64 {
    ms.div_euclid(1000) * 1000
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tz(name: &str) -> Tz {
        name.parse().unwrap()
    }

    #[test]
    fn midnight_crossing_splits_thirty_thirty() {
        let t = tz("Europe/Berlin");
        // 2026-03-10 23:30 local -> 2026-03-11 00:30 local
        let start = t
            .with_ymd_and_hms(2026, 3, 10, 23, 30, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let end = t
            .with_ymd_and_hms(2026, 3, 11, 0, 30, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let split = split_by_local_day(start, end, t);
        assert_eq!(
            split,
            vec![
                (NaiveDate::from_ymd_opt(2026, 3, 10).unwrap(), 1800),
                (NaiveDate::from_ymd_opt(2026, 3, 11).unwrap(), 1800)
            ]
        );
        assert_eq!(split.iter().map(|s| s.1).sum::<i64>(), 3600);
    }

    #[test]
    fn dst_spring_forward_uses_real_elapsed_seconds() {
        let t = tz("America/New_York");
        // 2026-03-08: 01:30 EST -> 03:30 EDT is one real hour.
        let start = t
            .with_ymd_and_hms(2026, 3, 8, 1, 30, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let end = t
            .with_ymd_and_hms(2026, 3, 8, 3, 30, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        assert_eq!((end - start) / 1000, 3600);
        let split = split_by_local_day(start, end, t);
        assert_eq!(split.len(), 1);
        assert_eq!(split[0].1, 3600);
        // The local day is 23 hours long.
        let day = NaiveDate::from_ymd_opt(2026, 3, 8).unwrap();
        assert_eq!(
            (day_end_ms(day, t) - day_start_ms(day, t)) / 1000,
            23 * 3600
        );
    }

    #[test]
    fn dst_fall_back_day_is_25_hours() {
        let t = tz("America/New_York");
        let day = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        assert_eq!(
            (day_end_ms(day, t) - day_start_ms(day, t)) / 1000,
            25 * 3600
        );
        // 00:30 EDT -> 23:30 EST spans 25 real hours.
        let start = t
            .with_ymd_and_hms(2026, 11, 1, 0, 30, 0)
            .earliest()
            .unwrap()
            .timestamp_millis();
        let end = t
            .with_ymd_and_hms(2026, 11, 1, 23, 30, 0)
            .latest()
            .unwrap()
            .timestamp_millis();
        // 00:30 EDT = 04:30 UTC; 23:30 EST = 04:30 UTC next day => 24 real hours.
        assert_eq!((end - start) / 1000, 24 * 3600);
        let split = split_by_local_day(start, end, t);
        assert_eq!(split.iter().map(|s| s.1).sum::<i64>(), (end - start) / 1000);
    }

    #[test]
    fn report_allocation_clips_to_range() {
        let t = tz("UTC");
        let start = t
            .with_ymd_and_hms(2026, 5, 1, 23, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let end = t
            .with_ymd_and_hms(2026, 5, 2, 1, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let range_start = day_start_ms(NaiveDate::from_ymd_opt(2026, 5, 2).unwrap(), t);
        let range_end = day_start_ms(NaiveDate::from_ymd_opt(2026, 5, 3).unwrap(), t);
        let alloc = allocation_in_range(start, end, range_start, range_end, t);
        assert_eq!(
            alloc,
            vec![(NaiveDate::from_ymd_opt(2026, 5, 2).unwrap(), 3600)]
        );
    }

    #[test]
    fn week_starts_respect_monday_and_sunday() {
        let wed = NaiveDate::from_ymd_opt(2026, 10, 28).unwrap();
        assert_eq!(
            start_of_week(wed, false),
            NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
        );
        assert_eq!(
            start_of_week(wed, true),
            NaiveDate::from_ymd_opt(2026, 10, 25).unwrap()
        );
        let sunday = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        assert_eq!(start_of_week(sunday, true), sunday);
        assert_eq!(
            start_of_week(sunday, false),
            NaiveDate::from_ymd_opt(2026, 10, 26).unwrap()
        );
    }
}
