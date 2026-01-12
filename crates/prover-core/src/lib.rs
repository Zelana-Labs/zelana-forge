//! # Prover Core
//!
//! Core cryptographic primitives for distributed zero-knowledge proving.
//!
//! This crate provides:
//! - Shamir's Secret Sharing for distributing secrets
//! - Schnorr proof generation and verification
//! - Lagrange interpolation for aggregating proof fragments
//!
//! ## Example
//!
//! ```rust
//! use prover_core::{shamir, schnorr, ShareSet};
//! use ark_std::test_rng;
//!
//! let mut rng = test_rng();
//!
//! // Split a secret among 5 parties with threshold 3
//! let secret = ark_bn254::Fr::from(42u64);
//! let shares = shamir::share_secret(secret, 5, 3, &mut rng);
//!
//! // Reconstruct from any 3 shares
//! let recovered = shamir::reconstruct_secret(&shares[0..3]);
//! assert_eq!(secret, recovered);
//! ```

pub mod shamir;
pub mod schnorr;
pub mod errors;

pub use shamir::{SecretShare, ShareSet};
pub use schnorr::{Commitment, ProofFragment, DistributedProof, PublicParams, generate_challenge};
pub use errors::{ProverError, Result};

/// Re-export arkworks types
pub use ark_bn254::{Fr , G1Affine, G1Projective};

/// Re-export ark_std::rand for RNG types
pub use ark_std::rand;