# State Machine Diagrams

This document describes the state machines for all components in the distributed prover system.

## Table of Contents

1. [System Overview](#system-overview)
2. [Prover Node State Machine](#prover-node-state-machine)
3. [Coordinator State Machine](#coordinator-state-machine)
4. [Protocol Flow State Machine](#protocol-flow-state-machine)
5. [Session Lifecycle](#session-lifecycle)

---

## System Overview

```mermaid
flowchart TB
    subgraph System["Distributed Prover System"]
        direction TB
        
        subgraph Coordinator["Coordinator"]
            C_IDLE[Idle]
            C_SETUP[Setup]
            C_PROVING[Proving]
        end
        
        subgraph Nodes["Prover Nodes (n nodes)"]
            N1[Node 1<br/>Share s₁]
            N2[Node 2<br/>Share s₂]
            N3[Node 3<br/>Share s₃]
            Nn[Node n<br/>Share sₙ]
        end
        
        subgraph Verifier["External Verifier"]
            V[Verify Proof]
        end
    end
    
    C_IDLE -->|POST /setup| C_SETUP
    C_SETUP -->|distribute shares| Nodes
    C_SETUP --> C_IDLE
    C_IDLE -->|POST /prove| C_PROVING
    C_PROVING -->|collect commitments| Nodes
    C_PROVING -->|collect fragments| Nodes
    C_PROVING -->|return proof| V
    C_PROVING --> C_IDLE
```

---

## Prover Node State Machine

Each prover node maintains its own state machine for handling requests.

```mermaid
stateDiagram-v2
    [*] --> Uninitialized: Node starts

    Uninitialized --> Ready: POST /share<br/>(receive secret share)
    Uninitialized --> Uninitialized: Any request<br/>(reject: no share)

    Ready --> Ready: GET /health<br/>(return status)
    Ready --> CommitmentGenerated: POST /commitment<br/>(generate nonce, return C = g^r)

    CommitmentGenerated --> Ready: POST /fragment<br/>(compute z = r + c·s, clear nonce)
    CommitmentGenerated --> CommitmentGenerated: POST /commitment<br/>(new session, store nonce)
    CommitmentGenerated --> Ready: Timeout<br/>(clear stale nonces)

    note right of Uninitialized
        Node has no secret share
        Rejects prove requests
    end note

    note right of Ready
        Node has share (x, y)
        Ready to participate
    end note

    note right of CommitmentGenerated
        Nonce stored for session
        Waiting for challenge
    end note
```

### Node State Details

| State | Description | Valid Operations |
|-------|-------------|------------------|
| `Uninitialized` | Node started but no share received | `GET /health`, `POST /share` |
| `Ready` | Has share, ready to participate | `GET /health`, `POST /commitment` |
| `CommitmentGenerated` | Nonce generated, waiting for challenge | `GET /health`, `POST /fragment`, `POST /commitment` (new session) |

### Node Transitions

```mermaid
flowchart LR
    subgraph NodeStates["Node State Transitions"]
        U[Uninitialized] -->|"receive_share(x, y, g, PK)"| R[Ready]
        R -->|"generate_commitment(session_id)"| CG[Commitment<br/>Generated]
        CG -->|"generate_fragment(session_id, challenge)"| R
        CG -->|"timeout / cleanup"| R
    end
```

---

## Coordinator State Machine

The coordinator orchestrates the distributed proving protocol.

```mermaid
stateDiagram-v2
    [*] --> Idle: Coordinator starts

    Idle --> DistributingShares: POST /setup
    DistributingShares --> Idle: shares distributed<br/>(success or partial)

    Idle --> Phase1_Commitments: POST /prove
    Phase1_Commitments --> Phase2_Challenge: collected t commitments
    Phase1_Commitments --> Idle: timeout / insufficient nodes

    Phase2_Challenge --> Phase3_Fragments: challenge computed
    
    Phase3_Fragments --> Phase4_Aggregation: collected t fragments
    Phase3_Fragments --> Idle: timeout / insufficient nodes

    Phase4_Aggregation --> Verification: proof aggregated
    
    Verification --> Idle: return proof<br/>(success or failure)

    Idle --> Idle: POST /verify<br/>(stateless verification)

    note right of Idle
        Ready to setup or prove
        Stateless verification available
    end note

    note right of Phase1_Commitments
        Collecting Cᵢ = g^rᵢ
        from participating nodes
    end note

    note right of Phase2_Challenge
        c = H(g, PK, C₁...Cₜ)
        Fiat-Shamir transform
    end note

    note right of Phase3_Fragments
        Collecting zᵢ = rᵢ + c·sᵢ
        from participating nodes
    end note

    note right of Phase4_Aggregation
        C = Σλᵢ·Cᵢ
        z = Σλᵢ·zᵢ
        Lagrange interpolation
    end note
```

### Coordinator State Details

| State | Description | Next States |
|-------|-------------|-------------|
| `Idle` | Waiting for requests | `DistributingShares`, `Phase1_Commitments` |
| `DistributingShares` | Sending shares to nodes | `Idle` |
| `Phase1_Commitments` | Collecting commitments | `Phase2_Challenge`, `Idle` (error) |
| `Phase2_Challenge` | Computing challenge | `Phase3_Fragments` |
| `Phase3_Fragments` | Collecting responses | `Phase4_Aggregation`, `Idle` (error) |
| `Phase4_Aggregation` | Aggregating proof | `Verification` |
| `Verification` | Verifying final proof | `Idle` |

---

## Protocol Flow State Machine

The complete protocol flow showing interaction between coordinator and nodes.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Coordinator
    participant Node1
    participant Node2
    participant Node3

    rect rgb(200, 220, 240)
        Note over Client,Node3: SETUP PHASE
        Client->>Coordinator: POST /setup
        Coordinator->>Coordinator: Generate secret s
        Coordinator->>Coordinator: Compute shares via polynomial
        par Distribute Shares
            Coordinator->>Node1: POST /share (x₁, y₁, g, PK)
            Coordinator->>Node2: POST /share (x₂, y₂, g, PK)
            Coordinator->>Node3: POST /share (x₃, y₃, g, PK)
        end
        Node1-->>Coordinator: OK
        Node2-->>Coordinator: OK
        Node3-->>Coordinator: OK
        Coordinator-->>Client: Setup complete
    end

    rect rgb(220, 240, 200)
        Note over Client,Node3: PROVING PHASE 1: COMMITMENTS
        Client->>Coordinator: POST /prove
        Coordinator->>Coordinator: Generate session_id
        par Collect Commitments
            Coordinator->>Node1: POST /commitment {session_id}
            Coordinator->>Node2: POST /commitment {session_id}
            Coordinator->>Node3: POST /commitment {session_id}
        end
        Node1->>Node1: r₁ = random()<br/>C₁ = g^r₁<br/>store(session_id, r₁)
        Node2->>Node2: r₂ = random()<br/>C₂ = g^r₂<br/>store(session_id, r₂)
        Node3->>Node3: r₃ = random()<br/>C₃ = g^r₃<br/>store(session_id, r₃)
        Node1-->>Coordinator: C₁
        Node2-->>Coordinator: C₂
        Node3-->>Coordinator: C₃
    end

    rect rgb(240, 220, 200)
        Note over Client,Node3: PROVING PHASE 2: CHALLENGE
        Coordinator->>Coordinator: c = H(g, PK, C₁, C₂, C₃)
    end

    rect rgb(240, 200, 220)
        Note over Client,Node3: PROVING PHASE 3: FRAGMENTS
        par Collect Fragments
            Coordinator->>Node1: POST /fragment {session_id, c}
            Coordinator->>Node2: POST /fragment {session_id, c}
            Coordinator->>Node3: POST /fragment {session_id, c}
        end
        Node1->>Node1: z₁ = r₁ + c·s₁<br/>clear(session_id)
        Node2->>Node2: z₂ = r₂ + c·s₂<br/>clear(session_id)
        Node3->>Node3: z₃ = r₃ + c·s₃<br/>clear(session_id)
        Node1-->>Coordinator: (C₁, z₁)
        Node2-->>Coordinator: (C₂, z₂)
        Node3-->>Coordinator: (C₃, z₃)
    end

    rect rgb(220, 200, 240)
        Note over Client,Node3: PROVING PHASE 4: AGGREGATION
        Coordinator->>Coordinator: Compute Lagrange coefficients λᵢ
        Coordinator->>Coordinator: C = λ₁C₁ + λ₂C₂ + λ₃C₃
        Coordinator->>Coordinator: z = λ₁z₁ + λ₂z₂ + λ₃z₃
        Coordinator->>Coordinator: Verify: g^z == C · PK^c
        Coordinator-->>Client: Proof {C, c, z}
    end
```

---

## Session Lifecycle

Each proving session has a defined lifecycle.

```mermaid
stateDiagram-v2
    [*] --> Created: POST /prove received

    Created --> CollectingCommitments: session_id generated
    
    CollectingCommitments --> CommitmentsCollected: t commitments received
    CollectingCommitments --> Failed: timeout
    CollectingCommitments --> Failed: insufficient nodes

    CommitmentsCollected --> ChallengeComputed: c = H(...)

    ChallengeComputed --> CollectingFragments: challenge sent to nodes
    
    CollectingFragments --> FragmentsCollected: t fragments received
    CollectingFragments --> Failed: timeout
    CollectingFragments --> Failed: insufficient nodes

    FragmentsCollected --> Aggregating: start aggregation

    Aggregating --> Verifying: proof assembled

    Verifying --> Completed: verification passed
    Verifying --> Failed: verification failed

    Completed --> [*]: return proof
    Failed --> [*]: return error

    note right of Created
        session_id = random()
        participating_nodes = []
    end note

    note right of CommitmentsCollected
        commitments[(node_id, Cᵢ)]
        ready for challenge
    end note

    note right of FragmentsCollected
        fragments[(node_id, Cᵢ, zᵢ)]
        ready for aggregation
    end note
```

### Session Data Flow

```mermaid
flowchart TD
    subgraph Session["Session Lifecycle Data"]
        S1[session_id<br/>UUID] --> S2[participating_nodes<br/>Vec of indices]
        S2 --> S3[commitments<br/>HashMap node_id → Cᵢ]
        S3 --> S4[challenge<br/>c = H...]
        S4 --> S5[fragments<br/>HashMap node_id → zᵢ, Cᵢ]
        S5 --> S6[aggregated_proof<br/>C, c, z]
    end
```

---

## Error States and Recovery

```mermaid
flowchart TD
    subgraph Errors["Error Handling"]
        E1[Node Timeout] -->|"retry with different node"| R1[Select alternate node]
        E2[Insufficient Nodes] -->|"if < threshold available"| R2[Return error to client]
        E3[Invalid Response] -->|"malformed data"| R3[Skip node, log warning]
        E4[Verification Failed] -->|"proof invalid"| R4[Return error, investigate]
    end
    
    R1 --> Continue[Continue Protocol]
    R3 --> Continue
    R2 --> Abort[Abort Session]
    R4 --> Abort
```

---

## Lagrange Interpolation Visualization

The key mathematical operation that enables threshold proving:

```mermaid
flowchart LR
    subgraph Input["Input: t fragments"]
        F1["(1, z₁)"]
        F2["(2, z₂)"]
        F3["(3, z₃)"]
    end
    
    subgraph Lagrange["Lagrange Coefficients"]
        L1["λ₁ = (2·3)/((2-1)(3-1)) = 3"]
        L2["λ₂ = (1·3)/((1-2)(3-2)) = -3"]
        L3["λ₃ = (1·2)/((1-3)(2-3)) = 1"]
    end
    
    subgraph Output["Output: Aggregated Response"]
        Z["z = λ₁z₁ + λ₂z₂ + λ₃z₃<br/>= 3z₁ - 3z₂ + z₃"]
    end
    
    F1 --> L1
    F2 --> L2
    F3 --> L3
    L1 --> Z
    L2 --> Z
    L3 --> Z
```

The magic: `Σλᵢsᵢ = s` (reconstructs the secret without anyone seeing it!)

---

## Security State Model

```mermaid
flowchart TB
    subgraph Security["Security Invariants"]
        I1["Invariant 1:<br/>Secret s never leaves setup phase"]
        I2["Invariant 2:<br/>Each node only knows sᵢ"]
        I3["Invariant 3:<br/>Coordinator sees only Cᵢ, zᵢ"]
        I4["Invariant 4:<br/>t-1 colluding nodes learn nothing"]
    end
    
    subgraph Threat["Threat Model"]
        T1[Malicious Node] -->|"can only provide"| Bad1[Wrong zᵢ → Invalid proof]
        T2[Malicious Coordinator] -->|"can only see"| Bad2[Commitments → No secret info]
        T3[Network Attacker] -->|"can observe"| Bad3[Encrypted traffic only]
    end
```

---

## Component Interaction Summary

```mermaid
flowchart TB
    subgraph Client
        CLI[CLI / API Client]
    end
    
    subgraph Coordinator
        API[REST API]
        ORCH[Orchestrator]
        AGG[Aggregator]
    end
    
    subgraph NodeCluster["Node Cluster"]
        N1[Node 1]
        N2[Node 2]
        N3[Node 3]
        N4[Node 4]
        N5[Node 5]
    end
    
    CLI -->|"HTTP"| API
    API --> ORCH
    ORCH -->|"HTTP"| N1
    ORCH -->|"HTTP"| N2
    ORCH -->|"HTTP"| N3
    ORCH -->|"HTTP"| N4
    ORCH -->|"HTTP"| N5
    N1 --> AGG
    N2 --> AGG
    N3 --> AGG
    AGG -->|"proof"| API
```