# Protocol Specification

This document specifies the cryptographic protocol used in the distributed prover system.

## Table of Contents

1. [Overview](#overview)
2. [Cryptographic Primitives](#cryptographic-primitives)
3. [Shamir's Secret Sharing](#shamirs-secret-sharing)
4. [Distributed Schnorr Protocol](#distributed-schnorr-protocol)
5. [Security Analysis](#security-analysis)
6. [API Specification](#api-specification)

---

## Overview

The protocol enables `n` parties to collaboratively prove knowledge of a secret `s` without any single party knowing `s`. Any `t` parties (threshold) can create a valid proof, but `t-1` parties learn nothing about the secret.

### Parameters

| Parameter | Description | Typical Value |
|-----------|-------------|---------------|
| `n` | Total number of nodes | 5-10 |
| `t` | Threshold (minimum nodes) | ⌈n/2⌉ + 1 |
| `G` | Elliptic curve group | BN254 G1 |
| `Fr` | Scalar field | BN254 Fr |
| `g` | Generator point | Random G1 point |
| `H` | Hash function | SHA-256 |

---

## Cryptographic Primitives

### Elliptic Curve: BN254

We use the BN254 (alt-bn128) curve:
- **Security level**: ~110 bits
- **Scalar field order**: `r = 21888242871839275222246405745257275088548364400416034343698204186575808495617`
- **Pairing-friendly**: Enables future extensions

### Group Operations

```
G1: Points on the curve
Fr: Scalar field elements

Operations:
- Point addition: P + Q
- Scalar multiplication: k · P  (k ∈ Fr, P ∈ G1)
- Pairing: e(P, Q) → Gt  (not used in basic protocol)
```

### Hash Function

Fiat-Shamir challenge generation:
```
H: {0,1}* → Fr

c = H(g || PK || C₁ || C₂ || ... || Cₜ)

Implementation:
1. Serialize each element to compressed bytes
2. Concatenate all bytes
3. Hash with SHA-256
4. Reduce modulo r (scalar field order)
```

---

## Shamir's Secret Sharing

### Setup Phase

Given secret `s ∈ Fr`:

1. **Generate random polynomial** of degree `t-1`:
   ```
   f(x) = s + a₁x + a₂x² + ... + aₜ₋₁x^(t-1)
   
   where a₁, ..., aₜ₋₁ ←$ Fr (random)
   ```

2. **Compute shares** for each node `i ∈ {1, ..., n}`:
   ```
   Share_i = (i, f(i))
   
   x_i = i
   y_i = f(i) = s + a₁·i + a₂·i² + ... + aₜ₋₁·i^(t-1)
   ```

3. **Distribute**:
   - Send `(x_i, y_i)` to node `i`
   - Send public parameters `(g, PK = g^s)` to all nodes
   - **Delete** secret `s` and coefficients `a₁, ..., aₜ₋₁`

### Reconstruction (Lagrange Interpolation)

Given `t` shares `{(x₁, y₁), ..., (xₜ, yₜ)}`:

1. **Compute Lagrange coefficients**:
   ```
   λᵢ = ∏_{j≠i} (xⱼ / (xⱼ - xᵢ))
   ```

2. **Interpolate at x=0**:
   ```
   s = f(0) = Σᵢ λᵢ · yᵢ
   ```

### Security Property

**Information-theoretic security**: Any `t-1` shares reveal zero information about `s`.

Proof sketch: A degree `t-1` polynomial is uniquely determined by `t` points. With only `t-1` points, any value of `s` is equally likely.

---

## Distributed Schnorr Protocol

### Standard Schnorr (Single Prover)

For reference, the standard Schnorr protocol:

```
Prover knows: s (secret)
Verifier knows: g, PK = g^s

1. Prover: r ←$ Fr, C = g^r, send C
2. Verifier: c ←$ Fr, send c
3. Prover: z = r + c·s, send z
4. Verifier: Accept if g^z = C · PK^c
```

### Distributed Schnorr (Our Protocol)

**Key insight**: Both commitment `C` and response `z` are linear in the secret!

```
C = g^r       (linear in r)
z = r + c·s   (linear in s)
```

Since Lagrange interpolation is linear, we can:
1. Generate partial commitments `Cᵢ = g^rᵢ`
2. Generate partial responses `zᵢ = rᵢ + c·sᵢ`
3. Aggregate: `C = Σλᵢ·Cᵢ`, `z = Σλᵢ·zᵢ`

The aggregated `(C, z)` is a valid Schnorr proof!

### Protocol Steps

#### Phase 1: Commitment Generation

Each participating node `i`:
```
1. Generate random nonce: rᵢ ←$ Fr
2. Compute commitment: Cᵢ = g^rᵢ
3. Store (session_id, rᵢ) locally
4. Send Cᵢ to coordinator
```

#### Phase 2: Challenge Generation (Fiat-Shamir)

Coordinator computes:
```
c = H(g || PK || C₁ || C₂ || ... || Cₜ)

// Using SHA-256:
hasher = SHA256()
hasher.update(serialize(g))
hasher.update(serialize(PK))
for each Cᵢ:
    hasher.update(serialize(Cᵢ))
hash = hasher.finalize()
c = Fr::from_le_bytes_mod_order(hash)
```

#### Phase 3: Response Generation

Each participating node `i`:
```
1. Retrieve stored nonce rᵢ for session_id
2. Compute response: zᵢ = rᵢ + c · sᵢ
3. Delete stored nonce
4. Send (Cᵢ, zᵢ) to coordinator
```

#### Phase 4: Aggregation

Coordinator:
```
1. Compute Lagrange coefficients:
   For each i ∈ participating_nodes:
       λᵢ = ∏_{j≠i} (xⱼ / (xⱼ - xᵢ))
   
   where xᵢ = node_id (1-indexed)

2. Aggregate commitment:
   C = Σᵢ λᵢ · Cᵢ

3. Aggregate response:
   z = Σᵢ λᵢ · zᵢ

4. Return proof (C, c, z)
```

### Verification

Anyone can verify:
```
Accept if: g^z = C · PK^c

Proof of correctness:
  g^z = g^(Σλᵢzᵢ)
      = g^(Σλᵢ(rᵢ + c·sᵢ))
      = g^(Σλᵢrᵢ + c·Σλᵢsᵢ)
      = g^(Σλᵢrᵢ) · g^(c·s)        // Σλᵢsᵢ = s by Lagrange
      = (Σλᵢ·Cᵢ) · PK^c            // Cᵢ = g^rᵢ, PK = g^s
      = C · PK^c ✓
```

---

## Security Analysis

### Threat Model

| Adversary | Capabilities | What they learn |
|-----------|--------------|-----------------|
| Passive node | Observes own share | Nothing about s |
| t-1 colluding nodes | Share all their data | Nothing about s |
| Passive coordinator | Sees all Cᵢ, zᵢ | Nothing about s |
| Active coordinator | Can choose nodes | Cannot forge proofs |
| Network attacker | Observes traffic | Only encrypted data |

### Security Properties

1. **Threshold Security**
   - Any `t` nodes can prove
   - `t-1` nodes learn nothing (information-theoretic)

2. **Zero-Knowledge**
   - Verifier learns only that prover knows `s`
   - Simulator can produce indistinguishable transcripts

3. **Soundness**
   - Cannot create valid proof without knowing `s`
   - Based on discrete log assumption

4. **Non-Interactive**
   - Fiat-Shamir transform in random oracle model
   - No interaction after commitment phase

### Attack Analysis

**Attack 1: Coordinator forges proof**
- Coordinator never sees shares `sᵢ`
- Only sees commitments `Cᵢ` and responses `zᵢ`
- Cannot extract `s` from these (discrete log)

**Attack 2: Node extracts secret from others**
- Each node only sees own share
- Even with `t-1` colluding nodes, `s` is hidden

**Attack 3: Replay attack**
- Session IDs prevent replay
- Fiat-Shamir binds challenge to commitments

---

## API Specification

### Node Endpoints

#### `POST /share`
Receive secret share from coordinator.

```json
Request:
{
  "node_id": 1,
  "x": "base64(Fr)",
  "y": "base64(Fr)",
  "generator": "base64(G1)",
  "public_key": "base64(G1)"
}

Response:
{
  "success": true,
  "data": "Share received"
}
```

#### `POST /commitment`
Generate commitment for proving session.

```json
Request:
{
  "session_id": "abc123"
}

Response:
{
  "success": true,
  "data": {
    "node_id": 1,
    "session_id": "abc123",
    "commitment": "base64(G1)"
  }
}
```

#### `POST /fragment`
Generate proof fragment with challenge.

```json
Request:
{
  "session_id": "abc123",
  "challenge": "base64(Fr)"
}

Response:
{
  "success": true,
  "data": {
    "node_id": 1,
    "session_id": "abc123",
    "commitment": "base64(G1)",
    "response": "base64(Fr)"
  }
}
```

### Coordinator Endpoints

#### `POST /setup`
Initialize system with secret.

```json
Request:
{
  "secret_hex": "optional hex string"
}

Response:
{
  "success": true,
  "data": {
    "nodes_configured": 5,
    "threshold": 3
  }
}
```

#### `POST /prove`
Execute distributed proving protocol.

```json
Request:
{
  "node_indices": [0, 1, 2]  // optional, defaults to first t
}

Response:
{
  "success": true,
  "data": {
    "commitment": "base64(G1)",
    "challenge": "base64(Fr)",
    "response": "base64(Fr)"
  }
}
```

#### `POST /verify`
Verify a proof.

```json
Request:
{
  "commitment": "base64(G1)",
  "challenge": "base64(Fr)",
  "response": "base64(Fr)"
}

Response:
{
  "success": true,
  "data": true
}
```

---

## References

1. Shamir, A. (1979). "How to share a secret." Communications of the ACM.
2. Schnorr, C. P. (1991). "Efficient signature generation by smart cards." Journal of Cryptology.
3. Fiat, A., & Shamir, A. (1986). "How to prove yourself." CRYPTO.
4. Gennaro, R., et al. (2016). "Threshold-optimal DSA/ECDSA signatures." CRYPTO.