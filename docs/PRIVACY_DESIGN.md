# Public Witness Privacy Design

## Problem Statement

**Current Vulnerability**: Prover nodes receive the full public witness during proof generation, leaking intent and violating privacy requirements for MEV-sensitive use cases.

**Core Principle**: "Public to the verifier" ≠ "Public to provers"

No single prover (and ideally not the coordinator) should learn the full public witness during proving.

---

## Proposed Solution: Commit-Then-Prove Protocol

### Architecture Overview

We use a **commitment-based protocol** where:
1. Client commits to public witness before distribution
2. Provers generate fragments blind to actual public inputs
3. Public witness is revealed only at verification time
4. Coordinator sees only commitments, not actual data

### Protocol Phases

#### Phase 0: Client-Side Commitment (NEW)

```
Client Actions:
1. Generate random salt: salt ← Random(32 bytes)
2. Compute commitment: Com = SHA256(public_witness || salt)
3. Create witness package:
   - Private: secret shares (via Shamir)
   - Public: commitment Com only
```

**Who Learns What:**
- Client: Everything (public_witness, salt, secret, shares)
- Coordinator: Only commitment Com
- Provers: Nothing yet
- Verifier: Nothing yet

#### Phase 1: Share Distribution

```
Coordinator Actions:
1. Receive Com from client
2. Generate session_id
3. Distribute to each prover i:
   - share_i (secret share)
   - Com (commitment)
   - session_id

Note: Provers receive shares but NOT the public witness
```

**Who Learns What:**
- Prover i: share_i, Com (cannot deduce public_witness from Com)
- Coordinator: Com, session_id (still blind to actual witness)

#### Phase 2: Commitment Phase (Existing, Modified)

```
Each Prover i:
1. Generate random nonce r_i
2. Compute commitment: C_i = g^r_i
3. Return CommitmentResponse(node_id, session_id, C_i)

Coordinator:
1. Collect commitments from threshold provers
2. Aggregate: C_agg = Σ(λ_i · C_i) using Lagrange
```

**Unchanged from current protocol**

#### Phase 3: Challenge Computation (MODIFIED)

```
Coordinator Actions:
1. Compute Fiat-Shamir challenge using COMMITMENT:
   challenge = H(generator || Com || C_agg || session_id)

   NOT: challenge = H(generator || public_witness || C_agg)

2. Broadcast challenge to all provers

Key Change: Challenge is computed from Com, not public_witness
```

**Who Learns What:**
- Provers: challenge (derived from Com, not revealing public_witness)
- Coordinator: challenge, Com (still blind)

#### Phase 4: Fragment Generation (Existing)

```
Each Prover i:
1. Receive challenge c
2. Compute response: z_i = r_i + c · share_i
3. Return FragmentResponse(node_id, session_id, z_i)

Coordinator:
1. Aggregate responses: z = Σ(λ_i · z_i)
2. Create proof: (C_agg, challenge, z)
```

**Unchanged from current protocol**

#### Phase 5: Proof Packaging (NEW)

```
Coordinator:
1. Create BlindProof:
   - commitment_witness: Com
   - commitment_proof: C_agg
   - challenge: c
   - response: z
   - metadata: generator, session_id

2. Return to client WITHOUT public_witness
```

#### Phase 6: Verification (MODIFIED)

```
Verifier Actions (Client or Third Party):
1. Client reveals: (public_witness, salt)
2. Verifier checks commitment:
   Com_check = SHA256(public_witness || salt)
   Require: Com_check == Com (from proof)

3. Recompute challenge using revealed witness:
   challenge_check = H(generator || public_witness || C_agg || session_id)

4. Verify Schnorr equation:
   g^z == C_agg · (public_key)^challenge

5. Accept if all checks pass
```

**Who Learns What:**
- Verifier: Everything (public_witness, salt, proof)
- This is acceptable - verifier is the intended recipient

---

## Data Visibility Matrix

