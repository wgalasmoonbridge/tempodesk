use serde::ser::{Serialize, SerializeStruct, Serializer};

pub type Result<T> = std::result::Result<T, AppError>;

/// Stable machine-readable error codes consumed by the frontend.
pub mod code {
    pub const VALIDATION: &str = "validation_error";
    pub const END_BEFORE_START: &str = "end_before_start";
    pub const ACTIVE_TIMER_EXISTS: &str = "active_timer_exists";
    pub const NO_ACTIVE_TIMER: &str = "no_active_timer";
    pub const NOT_FOUND: &str = "not_found";
    pub const CONFLICT: &str = "conflict";
    pub const ARCHIVED: &str = "archived";
    pub const DATABASE: &str = "database_error";
    pub const IO: &str = "io_error";
    pub const SERIALIZATION: &str = "serialization_error";
    pub const UNSUPPORTED: &str = "unsupported";
    pub const INTERNAL: &str = "internal_error";
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    EndBeforeStart(String),
    #[error("{0}")]
    ActiveTimerExists(String),
    #[error("{0}")]
    NoActiveTimer(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Archived(String),
    #[error("{0}")]
    Unsupported(String),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::Validation(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::Conflict(msg.into())
    }
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => code::VALIDATION,
            Self::EndBeforeStart(_) => code::END_BEFORE_START,
            Self::ActiveTimerExists(_) => code::ACTIVE_TIMER_EXISTS,
            Self::NoActiveTimer(_) => code::NO_ACTIVE_TIMER,
            Self::NotFound(_) => code::NOT_FOUND,
            Self::Conflict(_) => code::CONFLICT,
            Self::Archived(_) => code::ARCHIVED,
            Self::Unsupported(_) => code::UNSUPPORTED,
            Self::Database(_) => code::DATABASE,
            Self::Io(_) => code::IO,
            Self::Serialization(_) => code::SERIALIZATION,
            Self::Internal(_) => code::INTERNAL,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("ApiError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub fn validation_if(condition: bool, msg: impl Into<String>) -> Result<()> {
    if condition {
        Err(AppError::validation(msg))
    } else {
        Ok(())
    }
}
