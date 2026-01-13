# Project Structure

Complete overview of the Zelana Prover distributed system.

## Directory Tree

```
zelana-prover/
├── crates/                          # Rust workspace
│   ├── Cargo.toml                   # Workspace manifest
│   ├── README.md                    # Main project documentation
│   │
│   ├── prover-core/                 # Core cryptography library
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs               # Public API exports
│   │       ├── types.rs             # Type aliases and errors
│   │       ├── shamir.rs            # Shamir's Secret Sharing
│   │       └── schnorr.rs           # Distributed Schnorr proofs
│   │
│   ├── prover-network/              # Network message types
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs               # Public API exports
│   │       ├── messages.rs          # Request/response types
│   │       └── serde_utils.rs       # Base64 serialization
│   │
│   ├── prover-node/                 # Node HTTP server
│   │   ├── Cargo.toml
│   │   └── src/
│   │       └── main.rs              # Axum server
│   │
│   └── prover-coordinator/          # Coordinator HTTP server
│       ├── Cargo.toml
│       └── src/
│           └── main.rs              # Orchestration logic
│
├── dashboard/                       # Svelte web dashboard
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── README.md
│   └── src/
│       ├── main.js                  # Entry point
│       ├── app.css                  # Global styles
│       ├── App.svelte               # Root component
│       │
│       ├── components/              # Reusable components
│       │   ├── Sidebar.svelte       # Navigation sidebar
│       │   ├── ClusterVisualization.svelte  # Animated cluster view
│       │   ├── ProtocolFlow.svelte  # Protocol phases diagram
│       │   └── Stats.svelte         # Statistics cards
│       │
│       └── pages/                   # Page components
│           ├── Dashboard.svelte     # Main dashboard
│           ├── Setup.svelte         # System initialization
│           ├── Prove.svelte         # Proof generation
│           ├── Verify.svelte        # Proof verification
│           └── Nodes.svelte         # Node monitoring
│
├── deploy/                          # Deployment configurations
│   ├── docker/
│   │   ├── Dockerfile.node          # Node container
│   │   ├── Dockerfile.coordinator   # Coordinator container
│   │   └── docker-compose.yml       # Local cluster setup
│   │
│   └── k8s/                         # Kubernetes manifests
│       ├── namespace.yaml           # Namespace definition
│       ├── kustomization.yaml       # Kustomize config
│       ├── prover-nodes/
│       │   ├── statefulset.yaml     # Node StatefulSet
│       │   └── service.yaml         # Headless service
│       └── coordinator/
│           ├── deployment.yaml      # Coordinator deployment
│           ├── service.yaml         # ClusterIP service
│           └── configmap.yaml       # Configuration
│
├── scripts/                         # Automation scripts
│   ├── start-dev.sh                 # Start complete system
│   ├── test-local.sh                # Run local tests
│   └── deploy-k8s.sh                # Deploy to Kubernetes
│
└── docs/                            # Documentation
    ├── ARCHITECTURE.md              # System architecture
    ├── PROTOCOL.md                  # Cryptographic protocol
    ├── STATE_MACHINES.md            # State transitions
    ├── DIAGRAMS.md                  # Visual diagrams
    └── PROJECT_STRUCTURE.md         # This file
```

## Component Descriptions

### Rust Crates

#### prover-core
**Purpose**: Pure cryptography library with no dependencies on networking or I/O.

**Key Files**:
- `types.rs`: Field/group element types, error definitions
- `shamir.rs`: Secret sharing and Lagrange interpolation (265 lines)
- `schnorr.rs`: Distributed Schnorr proof protocol (247 lines)

**Dependencies**: arkworks (ark-bn254, ark-ff, ark-ec), sha2

**Tests**: 15 unit tests covering all major functions

#### prover-network
**Purpose**: Network layer providing serialization and message types.

**Key Files**:
- `serde_utils.rs`: Base64 encoding/decoding for arkworks types
- `messages.rs`: All request/response message definitions