| Party       | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
|-------------|---------|---------|---------|---------|---------|---------|---------|
| **Client**  | All     | All     | All     | All     | All     | All     | All     |
| **Coordinator** | Com | Com, session | Com, C_agg | Com, challenge | Com, fragments | BlindProof | - |
| **Prover i** | - | share_i, Com | C_i | challenge | z_i | - | - |
| **Verifier** | - | - | - | - | - | - | public_witness, salt, proof |

**Key Properties:**
- ✅ No prover learns public_witness
- ✅ Coordinator learns only Com (one-way commitment)
- ✅ Verifier gets everything (intended recipient)
- ✅ Provers cannot collude to learn public_witness from (Com, challenge, shares)

---

## Security Analysis

### Threat Model

**Adversary Capabilities:**
1. **Malicious Prover**: Controls up to (threshold - 1) provers
2. **Malicious Coordinator**: Honest-but-curious coordinator
3. **Network Adversary**: Can observe all messages

**Security Goals:**
1. **Public Witness Hiding**: No adversary learns public_witness before verification
2. **Secret Share Security**: Existing Shamir security maintained
3. **Soundness**: Cannot forge proofs for false statements
4. **Completeness**: Honest execution produces valid proofs

### Security Guarantees

#### 1. Public Witness Hiding

**Claim**: No coalition of (threshold - 1) provers + coordinator can learn public_witness.

**Proof Sketch**:
- Provers see: (share_i, Com, challenge)
- Com = SHA256(public_witness || salt) - preimage resistant
- challenge = H(generator || Com || C_agg || session_id) - no public_witness
- Shares reveal nothing about public_witness (independent secrets)
- ∴ public_witness remains hidden until Phase 6 ✓

#### 2. Binding Property

**Claim**: Client cannot prove two different statements with same Com.

**Proof Sketch**:
- Com = SHA256(public_witness || salt) - collision resistant
- Challenge is bound to Com
- Proof verification requires revealing (public_witness, salt) that hashes to Com
- ∴ Client is committed to single public_witness ✓

#### 3. Soundness Preservation

**Claim**: Commit-then-prove doesn't weaken soundness of underlying protocol.

**Proof Sketch**:
- Verification includes commitment check: H(public_witness || salt) == Com
- Challenge recomputation uses revealed public_witness
- Schnorr verification uses revealed public_witness
- ∴ Soundness equivalent to revealing-first protocol ✓

---

## Implementation Changes

### 1. New Message Types (`prover-network/src/messages.rs`)

```rust
/// Commitment to public witness (Phase 0)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WitnessCommitment {
    /// SHA256(public_witness || salt)
    pub commitment: [u8; 32],
    /// Session identifier
    pub session_id: String,
}

/// Blinded setup request (Phase 1)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlindSetupRequest {
    /// Commitment to public witness
    pub witness_commitment: WitnessCommitment,
    /// Circuit type
    pub circuit_type: CircuitType,
}

/// Proof with commitment (Phase 5)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlindProof {
    /// Commitment to public witness
    pub witness_commitment: [u8; 32],
    /// The actual proof
    pub proof: NetworkProof,
}

/// Verification request with reveal (Phase 6)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyWithRevealRequest {
    /// The blinded proof
    pub blind_proof: BlindProof,
    /// Revealed public witness
    pub public_witness: Vec<u8>,
    /// Salt used in commitment
    pub salt: [u8; 32],
}
```

### 2. Core Crypto Changes (`prover-core/src/`)

**New file: `prover-core/src/commitment.rs`**

