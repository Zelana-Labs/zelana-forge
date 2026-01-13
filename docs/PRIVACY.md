# Privacy & Security Analysis

## Overview

This document provides a comprehensive analysis of the privacy-preserving properties of the Zelana Distributed ZK Prover system, demonstrating how the secret key remains protected throughout the entire workflow.

## Table of Contents

1. [Threat Model](#threat-model)
2. [Secret Sharing Phase (Setup)](#secret-sharing-phase-setup)
3. [Proof Generation Phase](#proof-generation-phase)
4. [Verification Phase](#verification-phase)
5. [Attack Scenarios & Defenses](#attack-scenarios--defenses)
6. [Security Guarantees](#security-guarantees)
7. [Information Leakage Analysis](#information-leakage-analysis)

---

## Threat Model

### Assumptions

- **Honest Threshold**: At most `t-1` nodes are malicious (where `t` is the threshold parameter, default: 3)
- **Secure Channels**: Communication between coordinator and nodes uses TLS/secure channels
- **Trusted Setup Coordinator**: The coordinator performs setup honestly but immediately discards the secret
- **Byzantine Adversary**: Malicious nodes may deviate from protocol arbitrarily

### What We Protect Against

✅ **Passive Adversaries**: Eavesdropping on network traffic
✅ **Curious Nodes**: Honest-but-curious nodes trying to learn the secret
✅ **Node Compromise**: Up to `t-1` nodes completely compromised
✅ **Collusion**: Multiple compromised nodes sharing their data

### What's Out of Scope

❌ **Coordinator Compromise During Setup**: If coordinator is compromised during setup, the secret is revealed (but only at that moment)
❌ **Threshold Compromise**: If `t` or more nodes are compromised, secret can be reconstructed
❌ **Side-Channel Attacks**: Timing attacks, power analysis, etc. (implementation-specific)

---

## Secret Sharing Phase (Setup)

### What Happens

1. **Coordinator receives secret** `s` (256-bit scalar)
2. **Generates polynomial**: `f(x) = s + a₁x + a₂x² + ... + aₜ₋₁x^(t-1)` where coefficients `aᵢ` are random
3. **Computes shares**: For each node `i`, compute `shareᵢ = f(i)`
4. **Distributes shares**: Send `(i, shareᵢ)` to node `i`
5. **Discards secret**: Coordinator deletes `s` and all coefficients from memory

### Privacy Properties

#### 1. **Perfect Information-Theoretic Security**

For any `k < t` shares, the secret remains **perfectly** hidden:

```
Theorem (Shamir's Secret Sharing):
For any k < t shares {(i₁, s₁), ..., (iₖ, sₖ)} and ANY two secrets s and s',
there exist valid polynomials f and f' such that:
  - f(0) = s  and f(iⱼ) = sⱼ for all j
  - f'(0) = s' and f'(iⱼ) = sⱼ for all j

Therefore: P(secret = s | k shares) = P(secret = s') for ANY s, s'
```

**Implication**: Even with infinite computational power, an adversary with `< t` shares learns **NOTHING** about the secret.

#### 2. **Share Indistinguishability**

Each share `shareᵢ` is a uniformly random field element (from the adversary's perspective):

```
shareᵢ = f(i) = s + a₁·i + a₂·i² + ... + aₜ₋₁·i^(t-1)
       = s + (a₁·i + a₂·i² + ... + aₜ₋₁·i^(t-1))
           └─────────────┬─────────────┘
                 uniformly random
```

Since the polynomial coefficients `a₁, ..., aₜ₋₁` are chosen uniformly at random, each share appears completely random.

#### 3. **No Correlation Between Shares**

Shares held by different nodes reveal no information about each other:

```
For nodes i and j:
Cov(shareᵢ, shareⱼ) when s is unknown = 0

Any correlation comes from the shared secret s, which
remains hidden with < t shares.
```

### What's Sent Over Network

```json
{
  "node_id": 1,
  "share_index": 1,
  "share_value": "<base64-encoded-field-element>",  // ← Appears random!
  "generator": "g",
  "public_key": "g^s"  // ← Discrete log problem prevents secret recovery
}
```

**Privacy Check**: ✅ No information about `s` is leaked
**What adversary learns**: Random-looking field elements and public parameters (which are safe)

---

## Proof Generation Phase

### What Happens

1. **Phase 1 - Commitment**: Each node generates random nonce `rᵢ` and sends `Cᵢ = g^(rᵢ)` to coordinator
2. **Phase 2 - Challenge**: Coordinator computes Fiat-Shamir challenge `c = H(g || PK || C₁ || ... || Cₜ || msg)`
3. **Phase 3 - Response**: Each node computes `zᵢ = rᵢ + c·shareᵢ` and sends to coordinator
4. **Phase 4 - Aggregation**: Coordinator aggregates using Lagrange coefficients

### Privacy Properties

#### 1. **Zero-Knowledge Property**

The proof reveals **nothing** about the secret beyond the public statement "I know s such that PK = g^s":

**Simulator Experiment**:
```
Given only (g, g^s), a simulator can produce transcripts
(C, c, z) that are indistinguishable from real protocol transcripts.

Simulator:
1. Pick random c, z
2. Compute C = g^z / (g^s)^c
3. Program H to output c on input (g, g^s, C, msg)

This proves the protocol leaks no information about s!
```

#### 2. **Nonce Masking**

Each node's response is masked by a one-time random nonce:

```
zᵢ = rᵢ + c·shareᵢ
     ↑        ↑
   random   secret share
```

**Key property**: The nonce `rᵢ` is chosen fresh for each proof and perfectly masks the share.

```
Theorem: For any shareᵢ, shareᵢ', and zᵢ, there exists an rᵢ such that:
  zᵢ = rᵢ + c·shareᵢ = rᵢ' + c·shareᵢ'

Therefore: zᵢ reveals NOTHING about shareᵢ
```

#### 3. **Node Isolation**

Each node only sees:
- Their own share `shareᵢ`
- The public challenge `c`
- Their own nonce `rᵢ`

They **never** see:
- Other nodes' shares
- Other nodes' nonces
- The original secret `s`

### What's Sent Over Network

**Phase 1**:
```json
{
  "node_id": 1,
  "commitment": "g^(r1)"  // ← Random group element, reveals nothing
}
```

**Phase 3**:
```json
{
  "node_id": 1,
  "response": "r1 + c·share1"  // ← Masked by random nonce!
}
```

**Privacy Check**: ✅ Share remains hidden by random nonce
**Privacy Check**: ✅ Commitment is random group element

---

## Verification Phase

### What Happens

Verifier checks: `g^z = C · (g^s)^c`

### Privacy Properties

#### 1. **Public Verification**

Verification uses only public information:
- Proof `(C, c, z)`
- Public key `PK = g^s`
- Generator `g`

**No secret information is revealed during verification.**

#### 2. **Soundness**

An adversary without the secret cannot forge a valid proof:

```
Theorem (Schnorr Soundness):
If an adversary can produce two valid proofs (C, c, z) and (C, c', z')
for the same commitment C with c ≠ c', then the adversary
can compute s = (z - z') / (c - c').

Since finding such collisions is hard (Fiat-Shamir), the protocol
is sound.
```

---

## Attack Scenarios & Defenses

### Attack 1: Compromising < t Nodes

**Scenario**: Adversary compromises 2 out of 5 nodes (threshold = 3).

**What adversary learns**:
- `share₁` and `share₂`
- All nonces `r₁` and `r₂` used in proofs

**What adversary CANNOT learn**:
- The secret `s`
- Other shares
- Anything beyond what 2 random field elements reveal (which is nothing!)

**Defense**: ✅ Information-theoretic security from Shamir's Secret Sharing

---

### Attack 2: Network Eavesdropping

**Scenario**: Adversary intercepts all network traffic.

**What adversary sees**:
```
Setup: share distributions (encrypted via TLS)
Proof Phase 1: {C₁, C₂, ..., Cₜ} (random group elements)
Proof Phase 3: {z₁, z₂, ..., zₜ} (masked responses)
```

**What adversary CANNOT learn**:
- The secret `s` (never transmitted)
- Individual shares (encrypted, and useless without threshold)
- Any information from commitments (discrete log problem)
- Any information from responses (masked by random nonces)

**Defense**: ✅ Secure channels + cryptographic masking

---

### Attack 3: Malicious Coordinator

**Scenario**: Coordinator is malicious during proof generation (not setup).

**What malicious coordinator can do**:
- Learn all commitments `{C₁, ..., Cₜ}`
- Learn all responses `{z₁, ..., zₜ}`
- Observe all communications

**What malicious coordinator CANNOT do**:
- Recover the secret (responses are masked by nonces)
- Learn individual shares (need nonces, which are never sent)

**Defense**: ✅ Cryptographic masking with one-time nonces

**Note**: If coordinator is malicious **during setup**, it has access to the secret at that moment. However, setup is a one-time operation and can be performed in a secure environment.

---

### Attack 4: Proof Transcript Analysis

**Scenario**: Adversary collects many proof transcripts.

**What adversary learns from N proofs**:
```
Proof 1: (C₁, c₁, z₁)
Proof 2: (C₂, c₂, z₂)
...
Proof N: (Cₙ, cₙ, zₙ)
```

**Analysis**:
- Each proof uses fresh random nonces → transcripts are independent
- Fiat-Shamir heuristic ensures challenges are unpredictable
- Each response is masked by a different random nonce

**What adversary CANNOT do**:
- Correlate proofs to learn about shares
- Extract any information about the secret

**Defense**: ✅ Fresh randomness per proof + zero-knowledge property

---

## Security Guarantees

### Proven Security Properties

| Property | Guarantee | Basis |
|----------|-----------|-------|
| **Secret Privacy** | Information-theoretic | Shamir's Secret Sharing |
| **Zero-Knowledge** | Computational | Schnorr protocol + Fiat-Shamir |
| **Soundness** | Computational | Discrete Log hardness |
| **Share Privacy** | Perfect | Polynomial randomness |
| **Nonce Masking** | Perfect | One-time pad property |

### Security Parameters

```
Field: BLS12-381 scalar field (255 bits)
Group: G1 of BLS12-381 (elliptic curve pairing-friendly)
Hash: SHA-256 (Fiat-Shamir)
Threshold: 3 of 5 (configurable)
```

**Security Level**: ~128 bits (conservative estimate)

---

## Information Leakage Analysis

### What Each Party Learns

| Party | Information Available | Can Recover Secret? |
|-------|----------------------|-------------------|
| **Node (honest)** | Own share, commitments, challenge | ❌ No (needs t shares) |
| **Node (malicious, < t)** | Up to t-1 shares, all public info | ❌ No (information-theoretic) |
| **Coordinator (setup)** | Secret s (at setup time only) | ✅ Yes (but discarded) |
| **Coordinator (proof)** | All commitments, all responses | ❌ No (nonce masking) |
| **Network adversary** | All public messages | ❌ No (crypto + masking) |
| **Verifier** | Proof (C, c, z), public key | ❌ No (zero-knowledge) |

### Information Flow Diagram

```
                         ┌─────────────┐
                         │   Secret s  │
                         └──────┬──────┘
                                │
                          [Shamir Split]
                                │
            ┌───────────────────┼───────────────────┐
            │                   │                   │
            ▼                   ▼                   ▼
      ┌─────────┐         ┌─────────┐        ┌─────────┐
      │ Share 1 │         │ Share 2 │        │ Share n │
      │  (Node  1)│        │ (Node 2)│        │ (Node n)│
      └────┬────┘         └────┬────┘        └────┬────┘
           │                   │                   │
      [+ random r₁]       [+ random r₂]       [+ random rₙ]
           │                   │                   │
           ▼                   ▼                   ▼
      ┌─────────┐         ┌─────────┐        ┌─────────┐
      │   z₁    │         │   z₂    │        │   zₙ    │
      └────┬────┘         └────┬────┘        └────┬────┘
           │                   │                   │
           └───────────┬───────┴───────────────────┘
                       │
                  [Aggregate]
                       │
                       ▼
                ┌────────────┐
                │Final Proof │  ← No secret information!
                │   (C,c,z)  │
                └────────────┘
```

**Key Insight**: At every step, either the information is split (shares) or masked (nonces). The secret is never exposed.

---

## Conclusion

The Zelana Distributed ZK Prover system provides **strong privacy guarantees**:

1. ✅ **Secret never reconstructed** during normal operations
2. ✅ **Information-theoretic security** for shares (< threshold)
3. ✅ **Zero-knowledge proofs** reveal nothing beyond validity
4. ✅ **Perfect masking** via one-time random nonces
5. ✅ **Threshold security** protects against node compromise

The system is designed with defense-in-depth:
- Multiple cryptographic layers (secret sharing + Schnorr + nonces)
- Information-theoretic security (not just computational)
- Fresh randomness for every proof
- Secure by design (minimal trust assumptions)

**Bottom Line**: As long as fewer than `threshold` nodes are compromised, the secret remains perfectly hidden. No amount of computation, eavesdropping, or analysis can reveal it.
