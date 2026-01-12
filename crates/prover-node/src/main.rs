//! # Prover Node
//!
//! HTTP server that holds a secret share and participates in distributed proof generation.
//!
//! ## Endpoints
//!
//! - `GET /health` - Health check
//! - `POST /share` - Receive share assignment from coordinator
//! - `POST /commitment` - Generate commitment for proof session
//! - `POST /fragment` - Generate proof fragment given challenge

use ark_std::test_rng;

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use prover_core::{schnorr::Commitment, Fr, G1Affine, SecretShare};
use prover_network::{
    ApiResponse, CommitmentRequest, CommitmentResponse, FragmentRequest, FragmentResponse,
    HealthResponse, ShareAssignment,
};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use tracing::{info, warn};

/// Command-line arguments
#[derive(Parser, Debug)]
#[command(name = "prover-node")]
#[command(about = "Distributed prover node", long_about = None)]
struct Args {
    /// Node ID (must be unique)
    #[arg(long, env = "NODE_ID")]
    node_id: u32,

    /// Port to listen on
    #[arg(long, default_value = "3000", env = "PORT")]
    port: u16,

    /// Host to bind to
    #[arg(long, default_value = "0.0.0.0", env = "HOST")]
    host: String,
}

/// Node state
#[derive(Clone)]
struct NodeState {
    /// Node ID
    node_id: u32,

    /// The secret share (if assigned)
    share: Option<SecretShare>,

    /// Generator point
    generator: Option<G1Affine>,

    /// Public key
    public_key: Option<G1Affine>,

    /// Session commitments (session_id -> commitment)
    session_commitments: HashMap<String, Commitment>,
}

type SharedState = Arc<RwLock<NodeState>>;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "prover_node=debug,tower_http=debug".into()),
        )
        .init();

    let args = Args::parse();

    info!(
        "Starting prover node {} on {}:{}",
        args.node_id, args.host, args.port
    );

    // Initialize state
    let state = Arc::new(RwLock::new(NodeState {
        node_id: args.node_id,
        share: None,
        generator: None,
        public_key: None,
        session_commitments: HashMap::new(),
    }));

    // Build router
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/share", post(share_handler))
        .route("/commitment", post(commitment_handler))
        .route("/fragment", post(fragment_handler))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let addr = format!("{}:{}", args.host, args.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    info!("Node {} listening on {}", args.node_id, addr);

    axum::serve(listener, app).await?;

    Ok(())
}

/// Health check handler
async fn health_handler(State(state): State<SharedState>) -> Json<ApiResponse<HealthResponse>> {
    let node_state = state.read().await;
    let ready = node_state.share.is_some();

    Json(ApiResponse::success(HealthResponse {
        status: "ok".to_string(),
        node_id: Some(node_state.node_id),
        ready,
    }))
}

/// Share assignment handler
async fn share_handler(
    State(state): State<SharedState>,
    Json(assignment): Json<ShareAssignment>,
) -> Result<Json<ApiResponse<String>>, StatusCode> {
    let mut node_state = state.write().await;

    // Validate node ID matches
    if assignment.node_id != node_state.node_id {
        warn!(
            "Received share for node {} but we are node {}",
            assignment.node_id, node_state.node_id
        );
        return Ok(Json(ApiResponse::error(format!(
            "Node ID mismatch: expected {}, got {}",
            node_state.node_id, assignment.node_id
        ))));
    }

    // Store the share
    node_state.share = Some(SecretShare {
        index: assignment.share_index as usize,
        x: Fr::from(assignment.share_index as u64),
        y: assignment.share_value,
    });

    node_state.generator = Some(assignment.generator);
    node_state.public_key = Some(assignment.public_key);

    info!(
        "Node {} received share (index: {})",
        node_state.node_id, assignment.share_index
    );

    Ok(Json(ApiResponse::success(format!(
        "Share assigned to node {}",
        node_state.node_id
    ))))
}

/// Commitment generation handler (Phase 1)
async fn commitment_handler(
    State(state): State<SharedState>,
    Json(request): Json<CommitmentRequest>,
) -> Result<Json<ApiResponse<CommitmentResponse>>, StatusCode> {
    let mut node_state = state.write().await;

    // Check if we have a share
    if node_state.share.is_none() {
        warn!("Node {} has no share assigned", node_state.node_id);
        return Ok(Json(ApiResponse::error("No share assigned to this node")));
    }

    // Check if we have generator
    let generator = match node_state.generator {
        Some(g) => g,
        None => {
            warn!("Node {} has no generator", node_state.node_id);
            return Ok(Json(ApiResponse::error("No generator set for this node")));
        }
    };

    let mut rng = test_rng();
    let commitment = Commitment::generate(node_state.node_id as usize, &generator, &mut rng);

    let commitment_point = commitment.point;

    // Store commitment for this session
    node_state
        .session_commitments
        .insert(request.session_id.clone(), commitment);

    info!(
        "Node {} generated commitment for session {}",
        node_state.node_id, request.session_id
    );

    Ok(Json(ApiResponse::success(CommitmentResponse {
        node_id: node_state.node_id,
        session_id: request.session_id,
        commitment: commitment_point,
    })))
}

/// Proof fragment generation handler (Phase 3)
async fn fragment_handler(
    State(state): State<SharedState>,
    Json(request): Json<FragmentRequest>,
) -> Result<Json<ApiResponse<FragmentResponse>>, StatusCode> {
    let mut node_state = state.write().await;

    // Check if we have a share
    let share = match &node_state.share {
        Some(s) => s,
        None => {
            warn!("Node {} has no share assigned", node_state.node_id);
            return Ok(Json(ApiResponse::error("No share assigned to this node")));
        }
    };

    // Retrieve commitment for this session
    let commitment = match node_state.session_commitments.get(&request.session_id) {
        Some(c) => c,
        None => {
            warn!(
                "Node {} has no commitment for session {}",
                node_state.node_id, request.session_id
            );
            return Ok(Json(ApiResponse::error(format!(
                "No commitment found for session {}",
                request.session_id
            ))));
        }
    };

    // Compute response: r + c*s
    let response = commitment.nonce() + (request.challenge * share.y);

    info!(
        "Node {} generated fragment for session {}",
        node_state.node_id, request.session_id
    );

    // Clean up session commitment
    node_state.session_commitments.remove(&request.session_id);

    Ok(Json(ApiResponse::success(FragmentResponse {
        node_id: node_state.node_id,
        session_id: request.session_id,
        response,
    })))
}
