use crate::error::{AppError, Result};

pub const MAX_DESCRIPTION: usize = 1000;
pub const MAX_MANUAL_SECONDS: i64 = 24 * 60 * 60;

pub fn normalize_name(raw: &str, label: &str, max_len: usize) -> Result<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::validation(format!("{label} name is required")));
    }
    if name.chars().count() > max_len {
        return Err(AppError::validation(format!(
            "{label} name must be {max_len} characters or fewer"
        )));
    }
    if name.contains('\n') || name.contains('\r') || name.contains('\t') {
        return Err(AppError::validation(format!(
            "{label} name cannot contain line breaks or tabs"
        )));
    }
    Ok(name.to_string())
}

pub fn normalize_description(raw: Option<&str>) -> Result<String> {
    let description = raw.unwrap_or("").trim();
    if description.chars().count() > MAX_DESCRIPTION {
        return Err(AppError::validation(format!(
            "Description must be {MAX_DESCRIPTION} characters or fewer"
        )));
    }
    Ok(description.to_string())
}

pub fn normalize_color(raw: Option<&str>, fallback: &str) -> Result<String> {
    let Some(value) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(fallback.to_string());
    };
    let bytes = value.as_bytes();
    let valid =
        bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(|b| b.is_ascii_hexdigit());
    if !valid {
        return Err(AppError::validation(
            "Color must be a hex value such as #4f46e5",
        ));
    }
    Ok(value.to_ascii_lowercase())
}

pub fn check_second_aligned(ms: i64) -> Result<()> {
    if ms < 0 {
        return Err(AppError::validation(
            "Timestamps must be positive UTC instants",
        ));
    }
    if ms % 1000 != 0 {
        return Err(AppError::validation(
            "Timestamps must be aligned to whole seconds",
        ));
    }
    Ok(())
}

pub fn validate_manual_range(start_ms: i64, end_ms: i64, now_ms: i64) -> Result<i64> {
    check_second_aligned(start_ms)?;
    check_second_aligned(end_ms)?;
    if end_ms <= start_ms {
        return Err(AppError::EndBeforeStart(
            "The end time is before the start time".into(),
        ));
    }
    if start_ms > now_ms + 60_000 {
        return Err(AppError::validation(
            "The start time cannot be in the future",
        ));
    }
    let seconds = (end_ms - start_ms) / 1000;
    if seconds > MAX_MANUAL_SECONDS {
        return Err(AppError::validation(
            "A manual entry cannot be longer than 24 hours",
        ));
    }
    Ok(seconds)
}

pub fn validate_timer_start(start_ms: i64, now_ms: i64) -> Result<()> {
    check_second_aligned(start_ms)?;
    if start_ms > now_ms + 1000 {
        return Err(AppError::validation(
            "The timer start time cannot be in the future",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_trimmed_and_bounded() {
        assert_eq!(normalize_name("  Acme  ", "Client", 120).unwrap(), "Acme");
        assert!(normalize_name("   ", "Client", 120).is_err());
        assert!(normalize_name(&"x".repeat(121), "Client", 120).is_err());
        assert!(normalize_name("a\nb", "Client", 120).is_err());
    }

    #[test]
    fn colors_are_validated() {
        assert_eq!(normalize_color(None, "#4f46e5").unwrap(), "#4f46e5");
        assert_eq!(
            normalize_color(Some("#AABBCC"), "#4f46e5").unwrap(),
            "#aabbcc"
        );
        assert!(normalize_color(Some("indigo"), "#4f46e5").is_err());
        assert!(normalize_color(Some("#12345"), "#4f46e5").is_err());
    }

    #[test]
    fn manual_range_rejects_end_before_start_and_over_24h() {
        let now = 1_800_000_000_000;
        assert!(validate_manual_range(now, now - 1000, now).is_err());
        assert!(validate_manual_range(now - 1000, now, now).is_ok());
        assert!(validate_manual_range(now - 24 * 3600 * 1000 - 1000, now, now).is_err());
        assert!(validate_manual_range(now - 500, now, now).is_err());
    }
}