**Features**:
- Custom base64 implementation (no external crate)
- Type-safe message envelopes
- Comprehensive test coverage

#### prover-node
**Purpose**: HTTP server holding a secret share and participating in proofs.

**API Endpoints**:
```
GET  /health       - Health check
POST /share        - Receive share assignment
POST /commitment   - Generate commitment (Phase 1)
POST /fragment     - Generate proof fragment (Phase 3)
```

**State Management**:
- Node ID (1-indexed)
- Secret share (x, y)
- Generator and public key
- Session commitments (HashMap)

**Concurrency**: Tokio + RwLock

#### prover-coordinator
**Purpose**: Orchestrates the distributed proving protocol.

**API Endpoints**:
```
GET  /health       - Health check
POST /setup        - Initialize system with secret
POST /prove        - Generate distributed proof
POST /verify       - Verify proof
```

**Protocol Phases**:
1. Setup: Split secret, distribute shares
2. Commitments: Collect Cᵢ = g^rᵢ
3. Challenge: Compute c = H(g || PK || C₁...Cₜ)
4. Responses: Collect zᵢ = rᵢ + c·sᵢ
5. Aggregation: Lagrange interpolation
6. Verification: Check g^z = C · PK^c

### Dashboard (Svelte)

#### Components

**Sidebar.svelte**
- Navigation menu
- Real-time coordinator status
- Version info

**ClusterVisualization.svelte**
- Animated cluster topology
- Coordinator in center
- 5 nodes arranged in circle
- Animated data flow particles

**ProtocolFlow.svelte**
- 6-step protocol visualization
- Phase descriptions
- Interactive hover effects

**Stats.svelte**
- System status
- Node counts
- Threshold info
- Protocol type

#### Pages

**Dashboard.svelte**
- Main landing page
- Cluster overview
- Protocol flow diagram
- Real-time statistics
- Auto-refresh every 3s

**Setup.svelte**
- Secret input (hex)
- Random secret generator
- Share distribution
- Setup confirmation

**Prove.svelte**
- Message input
- Live protocol execution
- Phase-by-phase visualization
- Proof output with copy
- Real-time updates

**Verify.svelte**
- Proof input (JSON)
- Verification steps
- Valid/invalid indication
- Educational info

**Nodes.svelte**
- Node status cards
- Real-time monitoring
- Detailed node info
- Cluster statistics

### Deployment

#### Docker Compose
**File**: `deploy/docker/docker-compose.yml`

**Services**:
- 5 prover nodes (ports 3001-3005)
- 1 coordinator (port 8080)
- Bridge network
- Health checks
- Service dependencies

**Usage**:
```bash
cd deploy/docker
docker-compose up --build
```

#### Kubernetes
**Directory**: `deploy/k8s/`

**Resources**:
- Namespace: zelana-prover
- StatefulSet: prover-node (5 replicas)
- Headless Service: node discovery
- Deployment: coordinator (1 replica)
- ClusterIP Service: coordinator access
- ConfigMap: configuration

**Features**:
- Pod name-based node ID extraction
- Liveness/readiness probes
- Resource limits
- Kustomize support

**Usage**:
```bash
./scripts/deploy-k8s.sh
```

### Scripts

#### start-dev.sh
**Purpose**: Start complete system for local development

**Actions**:
1. Build Rust binaries
2. Install dashboard dependencies
3. Start 5 nodes
4. Start coordinator
5. Start dashboard
6. Display URLs and logs

**Output**:
- Dashboard: http://localhost:5173
- Coordinator: http://localhost:8080
- Nodes: http://localhost:3001-3005

#### test-local.sh
**Purpose**: Run automated tests on local cluster

**Tests**:
1. Setup with random secret
2. Generate proof
3. Verify proof
4. Check all assertions

#### deploy-k8s.sh
**Purpose**: Deploy to Kubernetes cluster

**Steps**:
1. Build Docker images
2. Load into cluster (minikube/kind)
3. Apply manifests
4. Wait for readiness
5. Display status