```rust
/// Commit to public witness
pub fn commit_witness(public_witness: &[u8], salt: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(public_witness);
    hasher.update(salt);
    hasher.finalize().into()
}

/// Verify commitment
pub fn verify_commitment(
    public_witness: &[u8],
    salt: &[u8; 32],
    commitment: &[u8; 32],
) -> bool {
    let computed = commit_witness(public_witness, salt);
    computed == *commitment
}

/// Generate challenge from commitment (not public witness)
pub fn generate_challenge_from_commitment(
    generator: &G1Affine,
    witness_commitment: &[u8; 32],
    aggregated_commitment: &G1Affine,
    session_id: &str,
) -> Result<Fr, ProverError> {
    let mut hasher = Sha256::new();

    // Hash generator
    let mut gen_bytes = Vec::new();
    generator.serialize_compressed(&mut gen_bytes)?;
    hasher.update(&gen_bytes);

    // Hash witness commitment (NOT public witness)
    hasher.update(witness_commitment);

    // Hash aggregated commitment
    let mut commit_bytes = Vec::new();
    aggregated_commitment.serialize_compressed(&mut commit_bytes)?;
    hasher.update(&commit_bytes);

    // Hash session ID
    hasher.update(session_id.as_bytes());

    let hash = hasher.finalize();
    Ok(hash_to_field(&hash))
}
```

### 3. Coordinator Changes (`prover-network/src/coordinator.rs`)

**Modified challenge computation:**

```rust
// OLD (LEAKS PUBLIC WITNESS):
let challenge = schnorr::generate_challenge(
    &generator,
    &public_key,  // ← derived from public witness
    &commitments,
    message,      // ← public witness
)?;

// NEW (PRIVACY-PRESERVING):
let challenge = commitment::generate_challenge_from_commitment(
    &generator,
    &witness_commitment,  // ← hash, not actual witness
    &aggregated_commitment,
    &session_id,
)?;
```

### 4. Node Changes (`prover-network/src/node.rs`)

**Nodes receive commitment instead of witness:**

```rust
// OLD:
struct ShareAssignment {
    share_value: Fr,
    public_key: G1Affine,  // ← reveals info about witness
}

// NEW:
struct BlindShareAssignment {
    share_value: Fr,
    witness_commitment: [u8; 32],  // ← only commitment
    generator: G1Affine,
}
```

### 5. Frontend Changes (`dashboard/app/`)

**New API endpoints:**

```typescript
// POST /api/setup-blind
interface BlindSetupRequest {
  witness_commitment: string; // hex
  circuit_type: 'schnorr' | 'hash-preimage';
  session_id: string;
}

// POST /api/prove-blind
interface BlindProveRequest {
  session_id: string;
  message: string; // kept locally, not sent
}

// POST /api/verify-reveal
interface VerifyRevealRequest {
  blind_proof: BlindProof;
  public_witness: string;
  salt: string; // hex
}
```

**Client-side commitment:**

```typescript
// In WorkflowPanel.tsx
async function setupBlindProof(publicWitness: string, circuitType: string) {
  // Generate salt locally
  const salt = crypto.getRandomValues(new Uint8Array(32));

  // Compute commitment locally
  const commitment = await sha256(
    concat(encode(publicWitness), salt)
  );

  // Store salt for later reveal
  sessionStorage.setItem('proof-salt', toHex(salt));
  sessionStorage.setItem('public-witness', publicWitness);

  // Send only commitment to coordinator
  const response = await fetch('/api/setup-blind', {
    method: 'POST',
    body: JSON.stringify({
      witness_commitment: toHex(commitment),
      circuit_type: circuitType,
      session_id: generateSessionId(),
    }),
  });
}
```

---

## Dashboard Visualization

### Privacy Panel (New Component)

**File**: `dashboard/app/components/PrivacyPanel.tsx`

