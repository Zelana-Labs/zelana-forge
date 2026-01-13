#!/usr/bin/env bash
# Deploy the distributed prover system to Kubernetes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="$PROJECT_ROOT/deploy/k8s"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

echo "==> Deploying Zelana Prover to Kubernetes"
echo ""

# Check prerequisites
echo "Checking prerequisites..."
if ! command_exists kubectl; then
    echo -e "${RED}Error: kubectl not found. Please install kubectl.${NC}"
    exit 1
fi

if ! command_exists docker; then
    echo -e "${RED}Error: docker not found. Please install Docker.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites satisfied${NC}"
echo ""

# Check if kubectl is configured
if ! kubectl cluster-info &> /dev/null; then
    echo -e "${RED}Error: kubectl is not configured or cluster is not accessible.${NC}"
    echo "Please configure kubectl to point to your cluster."
    exit 1
fi

CLUSTER_INFO=$(kubectl cluster-info | head -n 1)
echo "Connected to: $CLUSTER_INFO"
echo ""

# Build Docker images
echo "==> Building Docker images..."
cd "$PROJECT_ROOT"  # Use project root as build context

echo "Building prover-node image..."
docker build -f deploy/docker/Dockerfile.node -t zelana/prover-node:latest .
echo -e "${GREEN}✓ prover-node image built${NC}"

echo "Building prover-coordinator image..."
docker build -f deploy/docker/Dockerfile.coordinator -t zelana/prover-coordinator:latest .
echo -e "${GREEN}✓ prover-coordinator image built${NC}"
echo ""

# Load images into local cluster if needed
if command_exists minikube && minikube status &> /dev/null; then
    echo "==> Loading images into minikube..."
    minikube image load zelana/prover-node:latest
    minikube image load zelana/prover-coordinator:latest
    echo -e "${GREEN}✓ Images loaded into minikube${NC}"
    echo ""
elif command_exists kind && kind get clusters &> /dev/null; then
    CLUSTER_NAME=$(kind get clusters | head -n 1)
    echo "==> Loading images into kind cluster '$CLUSTER_NAME'..."
    kind load docker-image zelana/prover-node:latest --name "$CLUSTER_NAME"
    kind load docker-image zelana/prover-coordinator:latest --name "$CLUSTER_NAME"
    echo -e "${GREEN}✓ Images loaded into kind${NC}"
    echo ""
fi

# Apply Kubernetes manifests
echo "==> Applying Kubernetes manifests..."
kubectl apply -k "$DEPLOY_DIR"
echo -e "${GREEN}✓ Manifests applied${NC}"
echo ""

# Wait for resources to be ready
echo "==> Waiting for resources to be ready..."

echo "Waiting for namespace..."
kubectl wait --for=jsonpath='{.status.phase}'=Active namespace/zelana-prover --timeout=30s
echo -e "${GREEN}✓ Namespace ready${NC}"

echo "Waiting for prover nodes..."
kubectl wait --for=condition=ready pod -l app=prover-node -n zelana-prover --timeout=120s
echo -e "${GREEN}✓ Prover nodes ready${NC}"

echo "Waiting for coordinator..."
kubectl wait --for=condition=ready pod -l app=coordinator -n zelana-prover --timeout=120s
echo -e "${GREEN}✓ Coordinator ready${NC}"
echo ""

# Show status
echo "==> Deployment Status"
echo ""
echo "Pods:"
kubectl get pods -n zelana-prover
echo ""
echo "Services:"
kubectl get services -n zelana-prover
echo ""

# Coordinator info
echo -e "${GREEN}==> Deployment complete!${NC}"
echo ""
echo "To access the coordinator:"
echo "  kubectl port-forward -n zelana-prover svc/coordinator 8080:8080"
echo ""
echo "Then test with:"
echo "  curl http://localhost:8080/health"
echo ""
echo "To view logs:"
echo "  kubectl logs -n zelana-prover -l app=coordinator"
echo "  kubectl logs -n zelana-prover -l app=prover-node"
echo ""
echo "To delete the deployment:"
echo "  kubectl delete -k $DEPLOY_DIR"
echo ""
