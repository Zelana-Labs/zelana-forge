//! # Prover Network
//!
//! Network message types and serialization utilities for distributed proving.
//!
//! This crate provides:
//! - Message types for all protocol phases
//! - Base64 serialization for arkworks types
//! - Standardized API responses

pub mod messages;
pub mod serde_utils;

pub use messages::*;
