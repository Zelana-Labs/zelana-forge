# Zelana Prover Dashboard

Interactive web dashboard for managing and monitoring the distributed prover system.

## Quick Start

### Launch Dashboard
```bash
./scripts/start-dashboard.sh
```

### Access
Open browser to: **http://localhost:5173**

### Usage
1. Click **"▶ Start Cluster"** to launch Docker containers
2. Follow 3-step workflow: Setup → Prove → Verify
3. Monitor logs in real-time
4. View individual container logs
5. Click **"⏹ Stop Cluster"** when done

## Ports

- Dashboard: http://localhost:5173
- Control Server: http://localhost:9000
- Coordinator: http://localhost:8000
- Nodes: http://localhost:3001-3005

## Features

- One-click cluster management (Docker Compose)
- Live log streaming with filtering
- Container log viewer with modal
- Visual cluster topology
- Interactive step-by-step workflow
- Matte dark theme
- Real-time node status monitoring

## Components

### InteractiveDashboard
Main container managing cluster state and logs.

### ClusterView
SVG-based visual topology with animated nodes.

### WorkflowPanel
3-step progressive workflow (Setup → Prove → Verify).

### LogViewer
Real-time logs with filtering and container controls.

## API Endpoints

### Coordinator (via /api/*)
- GET /health
- POST /setup
- POST /prove
- POST /verify

### Control Server (via /control/*)
- GET /health
- POST /cluster/start
- POST /cluster/stop
- GET /cluster/logs/:container
- POST /cluster/restart/:container

## Development

```bash
cd dashboard
npm install
npm run dev    # Development mode
npm run build  # Production build
```

## Troubleshooting

See main README.md for common issues and solutions.

