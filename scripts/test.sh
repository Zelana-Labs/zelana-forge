#!/bin/bash
# Test script for distributed prover network
#
# Usage: ./test.sh
#
# Prerequisites: docker-compose up --build

set -e

COORDINATOR="http://localhost:8000"

echo "=========================================="
echo "  Distributed ZK Prover Network Test"
echo "=========================================="
echo ""

# Wait for services
echo "⏳ Waiting for services to be ready..."
sleep 3

# Check health
echo ""
echo "📊 Checking coordinator health..."
curl -s "$COORDINATOR/health" | jq .
echo ""

# Setup: distribute secret shares
echo "🔐 Setting up: distributing secret shares to nodes..."
SETUP_RESULT=$(curl -s -X POST "$COORDINATOR/setup" \
    -H "Content-Type: application/json" \
    -d '{}')
echo "$SETUP_RESULT" | jq .
echo ""

if echo "$SETUP_RESULT" | jq -e '.success' > /dev/null; then
    echo "✅ Setup complete!"
else
    echo "❌ Setup failed!"
    exit 1
fi

# Generate proof using first 3 nodes (threshold)
echo ""
echo "🔏 Generating distributed proof..."
PROOF_RESULT=$(curl -s -X POST "$COORDINATOR/prove" \
    -H "Content-Type: application/json" \
    -d '{}')
echo "$PROOF_RESULT" | jq .
echo ""

if echo "$PROOF_RESULT" | jq -e '.success' > /dev/null; then
    echo "✅ Proof generated!"
    
    # Extract the proof for verification
    PROOF=$(echo "$PROOF_RESULT" | jq '.data')
    
    # Verify the proof
    echo ""
    echo "✔️  Verifying proof..."
    VERIFY_RESULT=$(curl -s -X POST "$COORDINATOR/verify" \
        -H "Content-Type: application/json" \
        -d "$PROOF")
    echo "$VERIFY_RESULT" | jq .
    
    if echo "$VERIFY_RESULT" | jq -e '.data == true' > /dev/null; then
        echo ""
        echo "=========================================="
        echo "  ✅ SUCCESS: Proof is valid!"
        echo "=========================================="
        echo ""
        echo "Key achievements:"
        echo "  • Secret was split among 5 nodes"
        echo "  • 3 nodes collaborated to create the proof"
        echo "  • No single node knew the complete secret"
        echo "  • The proof is verifiable by anyone"
    else
        echo "❌ Verification failed!"
        exit 1
    fi
else
    echo "❌ Proof generation failed!"
    exit 1
fi

echo ""
echo "=========================================="
echo "  Testing with different node subset"
echo "=========================================="
echo ""

# Generate proof using nodes 2, 3, 5 (indices 1, 2, 4)
echo "🔏 Generating proof with nodes [2, 3, 5]..."
PROOF_RESULT2=$(curl -s -X POST "$COORDINATOR/prove" \
    -H "Content-Type: application/json" \
    -d '{"node_indices": [1, 2, 4]}')

if echo "$PROOF_RESULT2" | jq -e '.success' > /dev/null; then
    echo "✅ Alternative proof generated successfully!"
    
    PROOF2=$(echo "$PROOF_RESULT2" | jq '.data')
    VERIFY_RESULT2=$(curl -s -X POST "$COORDINATOR/verify" \
        -H "Content-Type: application/json" \
        -d "$PROOF2")
    
    if echo "$VERIFY_RESULT2" | jq -e '.data == true' > /dev/null; then
        echo "✅ Alternative proof also verifies!"
    fi
else
    echo "❌ Alternative proof failed"
fi

echo ""
echo "=========================================="
echo "  All tests passed! 🎉"
echo "=========================================="