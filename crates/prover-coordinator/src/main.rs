//! # Prover Coordinator
//!
//! Orchestrates the distributed proving protocol across multiple nodes.
//!
//! ## Endpoints
//!
//! - `GET /health` - Health check
//! - `POST /setup` - Initialize system with a secret
//! - `POST /prove` - Generate a distributed proof
//! - `POST /verify` - Verify a proof
//!
//! ## Protocol Flow
//!
//! 1. **Setup**: Split secret and distribute shares to nodes
//! 2. **Phase 1 (Commitments)**: Collect Cᵢ = g^rᵢ from threshold nodes
//! 3. **Phase 2 (Challenge)**: Compute c = H(g || PK || C₁...Cₜ)
//! 4. **Phase 3 (Responses)**: Collect zᵢ = rᵢ + c·sᵢ from nodes
//! 5. **Phase 4 (Aggregation)**: Compute C = Σλᵢ·Cᵢ, z = Σλᵢ·zᵢ
//! 6. **Verification**: Check g^z = C · PK^c

use ark_ff::PrimeField;
use ark_std::{
    Zero, rand::{Rng, SeedableRng, rngs::StdRng }
};
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use prover_core::{
    generate_challenge, shamir::share_secret, Fr, G1Affine,
    G1Projective, PublicParams, SecretShare,
};
use prover_network::{
    ApiResponse, CommitmentRequest, CommitmentResponse, FragmentRequest, FragmentResponse,
    HealthResponse, NetworkProof, ProveRequest, ProveResponse, SetupRequest, SetupResponse,
    ShareAssignment, VerifyRequest, VerifyResponse,
};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};

/// Command-line arguments
#[derive(Parser, Debug)]
#[command(name = "prover-coordinator")]
#[command(about = "Distributed proof coordinator", long_about = None)]
struct Args {
    /// Threshold (minimum nodes required for proofs)
    #[arg(long, default_value = "3", env = "THRESHOLD")]
    threshold: usize,

    /// Comma-separated list of node URLs
    #[arg(
        long,
        value_delimiter = ',',
        default_value = "http://localhost:3000,http://localhost:3001,http://localhost:3002",
        env = "NODES"
    )]
    nodes: Vec<String>,

    /// Port to listen on
    #[arg(long, default_value = "8080", env = "PORT")]
    port: u16,

    /// Host to bind to
    #[arg(long, default_value = "0.0.0.0", env = "HOST")]
    host: String,
}

/// Coordinator state
#[derive(Clone)]
struct CoordinatorState {
    /// Node URLs
    node_urls: Vec<String>,

    /// Threshold
    threshold: usize,

    /// Public parameters (if initialized)
    params: Option<PublicParams>,

    /// Shares distributed to nodes
    shares: Vec<SecretShare>,

    /// HTTP client
    client: reqwest::Client,
}

