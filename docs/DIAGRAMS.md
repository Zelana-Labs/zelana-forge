# State Machine Diagrams (Mermaid)

Copy these into https://mermaid.live to view interactive diagrams.

---

## 1. System Overview

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        CLI[CLI Tool]
        API[REST API Client]
    end

    subgraph Coordinator["Coordinator Service"]
        CO_API[REST API<br/>Port 8000]
        CO_ORCH[Orchestrator]
        CO_AGG[Aggregator]
    end

    subgraph Nodes["Prover Node Cluster"]
        N1[Node 1<br/>Share s₁]
        N2[Node 2<br/>Share s₂]
        N3[Node 3<br/>Share s₃]
        N4[Node 4<br/>Share s₄]
        N5[Node 5<br/>Share s₅]
    end

    CLI --> CO_API
    API --> CO_API
    CO_API --> CO_ORCH
    CO_ORCH --> N1 & N2 & N3 & N4 & N5
    N1 & N2 & N3 --> CO_AGG
    CO_AGG --> CO_API

    style Coordinator fill:#e1f5fe
    style Nodes fill:#fff3e0
```

---

## 2. Prover Node State Machine

```mermaid
stateDiagram-v2
    [*] --> Uninitialized: Node Starts

    Uninitialized --> Ready: POST /share
    Uninitialized --> Uninitialized: Other requests (reject)

    Ready --> Ready: GET /health
    Ready --> HasCommitment: POST /commitment

    HasCommitment --> Ready: POST /fragment
    HasCommitment --> HasCommitment: POST /commitment (new session)
    HasCommitment --> Ready: Session timeout

    note right of Uninitialized
        No secret share
        Rejects prove requests
    end note

    note right of Ready
        Has share (xᵢ, yᵢ)
        Ready to participate
    end note

    note right of HasCommitment
        Nonce rᵢ stored
        Waiting for challenge
    end note
```

---

## 3. Coordinator State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle: Start

    Idle --> Distributing: POST /setup
    Distributing --> Idle: Complete

    Idle --> Phase1: POST /prove
    
    Phase1 --> Phase2: Got t commitments
    Phase1 --> Idle: Timeout/Error

    Phase2 --> Phase3: Challenge computed

    Phase3 --> Phase4: Got t fragments
    Phase3 --> Idle: Timeout/Error

    Phase4 --> Verifying: Aggregated

    Verifying --> Idle: Return proof

    Idle --> Idle: POST /verify (stateless)

    note right of Phase1: Collecting Cᵢ = g^rᵢ
    note right of Phase2: c = H(g, PK, C₁...Cₜ)
    note right of Phase3: Collecting zᵢ = rᵢ + c·sᵢ
    note right of Phase4: C = Σλᵢ·Cᵢ, z = Σλᵢ·zᵢ
```

---

## 4. Complete Protocol Sequence

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant CO as Coordinator
    participant N1 as Node 1
    participant N2 as Node 2
    participant N3 as Node 3

    rect rgb(230, 240, 255)
        Note over C,N3: SETUP PHASE
        C->>CO: POST /setup
        CO->>CO: Generate secret s<br/>Create polynomial f(x)
        par Distribute Shares
            CO->>N1: POST /share (1, f(1), g, PK)
            CO->>N2: POST /share (2, f(2), g, PK)
            CO->>N3: POST /share (3, f(3), g, PK)
        end
        N1-->>CO: OK (store s₁)
        N2-->>CO: OK (store s₂)
        N3-->>CO: OK (store s₃)
        CO-->>C: Setup complete
    end

    rect rgb(230, 255, 230)
        Note over C,N3: PHASE 1: COMMITMENT
        C->>CO: POST /prove
        CO->>CO: session_id = random()
        par Collect Commitments
            CO->>N1: POST /commitment
            CO->>N2: POST /commitment
            CO->>N3: POST /commitment
        end
        N1->>N1: r₁ ← random()<br/>C₁ = g^r₁
        N2->>N2: r₂ ← random()<br/>C₂ = g^r₂
        N3->>N3: r₃ ← random()<br/>C₃ = g^r₃
        N1-->>CO: C₁
        N2-->>CO: C₂
        N3-->>CO: C₃
    end

    rect rgb(255, 245, 230)
        Note over C,N3: PHASE 2: CHALLENGE
        CO->>CO: c = H(g || PK || C₁ || C₂ || C₃)
    end

    rect rgb(255, 230, 240)
        Note over C,N3: PHASE 3: RESPONSE
        par Collect Fragments
            CO->>N1: POST /fragment {c}
            CO->>N2: POST /fragment {c}
            CO->>N3: POST /fragment {c}
        end
        N1->>N1: z₁ = r₁ + c·s₁
        N2->>N2: z₂ = r₂ + c·s₂
        N3->>N3: z₃ = r₃ + c·s₃
        N1-->>CO: (C₁, z₁)
        N2-->>CO: (C₂, z₂)
        N3-->>CO: (C₃, z₃)
    end

    rect rgb(240, 230, 255)
        Note over C,N3: PHASE 4: AGGREGATE
        CO->>CO: λ₁, λ₂, λ₃ = Lagrange coefficients
        CO->>CO: C = λ₁C₁ + λ₂C₂ + λ₃C₃
        CO->>CO: z = λ₁z₁ + λ₂z₂ + λ₃z₃
        CO->>CO: Verify: g^z = C · PK^c
        CO-->>C: Proof {C, c, z}
    end
