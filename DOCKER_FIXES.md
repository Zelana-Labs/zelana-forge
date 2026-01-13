# Docker Compose Health Check Fixes

## Issues Fixed

### 1. Missing curl in Docker Images
**Problem**: Health checks were failing because `curl` wasn't installed in the runtime images.

**Fix**: Added curl installation in both Dockerfiles:
```dockerfile
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*
```

### 2. Incorrect Dockerfile COPY Paths
**Problem**: Dockerfiles had leading slashes and incorrect paths.

**Before**:
```dockerfile
COPY /Cargo.toml ./Cargo.toml
COPY /prover-core ./prover-core
COPY /prover-network ./prover-network
```

**After**:
```dockerfile
COPY Cargo.toml ./Cargo.toml
COPY af_xdp ./af_xdp
COPY prover ./prover
COPY crates ./crates
```

### 3. Short Health Check Start Period
**Problem**: Health checks were failing because services needed more time to start.

**Fix**: Extended health check configuration:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
  interval: 10s
  timeout: 5s
  retries: 5          # Increased from 3
  start_period: 30s   # Added 30 second start period
```

### 4. Removed Duplicate HEALTHCHECK
**Problem**: Health check was defined in both Dockerfile and docker-compose.yml.

**Fix**: Removed HEALTHCHECK from Dockerfile.coordinator, keeping it only in docker-compose.yml for consistency.

## Health Check Configuration

All nodes and coordinator now use:
- **Interval**: 10 seconds between checks
- **Timeout**: 5 seconds per check
- **Retries**: 5 attempts before marking unhealthy
- **Start Period**: 30 seconds grace period on startup

This gives services up to 50 seconds (5 retries × 10s interval) after the 30s start period to become healthy.

## Testing

```bash
# Clean start
cd deploy/docker
docker compose down
docker compose up -d

# Watch status
docker compose ps

# Check logs if unhealthy
docker compose logs node1
docker compose logs coordinator
```

## Expected Startup Sequence

1. All 5 nodes start simultaneously
2. Health checks begin after 30s start_period
3. Nodes become healthy within 30-60 seconds
4. Coordinator waits for all nodes to be healthy
5. Coordinator starts after nodes are ready
6. System is fully operational

## Troubleshooting

### Check individual container health
```bash
docker compose ps
docker inspect docker-node1-1 | grep -A 10 Health
```

### View container logs
```bash
docker compose logs -f node1
docker compose logs -f coordinator
```

### Manual health check
```bash
# From host
curl http://localhost:3001/health
curl http://localhost:8000/health

# Inside container
docker compose exec node1 curl http://localhost:8080/health
```

### Rebuild if needed
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

## Port Mappings

- Coordinator: 8000 (host) → 8080 (container)
- Node 1: 3001 (host) → 8080 (container)
- Node 2: 3002 (host) → 8080 (container)
- Node 3: 3003 (host) → 8080 (container)
- Node 4: 3004 (host) → 8080 (container)
- Node 5: 3005 (host) → 8080 (container)

All internal communication uses port 8080 within the Docker network.

