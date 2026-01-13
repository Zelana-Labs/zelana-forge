# Zelana Prover

A distributed zero-knowledge proof system implementing Shamir's Secret Sharing and distributed Schnorr proofs using arkworks cryptography.

## Overview

Zelana Prover is a production-ready distributed proving system that enables multiple parties to collaboratively generate cryptographic proofs without any single party having access to the complete secret. The system uses threshold cryptography to ensure security even if some nodes are compromised.

## Features

- **Distributed Secret Sharing**: Uses Shamir's Secret Sharing with configurable threshold
- **Distributed Schnorr Proofs**: Non-interactive zero-knowledge proofs using Fiat-Shamir heuristic
- **Fault Tolerant**: Requires only threshold nodes to be online (e.g., 3 out of 5)
- **Production Ready**: Includes Docker and Kubernetes deployment configurations
- **Interactive Dashboard**: Beautiful Svelte dashboard with real-time visualization
- **Type-Safe**: Full Rust implementation with comprehensive error handling
- **Well-Documented**: Extensive documentation including architecture, protocol, and state machines

## Architecture

The project consists of four main crates:

- **prover-core**: Pure cryptography implementation (Shamir, Schnorr)
- **prover-network**: Serialization and network message types
- **prover-node**: HTTP server that holds secret shares and participates in proofs
- **prover-coordinator**: Orchestrator that manages the distributed proof protocol

## Quick Start

### Complete System with Dashboard

```bash
# One command to start everything (backend + dashboard)
./scripts/start-dev.sh
```

Then open http://localhost:5173 to access the dashboard!

### Local Development (Backend Only)

```bash
# Build all crates
cargo build --workspace

# Run tests
cargo test --workspace

# Start local test cluster (5 nodes + coordinator)
./scripts/test-local.sh
```

### Dashboard Only

```bash
cd dashboard
npm install
npm run dev
```

### Docker Deployment

```bash
# Build and start cluster
cd deploy/docker
docker-compose up --build

# Test the system
curl -X POST http://localhost:8080/setup \
  -H "Content-Type: application/json" \
  -d '{"secret":"0x1234567890abcdef"}'

curl -X POST http://localhost:8080/prove \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello, World!"}'

curl -X POST http://localhost:8080/verify \
  -H "Content-Type: application/json" \
  -d @proof.json
```

### Kubernetes Deployment

```bash
# Deploy to Kubernetes cluster
./scripts/deploy-k8s.sh

# Check status
kubectl get pods -n zelana-prover

# Test the system
kubectl port-forward -n zelana-prover svc/coordinator 8080:8080
# Then use curl commands as above
```

## Protocol Flow

1. **Setup Phase**: The coordinator splits a secret into shares and distributes them to nodes
2. **Commitment Phase**: Each node generates a commitment `Cᵢ = g^rᵢ` using a random nonce
3. **Challenge Phase**: Coordinator computes Fiat-Shamir challenge `c = H(g || PK || C₁...Cₜ)`
4. **Response Phase**: Each node computes proof fragment `zᵢ = rᵢ + c·sᵢ`
5. **Aggregation Phase**: Coordinator combines fragments using Lagrange interpolation
6. **Verification**: Anyone can verify that `g^z = C · PK^c`

## Security Properties

- **Threshold Security**: Requires t out of n nodes to generate proofs
- **Zero-Knowledge**: Verifier learns nothing about the secret
- **Non-Interactive**: Proof can be verified without coordinator involvement
- **Simulation Sound**: Cannot forge proofs without knowing the secret

## Configuration

### Node Configuration
- `--node-id`: Unique node identifier (1-n)
- `--port`: HTTP server port
- `--host`: Bind address

### Coordinator Configuration
- `--threshold`: Minimum nodes required for proofs
- `--nodes`: Comma-separated list of node URLs
- `--port`: HTTP server port

## Documentation

- [Architecture](docs/ARCHITECTURE.md): System design and components
- [Protocol](docs/PROTOCOL.md): Cryptographic protocol details
- [State Machines](docs/STATE_MACHINES.md): Node and coordinator state transitions
- [Diagrams](docs/DIAGRAMS.md): Visual protocol flow diagrams

## Testing

```bash
# Unit tests (crypto primitives)
cargo test -p prover-core

# Integration tests (network layer)
cargo test -p prover-network

# End-to-end tests
./scripts/test-local.sh
```

## Performance

Benchmarks on a 5-node cluster (threshold=3):
- Setup: ~50ms
- Proof generation: ~100ms
- Verification: ~10ms
- Throughput: ~10 proofs/second

## Contributing

We welcome contributions! Please see our contributing guidelines.

## License

Licensed under either of:
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

## Acknowledgments

Built with [arkworks](https://arkworks.rs/) cryptography library.
