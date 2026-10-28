use keyring::{Entry, Error as KeyringError};

use crate::error::{AppError, Result};

const SERVICE: &str = "com.tempodesk.desktop";

/// API keys are namespaced per data profile so a dev/test key can never overwrite the installed
/// app's production key.
fn account(profile: &str) -> String {
    match profile {
        "production" => "gemini-api-key".to_string(),
        other => format!("gemini-api-key-{other}"),
    }
}

fn entry(profile: &str) -> Result<Entry> {
    Entry::new(SERVICE, &account(profile)).map_err(|err| {
        AppError::Internal(format!(
            "OS credential store is unavailable: {err}. The API key was not saved."
        ))
    })
}

pub fn get_api_key(profile: &str) -> Result<Option<String>> {
    let entry = entry(profile)?;
    match entry.get_password() {
        Ok(key) if !key.trim().is_empty() => Ok(Some(key)),
        Ok(_) => Ok(None),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(AppError::Internal(format!(
            "Could not read the API key from the OS credential store: {err}"
        ))),
    }
}

pub fn key_status(profile: &str) -> (bool, Option<String>) {
    match get_api_key(profile) {
        Ok(Some(_)) => (true, None),
        Ok(None) => (false, None),
        Err(err) => (false, Some(err.to_string())),
    }
}

pub fn set_api_key(profile: &str, key: &str) -> Result<()> {
    let key = key.trim();
    if key.chars().count() < 10 || key.chars().count() > 512 {
        return Err(AppError::validation(
            "The API key looks invalid. Paste the full key from your provider.",
        ));
    }
    if key.chars().any(char::is_whitespace) {
        return Err(AppError::validation(
            "The API key cannot contain spaces or line breaks.",
        ));
    }
    entry(profile)?.set_password(key).map_err(|err| {
        AppError::Internal(format!(
            "Could not save the API key in the OS credential store: {err}"
        ))
    })
}

pub fn delete_api_key(profile: &str) -> Result<()> {
    match entry(profile)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(AppError::Internal(format!(
            "Could not delete the API key from the OS credential store: {err}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accounts_are_namespaced_by_profile() {
        assert_eq!(account("production"), "gemini-api-key");
        assert_eq!(account("development"), "gemini-api-key-development");
        assert_eq!(account("test"), "gemini-api-key-test");
        assert_ne!(account("production"), account("test"));
    }
}
