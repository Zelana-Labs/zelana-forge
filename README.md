# Distributed Zero-Knowledge Proof System

A Rust implementation of a distributed ZK proof system where **no single prover node knows the complete witness data**, preserving privacy through Shamir's Secret Sharing and threshold cryptography.

## Building & Running

```bash
cargo build --release
cargo test
cargo run -p prover
```

## Fixes Applied

### 1. `thread_rng` Not Found

**Problem:** `ark_std::rand::thread_rng()` requires the `std` feature flag.

**Fix:** 
- Added `features = ["std"]` to `ark-std` in Cargo.toml
- Changed `ProofCoordinator::new()` and `DistributedProofSystem::new()` to accept an RNG parameter instead of creating one internally
- Use `ark_std::rand::rngs::StdRng::from_entropy()` in main.rs

### 2. Serde Not Implemented for `Fr` and `G1Affine`

**Problem:** Arkworks types don't implement serde traits by default.

**Fix:** Created wrapper types with manual serde implementations:

```rust
pub struct SerializableFr(pub Fr);
pub struct SerializableG1(pub G1Affine);
```

These use `CanonicalSerialize`/`CanonicalDeserialize` to convert to bytes for serde.

### 3. Challenge Mismatch Bug (from previous fix)

**Problem:** Challenge was computed from ALL commitments in `prove()`, but recomputed from only `threshold` commitments in `aggregate_proof_fragments()`.

**Fix:** Pass challenge as parameter to `aggregate_proof_fragments()`:

```rust
pub fn aggregate_proof_fragments(
    &self,
    fragments: &[ProofFragment],
    challenge: Fr,  // Same challenge used to generate fragments
) -> DistributedProof
```

## API Changes

The API now requires passing an RNG:

```rust
// Before (broken)
let system = DistributedProofSystem::new(7, 4);

// After (fixed)
let mut rng = ark_std::rand::rngs::StdRng::from_entropy();
let system = DistributedProofSystem::new(7, 4, &mut rng);
```

## Cargo.toml Dependencies

```toml
[dependencies]
ark-bn254 = "0.4"
ark-ec = "0.4"
ark-ff = "0.4"
ark-std = { version = "0.4", features = ["std"] }  # <-- std feature required
ark-serialize = "0.4"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
sha2 = "0.10"
```

## Protocol Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    SETUP PHASE                                   │
├─────────────────────────────────────────────────────────────────┤
│  1. Secret s is split into n shares using polynomial            │
│     f(x) = s + a₁x + a₂x² + ... + aₜ₋₁xᵗ⁻¹                     │
│  2. Each node i receives share (i, f(i))                        │
│  3. Public key PK = g^s is computed                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PROVING PHASE                                  │
├─────────────────────────────────────────────────────────────────┤
│  Phase 1: Each participating node i:                            │
│    - Generates random nonce rᵢ                                  │
│    - Computes commitment Cᵢ = g^rᵢ                              │
│                                                                  │
│  Phase 2: Coordinator:                                          │
│    - Computes challenge c = H(PK, C₁, ..., Cₜ)                  │
│                                                                  │
│  Phase 3: Each participating node i:                            │
│    - Computes response zᵢ = rᵢ + c · sᵢ                         │
│                                                                  │
│  Phase 4: Coordinator aggregates using Lagrange interpolation:  │
│    - C = Σ λᵢ · Cᵢ                                              │
│    - z = Σ λᵢ · zᵢ                                              │
│    - Proof = (C, c, z)                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 VERIFICATION                                     │
├─────────────────────────────────────────────────────────────────┤
│  Verifier checks: g^z = C · PK^c                                │
└─────────────────────────────────────────────────────────────────┘
```

## Security Properties

| Property | Guarantee |
|----------|-----------|
| **Threshold** | Any t nodes can prove; fewer learn nothing |
| **Privacy** | Secret is never reconstructed during proving |
| **Coordinator Blindness** | Coordinator sees only commitments, not shares |
| **Zero-Knowledge** | Verifier learns only validity, not the secret |