type SharedState = Arc<RwLock<CoordinatorState>>;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "prover_coordinator=debug,tower_http=debug".into()),
        )
        .init();

    let args = Args::parse();

    // Validate configuration
    if args.threshold == 0 || args.threshold > args.nodes.len() {
        anyhow::bail!(
            "Invalid threshold: must be between 1 and {}, got {}",
            args.nodes.len(),
            args.threshold
        );
    }

    info!(
        "Starting coordinator with {} nodes (threshold: {}) on {}:{}",
        args.nodes.len(),
        args.threshold,
        args.host,
        args.port
    );

    // Initialize state
    let state = Arc::new(RwLock::new(CoordinatorState {
        node_urls: args.nodes,
        threshold: args.threshold,
        params: None,
        shares: Vec::new(),
        client: reqwest::Client::new(),
    }));

    // Build router
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/setup", post(setup_handler))
        .route("/prove", post(prove_handler))
        .route("/verify", post(verify_handler))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let addr = format!("{}:{}", args.host, args.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    info!("Coordinator listening on {}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}

/// Health check handler
async fn health_handler(State(state): State<SharedState>) -> Json<ApiResponse<HealthResponse>> {
    let coord_state = state.read().await;
    let ready = coord_state.params.is_some();

    Json(ApiResponse::success(HealthResponse {
        status: "ok".to_string(),
        node_id: None,
        ready,
    }))
}

/// Setup handler - distributes shares to nodes
async fn setup_handler(
    State(state): State<SharedState>,
    Json(request): Json<SetupRequest>,
) -> Result<Json<ApiResponse<SetupResponse>>, StatusCode> {
    let mut coord_state = state.write().await;

    // Parse secret from hex
    let secret_bytes = hex::decode(request.secret.trim_start_matches("0x")).map_err(|e| {
        error!("Failed to parse secret: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    let secret = Fr::from_le_bytes_mod_order(&secret_bytes);

    info!("Setting up system with secret");

    // Generate public parameters
    let mut rng = ark_std::test_rng();
    let params = PublicParams::new(secret, &mut rng);

    let num_nodes = coord_state.node_urls.len();
    let threshold = coord_state.threshold;

    // Split secret into shares
    let share_set = share_secret(secret, num_nodes, threshold, &mut rng);

    // Distribute shares to nodes
    for (i, share) in share_set.shares.iter().enumerate() {
        let node_url = &coord_state.node_urls[i];
        let assignment = ShareAssignment {
            node_id: (i + 1) as u32,
            share_index: share.index as u32,
            share_value: share.y,
            generator: params.generator,
            public_key: params.public_key,
        };

        match coord_state
            .client
            .post(format!("{}/share", node_url))
            .json(&assignment)
            .send()
            .await
        {
            Ok(response) => {
                if response.status().is_success() {
                    info!("Assigned share to node {} at {}", i + 1, node_url);
                } else {
                    error!(
                        "Failed to assign share to node {}: {}",
                        i + 1,
                        response.status()
                    );
                }
            }
            Err(e) => {
                error!("Failed to contact node {} at {}: {}", i + 1, node_url, e);
            }
        }
    }

    // Store state
    coord_state.params = Some(params.clone());
    coord_state.shares = share_set.shares;

    info!(
        "Setup complete: {} nodes, threshold {}",
        num_nodes, threshold
    );

    Ok(Json(ApiResponse::success(SetupResponse {
        generator: params.generator,
        public_key: params.public_key,
        num_nodes,
        threshold,
    })))
}

/// Prove handler - orchestrates distributed proof generation
async fn prove_handler(
    State(state): State<SharedState>,
    Json(_request): Json<ProveRequest>,
) -> Result<Json<ApiResponse<ProveResponse>>, StatusCode> {
    let coord_state = state.read().await;

    // Check if system is initialized
    let params = match &coord_state.params {
        Some(p) => p,
        None => {
            warn!("Attempted to prove before setup");
            return Ok(Json(ApiResponse::error(
                "System not initialized. Call /setup first",
            )));
        }
    };

    let mut rng = StdRng::seed_from_u64(42);
    let mut session_bytes = [0u8; 32];
    rng.fill(&mut session_bytes);

    let session_id = format!("session-{}", hex::encode(session_bytes));
    info!("Starting proof generation (session: {})", session_id);

    // Phase 1: Collect commitments from threshold nodes
    info!("Phase 1: Collecting commitments");
    let commitment_request = CommitmentRequest {
        session_id: session_id.clone(),
    };

    let mut commitment_responses = Vec::new();
    for (i, node_url) in coord_state.node_urls[0..coord_state.threshold]
        .iter()
        .enumerate()
    {
        match coord_state
            .client
            .post(format!("{}/commitment", node_url))
            .json(&commitment_request)
            .send()
            .await
        {
            Ok(response) => match response.json::<ApiResponse<CommitmentResponse>>().await {
                Ok(ApiResponse::Success { data }) => {
                    info!("Received commitment from node {}", i + 1);
                    commitment_responses.push(data);
                }
                Ok(ApiResponse::Error { message }) => {
                    error!("Node {} returned error: {}", i + 1, message);
                }
                Err(e) => {
                    error!("Failed to parse response from node {}: {}", i + 1, e);
                }
            },
            Err(e) => {
                error!("Failed to contact node {} at {}: {}", i + 1, node_url, e);
            }
        }
    }

    if commitment_responses.len() < coord_state.threshold {
        error!(
            "Insufficient commitments: got {}, need {}",
            commitment_responses.len(),
            coord_state.threshold
        );
        return Ok(Json(ApiResponse::error(format!(
            "Only {} of {} nodes responded",
            commitment_responses.len(),
            coord_state.threshold
        ))));
    }

    // Phase 2: Compute Fiat-Shamir challenge
    info!("Phase 2: Computing challenge");
    let commitment_points: Vec<G1Affine> =
        commitment_responses.iter().map(|r| r.commitment).collect();

    let challenge = generate_challenge(&params.generator, &params.public_key, &commitment_points);

    // Phase 3: Collect proof fragments
    info!("Phase 3: Collecting fragments");
    let fragment_request = FragmentRequest {
        session_id: session_id.clone(),
        challenge,
    };

    let mut fragment_responses = Vec::new();
    for (i, node_url) in coord_state.node_urls[0..coord_state.threshold]
        .iter()
        .enumerate()
    {
        match coord_state
            .client
            .post(format!("{}/fragment", node_url))
            .json(&fragment_request)
            .send()
            .await
        {
            Ok(response) => match response.json::<ApiResponse<FragmentResponse>>().await {
                Ok(ApiResponse::Success { data }) => {
                    info!("Received fragment from node {}", i + 1);
                    fragment_responses.push(data);
                }
                Ok(ApiResponse::Error { message }) => {
                    error!("Node {} returned error: {}", i + 1, message);
                }
                Err(e) => {
                    error!("Failed to parse response from node {}: {}", i + 1, e);
                }
            },
            Err(e) => {
                error!("Failed to contact node {} at {}: {}", i + 1, node_url, e);
            }
        }
    }

    if fragment_responses.len() < coord_state.threshold {
        error!(
            "Insufficient fragments: got {}, need {}",
            fragment_responses.len(),
            coord_state.threshold
        );
        return Ok(Json(ApiResponse::error(format!(
            "Only {} of {} nodes responded with fragments",
            fragment_responses.len(),
            coord_state.threshold
        ))));
    }

    // Phase 4: Aggregate using Lagrange interpolation
    info!("Phase 4: Aggregating proof");

    // Compute Lagrange coefficients
    use prover_core::shamir::lagrange_coefficient;

    let x_coords: Vec<Fr> = fragment_responses
        .iter()
        .map(|r| Fr::from(r.node_id as u64))
        .collect();

    let mut agg_commitment = G1Projective::zero();
    let mut agg_response = Fr::zero();

    for (i, (commitment_resp, fragment_resp)) in commitment_responses
        .iter()
        .zip(fragment_responses.iter())
        .enumerate()
    {
        let coeff = lagrange_coefficient(&x_coords, i);

        agg_commitment += G1Projective::from(commitment_resp.commitment) * coeff;
        agg_response += fragment_resp.response * coeff;
    }

    let proof = NetworkProof {
        commitment: agg_commitment.into_affine(),
        challenge,
        response: agg_response,
        generator: params.generator,
        public_key: params.public_key,
    };

    // Verify proof before returning
    use ark_ec::CurveGroup;
    let lhs = (params.generator * proof.response).into_affine();
    let rhs = (proof.commitment + (params.public_key * proof.challenge)).into_affine();

    if lhs != rhs {
        error!("Generated proof failed verification!");
        return Ok(Json(ApiResponse::error("Generated proof is invalid")));
    }

    info!("Proof generation complete");

    Ok(Json(ApiResponse::success(ProveResponse {
        proof,
        participants: fragment_responses.len(),
    })))
}

/// Verify handler - verifies a distributed proof
async fn verify_handler(
    State(_state): State<SharedState>,
    Json(request): Json<VerifyRequest>,
) -> Result<Json<ApiResponse<VerifyResponse>>, StatusCode> {
    info!("Verifying proof");

    // Verify: g^z = C · PK^c
    use ark_ec::CurveGroup;

    let lhs = (request.proof.generator * request.proof.response).into_affine();
    let rhs = (request.proof.commitment + (request.proof.public_key * request.proof.challenge))
        .into_affine();

    let valid = lhs == rhs;

    if valid {
        info!("Proof is valid");
    } else {
        warn!("Proof is invalid");
    }

    Ok(Json(ApiResponse::success(VerifyResponse { valid })))
}