```

---

## 5. Shamir Secret Sharing

```mermaid
flowchart LR
    subgraph Setup["Secret Sharing Setup"]
        S[Secret s] --> P[Polynomial<br/>f(x) = s + a₁x + a₂x²]
        P --> E1[f(1) = s₁]
        P --> E2[f(2) = s₂]
        P --> E3[f(3) = s₃]
        P --> E4[f(4) = s₄]
        P --> E5[f(5) = s₅]
    end

    subgraph Reconstruction["Reconstruction (any 3)"]
        R1[s₁] --> L[Lagrange<br/>Interpolation]
        R2[s₂] --> L
        R3[s₃] --> L
        L --> RS[s = f(0)]
    end

    E1 -.-> R1
    E2 -.-> R2
    E3 -.-> R3

    style S fill:#ffcccc
    style RS fill:#ccffcc
```

---

## 6. Lagrange Interpolation

```mermaid
flowchart TD
    subgraph Input["Threshold Fragments (t=3)"]
        F1["Node 1: (x₁=1, z₁)"]
        F2["Node 2: (x₂=2, z₂)"]
        F3["Node 3: (x₃=3, z₃)"]
    end

    subgraph Coefficients["Lagrange Coefficients λᵢ(0)"]
        L1["λ₁ = (2×3)/((2-1)(3-1)) = 3"]
        L2["λ₂ = (1×3)/((1-2)(3-2)) = -3"]
        L3["λ₃ = (1×2)/((1-3)(2-3)) = 1"]
    end

    subgraph Output["Aggregated Value"]
        Z["z = 3z₁ - 3z₂ + z₃<br/>= Σλᵢzᵢ"]
    end

    F1 --> L1
    F2 --> L2
    F3 --> L3
    L1 --> Z
    L2 --> Z
    L3 --> Z

    style Z fill:#90EE90
```

---

## 7. Verification Equation

```mermaid
flowchart LR
    subgraph Proof["Proof (C, c, z)"]
        C[Commitment C]
        CH[Challenge c]
        R[Response z]
    end

    subgraph Verify["Verification"]
        LHS["LHS = g^z"]
        RHS["RHS = C · PK^c"]
        EQ{LHS = RHS?}
    end

    subgraph Result["Result"]
        VALID[✓ Valid]
        INVALID[✗ Invalid]
    end

    R --> LHS
    C --> RHS
    CH --> RHS
    LHS --> EQ
    RHS --> EQ
    EQ -->|Yes| VALID
    EQ -->|No| INVALID

    style VALID fill:#90EE90
    style INVALID fill:#FFB6C1
```

---

## 8. Security Boundaries

```mermaid
flowchart TB
    subgraph Untrusted["🔓 UNTRUSTED"]
        EXT[External Clients]
    end

    subgraph SemiTrust["🔒 SEMI-TRUSTED"]
        COORD[Coordinator<br/>Sees: Cᵢ, zᵢ<br/>Cannot: Extract s]
    end

    subgraph Trusted["🔐 TRUSTED"]
        N1[Node 1: s₁]
        N2[Node 2: s₂]
        N3[Node 3: s₃]
        N4[Node 4: s₄]
        N5[Node 5: s₅]
    end

    EXT -->|TLS| COORD
    COORD -->|Internal| N1 & N2 & N3 & N4 & N5

    style Untrusted fill:#ffcccc
    style SemiTrust fill:#ffffcc
    style Trusted fill:#ccffcc
```

---

## 9. Error Handling State Machine

```mermaid
stateDiagram-v2
    [*] --> Attempt

    Attempt --> Success: Response OK
    Attempt --> Retry: Timeout/Error

    Retry --> Attempt: Retry < 3
    Retry --> TryAlternate: Retry >= 3

    TryAlternate --> Attempt: Alternate node available
    TryAlternate --> Failed: No alternates

    Success --> [*]
    Failed --> [*]

    note right of Retry
        Exponential backoff
        Wait 1s, 2s, 4s...
    end note
```

---

## 10. Data Flow

```mermaid
flowchart TB
    subgraph Setup["Setup Phase"]
        SECRET[Secret s] --> POLY[Polynomial f(x)]
        POLY --> SHARES[Shares s₁...sₙ]
        SECRET --> PK[Public Key g^s]
    end

    subgraph Commit["Commitment Phase"]
        NONCE[Nonces r₁...rₜ] --> COMMITS[Commitments C₁...Cₜ]
    end

    subgraph Challenge["Challenge Phase"]
        COMMITS --> HASH[SHA-256]
        PK --> HASH
        HASH --> CHAL[Challenge c]
    end

    subgraph Response["Response Phase"]
        NONCE --> RESP
        SHARES --> RESP
        CHAL --> RESP[Responses z₁...zₜ]
    end

    subgraph Aggregate["Aggregation"]
        COMMITS --> AGG
        RESP --> AGG[Lagrange Interpolation]
        AGG --> PROOF[Final Proof]
    end

    style SECRET fill:#ffcccc
    style PROOF fill:#ccffcc
```