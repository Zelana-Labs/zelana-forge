# Zelana Forge: Distributed Zero-Knowledge Proving System

## Table of Contents
1. [Overview](#overview)
2. [Current Architecture](#current-architecture)
3. [Cryptographic Protocol](#cryptographic-protocol)
4. [What's Actually Implemented](#whats-actually-implemented)
5. [Known Issues](#known-issues)
6. [Target Architecture](#target-architecture)
7. [Gap Analysis](#gap-analysis)
8. [Fix Plan](#fix-plan)

---

## Overview

Zelana Forge is a **distributed zero-knowledge proving system** that allows multiple prover nodes to collaboratively generate proofs without any single node knowing the full secret. The system uses **Shamir's Secret Sharing** for secret distribution and **threshold cryptography** for proof generation.

### Key Properties
- **Privacy**: No single prover sees the full secret
- **Threshold**: Only `t` out of `n` nodes needed to generate valid proofs
- **Blind Proving**: Provers never see the public witness during proof generation

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Dashboard)                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 1. Generate secret                                           │   │
│  │ 2. Generate salt (random 32 bytes)                          │   │
│  │ 3. Commit to witness: Com = SHA256(witness || salt)         │   │
│  │ 4. Send (secret, commitment) to coordinator                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       COORDINATOR (Port 8080)                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ /setup:                                                      │   │
│  │   - Receive (secret, commitment)                             │   │
│  │   - Generate random generator g                              │   │
│  │   - Compute public_key = g^secret                           │   │
│  │   - Split secret using Shamir SSS                           │   │
│  │   - Distribute shares to nodes (with commitment, NOT secret) │   │
│  │                                                              │   │
│  │ /prove:                                                      │   │
│  │   - Collect commitments Cᵢ from nodes                       │   │
│  │   - Aggregate: C_agg = Σ λᵢ·Cᵢ                              │   │
│  │   - Compute challenge: c = H(g || Com || C_agg || session)   │   │
│  │   - Collect fragments zᵢ from nodes                         │   │
│  │   - Aggregate: z_agg = Σ λᵢ·zᵢ                              │   │
│  │   - Return blind proof (C_agg, c, z_agg)                    │   │
│  │                                                              │   │
│  │ /verify:                                                     │   │
│  │   - Receive (proof, revealed_witness, salt)                  │   │
│  │   - Check: SHA256(witness || salt) == commitment             │   │
│  │   - Check: g^z_agg == C_agg · PK^c                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  PROVER NODE 1  │    │  PROVER NODE 2  │    │  PROVER NODE 3  │
│   (Port 3000)   │    │   (Port 3001)   │    │   (Port 3002)   │
│                 │    │                 │    │                 │
│ Stores:         │    │ Stores:         │    │ Stores:         │
│ - share s₁      │    │ - share s₂      │    │ - share s₃      │
│ - generator g   │    │ - generator g   │    │ - generator g   │
│ - commitment    │    │ - commitment    │    │ - commitment    │
│   hash (NOT     │    │   hash (NOT     │    │   hash (NOT     │
│   witness!)     │    │   witness!)     │    │   witness!)     │
│                 │    │                 │    │                 │
│ Computes:       │    │ Computes:       │    │ Computes:       │
│ - Cᵢ = g^rᵢ    │    │ - Cᵢ = g^rᵢ    │    │ - Cᵢ = g^rᵢ    │
│ - zᵢ = rᵢ+c·sᵢ │    │ - zᵢ = rᵢ+c·sᵢ │    │ - zᵢ = rᵢ+c·sᵢ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## Cryptographic Protocol

### The Schnorr Proof of Knowledge

The system implements a **distributed Schnorr proof** that proves: *"I know secret s such that PK = g^s"*

#### Standard (Non-Distributed) Schnorr
```
PROVER (knows s):
1. Generate random nonce: r ← Fᵣ
2. Compute commitment: C = g^r
3. Compute challenge: c = H(g || PK || C)
4. Compute response: z = r + c·s
5. Output proof: (C, c, z)

VERIFIER:
Check: g^z == C · PK^c
Expanding: g^(r + c·s) == g^r · (g^s)^c = g^(r + c·s) ✓
```

#### Distributed Schnorr (This Implementation)

```
SETUP: Secret s is split into shares (s₁, s₂, s₃) using Shamir SSS
       Property: λ₁·s₁ + λ₂·s₂ + λ₃·s₃ = s (Lagrange interpolation)

PHASE 1 - COMMITMENT: Each node i generates:
  - Random nonce: rᵢ ← Fᵣ
  - Commitment: Cᵢ = g^rᵢ
  - Sends Cᵢ to coordinator

PHASE 2 - CHALLENGE: Coordinator computes:
  - Aggregated commitment: C_agg = λ₁·C₁ + λ₂·C₂ + λ₃·C₃ = g^(λ₁r₁ + λ₂r₂ + λ₃r₃)
  - Challenge: c = H(g || commitment_hash || C_agg || session_id)
  - Sends c to all nodes

PHASE 3 - FRAGMENT: Each node i computes:
  - Response fragment: zᵢ = rᵢ + c·sᵢ
  - Sends zᵢ to coordinator

PHASE 4 - AGGREGATION: Coordinator computes:
  - z_agg = λ₁·z₁ + λ₂·z₂ + λ₃·z₃
          = λ₁(r₁ + c·s₁) + λ₂(r₂ + c·s₂) + λ₃(r₃ + c·s₃)
          = (λ₁r₁ + λ₂r₂ + λ₃r₃) + c·(λ₁s₁ + λ₂s₂ + λ₃s₃)
          = (aggregated_nonce) + c·s

VERIFICATION:
  g^z_agg == C_agg · PK^c
  g^(aggregated_nonce + c·s) == g^(aggregated_nonce) · (g^s)^c ✓
```

### Lagrange Interpolation

For threshold `t=3` nodes with indices {1, 2, 3}:

```
λ₁ = (0-2)(0-3) / (1-2)(1-3) = 6 / 2 = 3
λ₂ = (0-1)(0-3) / (2-1)(2-3) = 3 / -1 = -3
λ₃ = (0-1)(0-2) / (3-1)(3-2) = 2 / 2 = 1

Verification: λ₁·s₁ + λ₂·s₂ + λ₃·s₃ = s (reconstructs secret at x=0)
```

---

## What's Actually Implemented

### Crate Structure

```
crates/
├── prover-core/          # Cryptographic primitives
│   ├── shamir.rs         # Shamir secret sharing
│   ├── schnorr.rs        # Schnorr proof types
│   ├── commitment.rs     # Witness commitment (SHA256)
│   └── hash_preimage.rs  # Hash preimage circuit (incomplete)
│
├── prover-network/       # Network message types
│   └── messages.rs       # All API request/response types
│
├── prover-coordinator/   # Orchestrator service
│   └── main.rs           # HTTP server, proof aggregation
│
├── prover-node/          # Prover node service
│   └── main.rs           # Share storage, fragment generation
│
└── prover-control/       # Cluster management
    └── main.rs           # Docker/process management
```

### What Each Component Actually Does

| Component | What It's Supposed To Do | What It Actually Does |
|-----------|-------------------------|----------------------|
| **Client** | Commit to public witness, send secret | ✅ Works correctly |
| **Coordinator Setup** | Split secret, distribute shares | ✅ Works correctly |
| **Coordinator Prove** | Aggregate commitments/fragments | ⚠️ Potential ordering bug |
| **Coordinator Verify** | Check Schnorr equation | ✅ Fixed (uses stored PK) |
| **Prover Node** | Generate Cᵢ and zᵢ | ✅ Works correctly |

### Data Flow Summary

```
CLIENT                    COORDINATOR                 NODES
  │                           │                         │
  │──(secret, commitment)────▶│                         │
  │                           │──(share_i, g, Com)─────▶│
  │                           │                         │
  │──(prove request)─────────▶│                         │
  │                           │──(commitment req)──────▶│
  │                           │◀──(Cᵢ)─────────────────│
  │                           │                         │
  │                           │ [compute challenge c]   │
  │                           │                         │
  │                           │──(fragment req, c)─────▶│
  │                           │◀──(zᵢ)─────────────────│
  │                           │                         │
  │                           │ [aggregate proof]       │
  │◀──(blind proof)──────────│                         │
  │                           │                         │
  │──(verify: witness, salt)─▶│                         │
  │◀──(valid/invalid)────────│                         │
```

---

## Known Issues

### Issue 1: Lagrange Coefficient Ordering (CRITICAL)

**Location**: `crates/prover-coordinator/src/main.rs:363-372`

**Problem**: The coordinator collects responses from nodes, but nodes might respond in any order. The Lagrange coefficients are computed based on `node_id`, but applied based on array position.

```rust
// x_coords based on node_id from responses
let x_coords: Vec<Fr> = commitment_responses
    .iter()
    .map(|r| Fr::from(r.node_id as u64))
    .collect();

// But coefficients applied by array index i, not node_id!
for (i, resp) in commitment_responses.iter().enumerate() {
    let coeff = lagrange_coefficient(&x_coords, i);  // Uses position i
    agg_commitment += resp.commitment * coeff;
}
```

If responses come back out of order, the wrong Lagrange coefficient gets applied to each response.

**Fix**: Sort responses by node_id OR compute coefficient based on node_id directly.

### Issue 2: No Circuit Abstraction

**Problem**: The system is hardcoded for Schnorr proofs. There's no clean abstraction for plugging in different circuits.

**Current State**:
- `CircuitType` enum exists but only `Schnorr` is functional
- `HashPreimage` has partial code but doesn't work
- No trait-based circuit abstraction

### Issue 3: Challenge Not Verified

**Problem**: During verification, we don't re-derive the challenge from the public parameters. An attacker could potentially submit a proof with a different challenge.

**Current Code**:
```rust
// Verification just uses the challenge from the proof
let valid = lhs == rhs;  // Uses request.blind_proof.challenge as-is
```

**Should Do**: Re-compute challenge from (g, commitment_hash, C_agg, session_id) and verify it matches.

### Issue 4: Public Key Sent in Proof

**Problem**: The proof contains the generator, but verification fetches the public key from session storage. This creates a dependency on session state during verification.

**Better Design**: Include public_key in the BlindProof struct, or verify statelessly.

---

## Target Architecture

### What We Want: Pluggable Circuit System

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CIRCUIT ABSTRACTION                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ trait DistributedCircuit {                                   │   │
│  │   fn setup(secret, params) -> CircuitState;                  │   │
│  │   fn generate_share_assignment(state, share) -> Assignment;  │   │
│  │   fn compute_node_commitment(state) -> Commitment;           │   │
│  │   fn compute_node_fragment(state, challenge) -> Fragment;    │   │
│  │   fn aggregate(commitments, fragments) -> Proof;             │   │
│  │   fn verify(proof, public_inputs) -> bool;                   │   │
│  │ }                                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐          │
│  │ SchnorrCircuit│  │HashPreimage   │  │ RangeProof    │  ...     │
│  │ impl Circuit  │  │impl Circuit   │  │ impl Circuit  │          │
│  └───────────────┘  └───────────────┘  └───────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

### Target Circuit Types

| Circuit | Statement | Public Inputs | Private Witness |
|---------|-----------|---------------|-----------------|
| **Schnorr** | "I know s such that PK = g^s" | Generator g, Public Key PK | Secret s |
| **Hash Preimage** | "I know x such that H(x) = y" | Target hash y | Preimage x |
| **Range Proof** | "v ∈ [min, max]" | Commitment C, Range [min,max] | Value v, Randomness r |
| **Merkle Membership** | "leaf ∈ Tree(root)" | Merkle root, Leaf | Merkle path |

---

## Gap Analysis

| Feature | Current State | Target State | Gap |
|---------|--------------|--------------|-----|
| **Schnorr Circuit** | Implemented (bugs) | Working | Fix ordering bug |
| **Hash Preimage** | UI only | Working | Implement backend |
| **Circuit Abstraction** | None | Trait-based | Design & implement |
| **Verification** | Session-dependent | Stateless | Refactor |
| **Challenge Verification** | Not checked | Re-derived | Add check |
| **Error Handling** | Basic | Comprehensive | Improve |
| **Testing** | Unit only | E2E tests | Add integration tests |

---

## Fix Plan

### Phase 1: Fix Current Schnorr Implementation

1. **Fix Lagrange coefficient ordering** - Sort responses by node_id
2. **Add debug logging** - Log all intermediate values
3. **Re-derive challenge in verification** - Don't trust proof's challenge

### Phase 2: Create Circuit Abstraction

1. **Define `DistributedCircuit` trait**
2. **Implement `SchnorrCircuit`** - Extract from current code
3. **Implement `HashPreimageCircuit`**
4. **Refactor coordinator to use trait**

### Phase 3: Stateless Verification

1. **Include all data in proof** - No session lookup needed
2. **Re-derive challenge from public parameters**
3. **Support offline verification**

### Phase 4: Additional Circuits

1. **Range proofs** - Bulletproofs or similar
2. **Merkle membership** - For allowlist proofs
3. **Custom circuits** - User-defined constraints

---

## File Reference

### Key Files

| File | Purpose |
|------|---------|
| `crates/prover-core/src/shamir.rs` | Shamir secret sharing, Lagrange coefficients |
| `crates/prover-core/src/schnorr.rs` | Schnorr proof types and aggregation |
| `crates/prover-core/src/commitment.rs` | Witness commitment (SHA256) |
| `crates/prover-coordinator/src/main.rs` | HTTP server, proof orchestration |
| `crates/prover-node/src/main.rs` | Node state, fragment generation |
| `dashboard/app/components/WorkflowPanel.tsx` | UI workflow |
| `dashboard/app/utils/crypto.ts` | Client-side crypto |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/setup` | POST | Initialize secret sharing |
| `/prove` | POST | Generate distributed proof |
| `/verify` | POST | Verify proof with witness reveal |

---

## Quick Start (After Fixes)

```bash
# Start the cluster
./scripts/start-cluster.sh

# Start dashboard
./scripts/start-dashboard.sh

# In dashboard:
# 1. Click "Setup System" - splits secret
# 2. Click "Generate Proof" - creates distributed proof
# 3. Click "Verify Proof" - validates with witness reveal
```

---

## Contributing

When adding new circuits:

1. Implement the circuit in `crates/prover-core/src/`
2. Add message types to `crates/prover-network/src/messages.rs`
3. Add circuit handling in coordinator and nodes
4. Add UI in dashboard
5. Write tests in `tests/`
