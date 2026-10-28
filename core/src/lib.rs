//! TempoDesk core: domain logic, SQLite persistence, reporting, and portability.
//!
//! This crate deliberately has no Tauri/UI dependency so that all business rules can be
//! unit- and integration-tested on any host.

pub mod domain;
pub mod error;
pub mod models;
pub mod storage;

pub use domain::timeutil;
