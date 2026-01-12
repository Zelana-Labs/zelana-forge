# Zelana Distributed Prover

A distributed zero-knowledge proof system where **no single node knows the complete secret**. Uses Shamir's Secret Sharing and threshold cryptography to enable privacy-preserving collaborative proving.

## 🎯 Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DISTRIBUTED PROVER NETWORK                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                          ┌──────────────────┐                            │
│                          │   COORDINATOR    │                            │
│                          │                  │                            │
│                          │  • Orchestrates  │                            │
│                          │  • No secrets    │                            │
│                          │  • Aggregates    │                            │
│                          └────────┬─────────┘                            │
│                                   │                                      │
│            ┌──────────────────────┼──────────────────────┐               │
│            │                      │                      │               │
│       ┌────▼────┐           ┌────▼────┐           ┌────▼────┐           │
│       │ NODE 1  │           │ NODE 2  │           │ NODE N  │           │
│       │         │           │         │           │         │           │
│       │ Share 1 │           │ Share 2 │    ...    │ Share N │           │
│       │ (s₁)    │           │ (s₂)    │           │ (sₙ)    │           │
│       └─────────┘           └─────────┘           └─────────┘           │
│                                                                          │
│   Security: Any t nodes can prove, but t-1 nodes learn NOTHING           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
zelana-prover/
├── Cargo.toml                      # Workspace configuration
├── README.md                       # This file
│
├── crates/
│   ├── prover-core/                # Core cryptography (no networking)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs              # Public API
│   │       ├── types.rs            # Fr, G1, error types
│   │       ├── shamir.rs           # Secret sharing
│   │       └── schnorr.rs          # Distributed Schnorr proofs
│   │
│   ├── prover-network/             # Network protocol types
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── messages.rs         # API request/response types
│   │       └── serde_utils.rs      # Base64 serialization
│   │
│   ├── prover-node/                # Prover node service
│   │   ├── Cargo.toml
│   │   └── src/
│   │       └── main.rs             # HTTP server
│   │
│   └── prover-coordinator/         # Coordinator service
│       ├── Cargo.toml
│       └── src/
│           └── main.rs             # Protocol orchestration
│
├── deploy/
│   ├── docker/
│   │   ├── Dockerfile.node
│   │   ├── Dockerfile.coordinator
│   │   └── docker-compose.yml
│   │
│   └── k8s/
│       ├── namespace.yaml
│       ├── kustomization.yaml
│       ├── prover-nodes/
│       │   ├── statefulset.yaml
│       │   └── service.yaml
│       └── coordinator/
│           ├── deployment.yaml
│           ├── service.yaml
│           └── configmap.yaml
│
├── scripts/
│   ├── test-local.sh               # Local docker-compose test
│   └── deploy-k8s.sh               # Kubernetes deployment
│
├── docs/
│   ├── ARCHITECTURE.md             # Detailed architecture
│   ├── PROTOCOL.md                 # Protocol specification
│   └── STATE_MACHINES.md           # State machine diagrams
│
└── .github/
    └── workflows/
        └── ci.yml                  # CI/CD pipeline
```

## 🚀 Quick Start

### Local Development (Docker Compose)

```bash
# Start the network (1 coordinator + 5 nodes, threshold=3)
cd deploy/docker
docker-compose up --build

# In another terminal, test the system
cd scripts
./test-local.sh
```

### Manual Testing

```bash
# 1. Health check
curl http://localhost:8000/health

# 2. Setup: distribute secret shares
curl -X POST http://localhost:8000/setup \
  -H "Content-Type: application/json" \
  -d '{}'

# 3. Generate proof
curl -X POST http://localhost:8000/prove \
  -H "Content-Type: application/json" \
  -d '{}'

# 4. Verify proof (use proof from step 3)
curl -X POST http://localhost:8000/verify \
  -H "Content-Type: application/json" \
  -d '{"commitment":"...","challenge":"...","response":"..."}'
```

### Kubernetes Deployment

```bash
# Deploy to cluster
./scripts/deploy-k8s.sh

# Port forward to access
kubectl -n prover port-forward svc/prover-coordinator 8000:80
```

## 🔐 Security Properties

| Property | Description |
|----------|-------------|
| **Threshold Security** | Any `t` of `n` nodes can create a proof |
| **Information-Theoretic** | `t-1` nodes learn absolutely nothing about the secret |
| **Coordinator Blindness** | Coordinator never sees shares, only commitments |
| **Zero-Knowledge** | Verifier learns nothing except proof validity |
| **Non-Interactive** | Fiat-Shamir transform eliminates interaction |

## 📊 Protocol Overview

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for detailed specification.

```
Phase 1: COMMITMENT      Phase 2: CHALLENGE       Phase 3: RESPONSE        Phase 4: AGGREGATE
─────────────────────    ─────────────────────    ─────────────────────    ─────────────────────
                        
Node 1: C₁ = g^r₁  ───┐                          Node 1: z₁ = r₁ + c·s₁   
                      │                                                    
Node 2: C₂ = g^r₂  ───┼──► c = H(g,PK,C₁..Cₜ) ──► Node 2: z₂ = r₂ + c·s₂ ──► C = Σλᵢ·Cᵢ
                      │                                                        z = Σλᵢ·zᵢ
Node t: Cₜ = g^rₜ  ───┘                          Node t: zₜ = rₜ + c·sₜ   

                                                 Verify: g^z = C · PK^c
```

## 🏗️ Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture.

### Crate Dependencies

```
┌─────────────────────────────────────────────────────┐
│                    Applications                      │
├──────────────────────┬──────────────────────────────┤
│   prover-node        │    prover-coordinator        │
│   (HTTP Server)      │    (Orchestrator)            │
└──────────┬───────────┴───────────────┬──────────────┘
           │                           │
           ▼                           ▼
┌─────────────────────────────────────────────────────┐
│                  prover-network                      │
│            (Messages, Serialization)                 │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                   prover-core                        │
│        (Shamir, Schnorr, Cryptography)              │
└─────────────────────────────────────────────────────┘
```

## 📖 Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design and components
- [Protocol](docs/PROTOCOL.md) - Cryptographic protocol specification
- [State Machines](docs/STATE_MACHINES.md) - Node and coordinator state diagrams

## 🧪 Testing

```bash
# Run all tests
cargo test --all

# Run specific crate tests
cargo test -p prover-core

# Run with logging
RUST_LOG=debug cargo test
```

## 📄 License

MIT OR Apache-2.0