```typescript
interface DataVisibility {
  party: 'Client' | 'Coordinator' | 'Prover' | 'Verifier';
  phase: string;
  canSee: string[];
  cannotSee: string[];
}

const VISIBILITY_MATRIX: DataVisibility[] = [
  {
    party: 'Client',
    phase: 'All Phases',
    canSee: ['Public Witness', 'Salt', 'Secret', 'Shares', 'Proof'],
    cannotSee: [],
  },
  {
    party: 'Coordinator',
    phase: 'Setup → Aggregation',
    canSee: ['Commitment Hash', 'Session ID', 'Aggregated Values'],
    cannotSee: ['Public Witness', 'Salt', 'Individual Shares'],
  },
  {
    party: 'Prover',
    phase: 'Proving',
    canSee: ['Own Share', 'Commitment Hash', 'Challenge'],
    cannotSee: ['Public Witness', 'Salt', 'Other Shares', 'Secret'],
  },
  {
    party: 'Verifier',
    phase: 'Verification',
    canSee: ['Public Witness', 'Salt', 'Proof', 'All Public Data'],
    cannotSee: ['Secret', 'Individual Shares'],
  },
];

export function PrivacyPanel() {
  return (
    <div className="privacy-matrix">
      <h2>Data Visibility by Party</h2>
      <table>
        <thead>
          <tr>
            <th>Party</th>
            <th>Phase</th>
            <th>Visible Data</th>
            <th>Hidden Data</th>
          </tr>
        </thead>
        <tbody>
          {VISIBILITY_MATRIX.map((row, i) => (
            <tr key={i}>
              <td className="font-bold">{row.party}</td>
              <td>{row.phase}</td>
              <td className="text-green-600">
                {row.canSee.join(', ')}
              </td>
              <td className="text-red-600">
                {row.cannotSee.join(', ') || 'None'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="privacy-guarantees">
        <h3>Privacy Guarantees</h3>
        <ul>
          <li>✅ No prover learns public witness</li>
          <li>✅ Coordinator sees only cryptographic commitments</li>
          <li>✅ Provers cannot collude to reconstruct witness</li>
          <li>✅ Public witness revealed only to verifier</li>
        </ul>
      </div>
    </div>
  );
}
```

### Protocol Flow Visualization

**File**: `dashboard/app/components/ProtocolFlowDiagram.tsx`

Shows data flow with privacy annotations:

```
[Client]
   ↓ (public_witness, salt)
   ↓ COMPUTE: Com = H(witness || salt)
   ↓
[Coordinator] ← (Com only)
   ↓ (Com, shares)
   ↓
[Provers] ← (share_i, Com)
   ↓ (blind fragments)
   ↓
[Coordinator] ← (aggregated)
   ↓ (BlindProof + Com)
   ↓
[Client] → [Verifier]
   ↓ (public_witness, salt, proof)
   VERIFY: H(witness || salt) == Com
```

---

## Privacy Checklist

### Pre-Deployment Requirements

- [ ] **PV-1**: No prover receives raw public witness
  - Verify: Audit all `ShareAssignment` messages
  - Test: Log all node-received data, confirm no witness leaks

- [ ] **PV-2**: No prover can reconstruct public witness from messages
  - Verify: Challenge computed from `Com`, not witness
  - Test: Attempt reconstruction attack with (threshold-1) provers

- [ ] **PV-3**: Coordinator doesn't learn public witness
  - Verify: All coordinator endpoints receive only commitments
  - Test: Monitor coordinator logs for witness values

- [ ] **PV-4**: Commitment is cryptographically binding
  - Verify: SHA-256 used (collision-resistant)
  - Test: Cannot produce two witnesses with same commitment

- [ ] **PV-5**: Commitment is hiding
  - Verify: Preimage resistance of SHA-256
  - Test: Cannot deduce witness from commitment alone

- [ ] **PV-6**: Salt has sufficient entropy
  - Verify: 256 bits from CSPRNG
  - Test: Check randomness quality of salt generation

- [ ] **PV-7**: Verification checks commitment
  - Verify: `H(witness || salt) == Com` enforced
  - Test: Reject proofs with invalid commitment reveals

- [ ] **PV-8**: No timing side-channels
  - Verify: Constant-time comparisons for commitment checks
  - Test: Timing analysis of verification

- [ ] **PV-9**: Network messages encrypted
  - Verify: TLS for all coordinator ↔ node communication
  - Test: Network traffic analysis shows no plaintext

- [ ] **PV-10**: Client-side commitment generation
  - Verify: Commitment computed in browser, not server
  - Test: Code review of frontend crypto

### Security Audit Checklist