### Documentation

#### ARCHITECTURE.md
- System overview
- Component descriptions
- Deployment architecture
- Security analysis
- Performance characteristics
- Future enhancements

#### PROTOCOL.md
- Mathematical foundations
- Cryptographic protocol
- Phase-by-phase details
- Security proofs
- Attack analysis
- Parameter selection

#### STATE_MACHINES.md
(To be created)
- Node state transitions
- Coordinator states
- Error handling
- Recovery procedures

#### DIAGRAMS.md
(To be created)
- Mermaid diagrams
- Sequence diagrams
- Architecture diagrams
- Flow charts

## File Statistics

### Rust Code
```
prover-core:        ~800 lines (excluding tests)
prover-network:     ~500 lines
prover-node:        ~250 lines
prover-coordinator: ~450 lines
Total:              ~2000 lines of Rust
```

### Dashboard Code
```
Components:         ~800 lines
Pages:              ~1400 lines
Styles:             ~300 lines
Config:             ~100 lines
Total:              ~2600 lines of Svelte/JS/CSS
```

### Configuration
```
Docker:             ~150 lines
Kubernetes:         ~250 lines
Scripts:            ~400 lines
Total:              ~800 lines
```

### Documentation
```
README files:       ~400 lines
Technical docs:     ~1500 lines
Total:              ~1900 lines
```

### Grand Total
**~7300 lines** of code and documentation

## Technology Stack

### Backend
- **Language**: Rust 1.75+
- **Framework**: Axum 0.7 (HTTP)
- **Async Runtime**: Tokio
- **Crypto**: arkworks (ark-bn254)
- **Serialization**: serde, serde_json

### Frontend
- **Framework**: Svelte 4
- **Build Tool**: Vite 5
- **Routing**: svelte-routing
- **Styling**: Custom CSS (CSS Variables)

### Infrastructure
- **Containers**: Docker
- **Orchestration**: Kubernetes
- **Proxy**: Vite dev proxy (development)

## Development Workflow

### Adding a New Feature

1. **Crypto changes**: Edit `prover-core`
2. **Network changes**: Edit `prover-network`
3. **Node logic**: Edit `prover-node`
4. **Coordinator logic**: Edit `prover-coordinator`
5. **UI**: Edit dashboard components/pages
6. **Tests**: Add unit tests and update `test-local.sh`
7. **Docs**: Update relevant documentation

### Testing

```bash
# Unit tests
cargo test --workspace

# Integration test
./scripts/test-local.sh

# Manual testing
./scripts/start-dev.sh
# Then use dashboard at http://localhost:5173
```

### Deployment

```bash
# Local Docker
cd deploy/docker && docker-compose up

# Kubernetes
./scripts/deploy-k8s.sh
```

## Port Allocation

| Service | Port | Purpose |
|---------|------|---------|
| Dashboard | 5173 | Svelte dev server |
| Coordinator | 8080 | HTTP API |
| Node 1 | 3001 | HTTP API |
| Node 2 | 3002 | HTTP API |
| Node 3 | 3003 | HTTP API |
| Node 4 | 3004 | HTTP API |
| Node 5 | 3005 | HTTP API |

## Configuration

### Environment Variables

**Nodes**:
- `NODE_ID`: Unique node identifier (1-5)
- `PORT`: HTTP port (default: 3000)
- `HOST`: Bind address (default: 0.0.0.0)
- `RUST_LOG`: Logging level

**Coordinator**:
- `THRESHOLD`: Minimum nodes required (default: 3)
- `NODES`: Comma-separated node URLs
- `PORT`: HTTP port (default: 8080)
- `HOST`: Bind address (default: 0.0.0.0)
- `RUST_LOG`: Logging level

### Dashboard Proxy

Vite proxy configuration (`dashboard/vite.config.js`):
```js
proxy: {
  '/api': {
    target: 'http://localhost:8080',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, '')
  }
}
```

## License

Dual-licensed under MIT OR Apache-2.0