- [ ] **SA-1**: Formal security proof reviewed
- [ ] **SA-2**: Implementation matches specification
- [ ] **SA-3**: Cryptographic primitives use standard libraries
- [ ] **SA-4**: No custom crypto implementations
- [ ] **SA-5**: Key material securely erased after use
- [ ] **SA-6**: Error messages don't leak witness information
- [ ] **SA-7**: Logs sanitized (no sensitive data logged)
- [ ] **SA-8**: Fuzz testing of commitment/reveal logic
- [ ] **SA-9**: Third-party security audit completed
- [ ] **SA-10**: Threat model validated against use case

### MEV-Specific Requirements

- [ ] **MEV-1**: Transaction details hidden from provers
  - Provers cannot see: token amounts, addresses, DEX routes

- [ ] **MEV-2**: Intent privacy maintained
  - Public witness commitment prevents frontrunning

- [ ] **MEV-3**: Proof generation timing doesn't leak info
  - Constant-time operations where possible
  - Padding/jitter to prevent timing attacks

- [ ] **MEV-4**: Verifier sees minimal data
  - Only public witness needed for verification
  - No prover identities revealed to verifier

- [ ] **MEV-5**: No transaction graph leakage
  - Session IDs uncorrelated across proofs
  - Fresh commitments for each proof

---

## Migration Path

### Phase 1: Add Commitment Layer (Non-Breaking)
- Implement commitment crypto primitives
- Add new `BlindProof` message types
- Keep existing non-blind endpoints active
- Dashboard shows both modes

### Phase 2: Dual-Mode Operation
- Coordinator supports both blind and non-blind modes
- Nodes accept both message types
- Frontend allows mode selection
- Default to blind mode for new sessions

### Phase 3: Deprecate Non-Blind Mode
- Mark old endpoints as deprecated
- Add warnings in UI
- Documentation updated
- Migration guide published

### Phase 4: Full Privacy Enforcement
- Remove non-blind endpoints
- All proofs require commitments
- Privacy checklist must pass
- Security audit completed

---

## Performance Impact

### Additional Overhead

1. **Client**:
   - 1× SHA-256 computation (< 1ms)
   - 32 bytes salt storage

2. **Coordinator**:
   - 1× SHA-256 for challenge (< 1ms)
   - 32 bytes commitment storage per session

3. **Verifier**:
   - 1× SHA-256 for commitment check (< 1ms)
   - 32 bytes salt transmission

**Total Overhead**: < 5ms per proof, 96 bytes extra data

**Conclusion**: Negligible impact (< 1% for typical proof generation)

---

## Alternative Designs Considered

### A. Fully Homomorphic Encryption (FHE)
- **Pro**: Compute on encrypted witness
- **Con**: 1000× slowdown, impractical
- **Rejected**: Performance unacceptable

### B. MPC for All Operations
- **Pro**: Maximum privacy
- **Con**: Complex, many rounds, hard to implement
- **Rejected**: Over-engineered for threat model

### C. Trusted Execution Environment (TEE)
- **Pro**: Simple to implement
- **Con**: Trusted hardware, limited availability
- **Rejected**: Single point of trust, deployment complexity

### D. Zero-Knowledge Proof of Proof
- **Pro**: Recursive privacy
- **Con**: Exponential complexity growth
- **Rejected**: Unnecessary complexity

**Why Commit-Then-Prove Wins**:
- Standard crypto (SHA-256)
- Minimal overhead (< 1%)
- Clear security model
- Easy to implement
- Composable with existing system

---

## Conclusion

The **Commit-Then-Prove** protocol provides:

✅ **Public witness privacy**: No prover learns witness
✅ **Minimal trust**: Coordinator sees only commitments
✅ **Practical performance**: < 1% overhead
✅ **Standard crypto**: SHA-256, no exotic primitives
✅ **Clear security model**: Provable guarantees
✅ **MEV-resistant**: Intent hiding for institutional use

**Next Steps**:
1. Implement commitment primitives (`prover-core/src/commitment.rs`)
2. Add blind message types (`prover-network/src/messages.rs`)
3. Update coordinator challenge computation
4. Build privacy dashboard panel
5. Complete privacy checklist
6. Security audit

This design treats privacy as a first-class requirement and provides institutional-grade guarantees for MEV-sensitive use cases.
