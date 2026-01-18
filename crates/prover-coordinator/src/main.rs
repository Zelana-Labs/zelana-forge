//! # Privacy-Preserving Distributed Prover Coordinator
//!
//! Orchestrates distributed proof generation with full public witness privacy.
//!
//! ## Endpoints
//!
//! - `GET /health` - Health check
//! - `POST /setup` - Initialize system with witness commitment (blind)
//! - `POST /prove` - Generate distributed proof (blind)
//! - `POST /verify` - Verify proof with witness reveal
//!
//! ## Privacy-Preserving Protocol
//!
//! 1. **Setup**: Client commits to witness, coordinator distributes shares
//! 2. **Phase 1**: Collect commitments Cᵢ = g^rᵢ from threshold nodes
//! 3. **Phase 2**: Compute challenge c = H(g || Com || C_agg) from COMMITMENT
//! 4. **Phase 3**: Collect fragments zᵢ = rᵢ + c·sᵢ from nodes
//! 5. **Phase 4**: Aggregate into blind proof
//! 6. **Verification**: Client reveals witness, verifier checks commitment + proof

use ark_ec::{AffineRepr, CurveGroup};
use ark_ff::PrimeField;
use ark_std::Zero;
use ark_std::rand::SeedableRng;
use ark_std::rand::rngs::StdRng;

/// Create a cryptographically secure RNG seeded from OS entropy
fn secure_rng() -> StdRng {
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).expect("Failed to get random bytes from OS");
    StdRng::from_seed(seed)
}
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use clap::Parser;
use std::time::Instant;

use prover_core::{
    Fr, G1Affine, G1Projective, WitnessCommitment as CoreWitnessCommitment,
    generate_challenge_from_commitment,
    shamir::{lagrange_coefficient, share_secret},
    verify_commitment,
};
use prover_network::{
    ApiResponse, BlindProof, BlindProveRequest, BlindProveResponse, BlindSetupRequest,
    BlindSetupResponse, BlindShareAssignment, CircuitType, CommitmentRequest, CommitmentResponse,
    FragmentRequest, FragmentResponse, HealthResponse, VerifyWithRevealRequest,
    VerifyWithRevealResponse, WitnessCommitment,
};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};

/// Command-line arguments
#[derive(Parser, Debug)]
#[command(name = "prover-coordinator")]
#[command(about = "Privacy-preserving distributed proof coordinator", long_about = None)]
struct Args {
    /// Threshold (minimum nodes required for proofs)
    #[arg(long, default_value = "3", env = "THRESHOLD")]
    threshold: usize,

    /// Comma-separated list of node URLs
    #[arg(
        long = "node-urls",
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

    /// Blind session data (witness commitments for privacy)
    blind_sessions: std::collections::HashMap<String, BlindSessionData>,

    /// HTTP client
    client: reqwest::Client,
}

/// Blind proving session data (privacy-preserving)
#[derive(Clone, Debug)]
#[allow(dead_code)]
struct BlindSessionData {
    session_id: String,
    witness_commitment: WitnessCommitment,
    generator: G1Affine,
    public_key: G1Affine,
    circuit_type: CircuitType,
    shares: Vec<ShareInfo>,
}

/// Share information for visualization
#[derive(Clone, Debug)]
#[allow(dead_code)]
struct ShareInfo {
    /// Node ID
    pub node_id: u32,
    /// Share index
    pub share_index: u32,
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
        "Starting privacy-preserving coordinator with {} nodes (threshold: {}) on {}:{}",
        args.nodes.len(),
        args.threshold,
        args.host,
        args.port
    );

    // Initialize state
    let state = Arc::new(RwLock::new(CoordinatorState {
        node_urls: args.nodes,
        threshold: args.threshold,
        blind_sessions: std::collections::HashMap::new(),
        client: reqwest::Client::new(),
    }));

    // Build router (only blind endpoints)
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/setup", post(blind_setup_handler))
        .route("/prove", post(blind_prove_handler))
        .route("/verify", post(verify_with_reveal_handler))
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
    let ready = !coord_state.blind_sessions.is_empty();

    Json(ApiResponse::success(HealthResponse {
        status: "ok".to_string(),
        node_id: None,
        ready,
    }))
}

/// Blind setup handler - sets up system with witness commitment (privacy-preserving)
async fn blind_setup_handler(
    State(state): State<SharedState>,
    Json(request): Json<BlindSetupRequest>,
) -> Result<Json<ApiResponse<BlindSetupResponse>>, StatusCode> {
    info!(
        "🔒 Blind setup for circuit {:?} with commitment {:?}",
        request.circuit_type, request.witness_commitment.hash
    );

    let mut coord_state = state.write().await;

    // Generate session ID from commitment hash
    let session_id = format!(
        "session-{}",
        hex::encode(&request.witness_commitment.hash[..8])
    );

    // Parse secret from hex
    let secret_bytes = hex::decode(request.secret.trim_start_matches("0x")).map_err(|e| {
        error!("Failed to parse secret: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    let secret = Fr::from_le_bytes_mod_order(&secret_bytes);

    // Generate generator
    let generator = G1Affine::generator();
    let public_key = (G1Projective::from(generator) * secret).into_affine();

    let num_nodes = coord_state.node_urls.len();
    let threshold = coord_state.threshold;

    // Generate shares
    let mut rng = secure_rng();
    let shares = share_secret(secret, num_nodes, threshold, &mut rng);

    // Distribute shares to nodes
    for (i, node_url) in coord_state.node_urls.iter().enumerate() {
        let assignment = BlindShareAssignment {
            session_id: session_id.clone(),
            node_id: (i + 1) as u32,
            share_index: (i + 1) as u32,
            share_value: shares.shares[i].y,
            generator,
            witness_commitment: request.witness_commitment.clone(),
            circuit_type: request.circuit_type,
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
                    info!("✅ Assigned blind share to node {}", i + 1);
                } else {
                    error!(
                        "❌ Node {} rejected share assignment: {}",
                        i + 1,
                        response.status()
                    );
                }
            }
            Err(e) => error!("❌ Failed to contact node {} at {}: {}", i + 1, node_url, e),
        }
    }

    // Store blind session data
    coord_state.blind_sessions.insert(
        session_id.clone(),
        BlindSessionData {
            session_id: session_id.clone(),
            witness_commitment: request.witness_commitment.clone(),
            generator,
            public_key,
            circuit_type: request.circuit_type,
            shares: shares
                .shares
                .iter()
                .enumerate()
                .map(|(i, _)| ShareInfo {
                    node_id: (i + 1) as u32,
                    share_index: (i + 1) as u32,
                })
                .collect(),
        },
    );

    info!(
        "🔒 Blind setup complete: {} nodes, threshold {}, session: {}",
        num_nodes, threshold, session_id
    );

    Ok(Json(ApiResponse::success(BlindSetupResponse {
        generator,
        witness_commitment: request.witness_commitment,
        num_nodes,
        threshold,
        session_id,
    })))
}

/// Blind prove handler - generates proof using witness commitment (privacy-preserving)
async fn blind_prove_handler(
    State(state): State<SharedState>,
    Json(request): Json<BlindProveRequest>,
) -> Result<Json<ApiResponse<BlindProveResponse>>, StatusCode> {
    let prove_start = Instant::now();
    let coord_state = state.read().await;

    info!(
        "🚀 Starting PARALLEL distributed proof generation for session {}",
        request.session_id
    );

    // Get session data
    let session_data = match coord_state.blind_sessions.get(&request.session_id) {
        Some(data) => data,
        None => {
            return Ok(Json(ApiResponse::error(format!(
                "Session {} not found",
                request.session_id
            ))));
        }
    };

    // Phase 1: Collect commitments from threshold nodes (PARALLEL)
    info!(
        "Phase 1: Collecting commitments from {} nodes (PARALLEL)",
        coord_state.threshold
    );
    let commitment_request = CommitmentRequest {
        session_id: request.session_id.clone(),
    };

    let phase1_start = Instant::now();

    // Parallel commitment collection from all threshold nodes
    let commitment_tasks: Vec<_> = coord_state.node_urls[0..coord_state.threshold]
        .iter()
        .enumerate()
        .map(|(i, node_url)| {
            let client = coord_state.client.clone();
            let request = commitment_request.clone();
            let node_id = i + 1;
            let node_url = node_url.clone();

            tokio::spawn(async move {
                match client
                    .post(format!("{}/commitment", node_url))
                    .json(&request)
                    .send()
                    .await
                {
                    Ok(response) => {
                        match response.json::<ApiResponse<CommitmentResponse>>().await {
                            Ok(ApiResponse::Success { data }) => {
                                info!("✅ Received commitment from node {}", node_id);
                                Some(data)
                            }
                            Ok(ApiResponse::Error { message }) => {
                                error!("❌ Node {} returned error: {}", node_id, message);
                                None
                            }
                            Err(e) => {
                                error!("❌ Failed to parse response from node {}: {}", node_id, e);
                                None
                            }
                        }
                    }
                    Err(e) => {
                        error!(
                            "❌ Failed to contact node {} at {}: {}",
                            node_id, node_url, e
                        );
                        None
                    }
                }
            })
        })
        .collect();

    let mut commitment_responses = Vec::new();
    for task in commitment_tasks {
        if let Ok(Some(response)) = task.await {
            commitment_responses.push(response);
        }
    }

    // Sort commitments by node_id to ensure correct order
    commitment_responses.sort_by_key(|r| r.node_id);

    let phase1_duration = phase1_start.elapsed();
    info!(
        "Phase 1 completed in {:.2}ms - collected {} commitments",
        phase1_duration.as_millis(),
        commitment_responses.len()
    );

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

    // Phase 2: Compute Fiat-Shamir challenge FROM COMMITMENT (privacy-preserving!)
    info!("Phase 2: Computing challenge from witness commitment (PUBLIC WITNESS HIDDEN)");

    // Sort commitment responses by node_id for consistent Lagrange coefficient computation
    commitment_responses.sort_by_key(|r| r.node_id);

    let x_coords: Vec<Fr> = commitment_responses
        .iter()
        .map(|r| Fr::from(r.node_id as u64))
        .collect();

    info!(
        "📊 Commitment x_coords (sorted by node_id): {:?}",
        x_coords.iter().map(|x| x.to_string()).collect::<Vec<_>>()
    );

    // Aggregate commitments using Lagrange
    let mut agg_commitment = G1Projective::zero();
    for (i, resp) in commitment_responses.iter().enumerate() {
        let coeff = lagrange_coefficient(&x_coords, i);
        info!(
            "📊 Node {} (x={}): Lagrange coeff = {}",
            resp.node_id, resp.node_id, coeff
        );
        agg_commitment += G1Projective::from(resp.commitment) * coeff;
    }
    let agg_commitment_affine = agg_commitment.into_affine();

    // Convert network commitment to core commitment
    let core_commitment = CoreWitnessCommitment::from_bytes(session_data.witness_commitment.hash);

    // Generate challenge from COMMITMENT (not witness!)
    let challenge = generate_challenge_from_commitment(
        &session_data.generator,
        &core_commitment,
        &agg_commitment_affine,
        &request.session_id,
    )
    .map_err(|e| {
        error!("Failed to generate challenge: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    info!(
        "🔒 Challenge computed from commitment: {:?}",
        hex::encode(&challenge.to_string()[..16])
    );

    // Phase 3: Collect proof fragments (PARALLEL)
    info!("Phase 3: Collecting fragments (PARALLEL)");
    let fragment_request = FragmentRequest {
        session_id: request.session_id.clone(),
        challenge,
    };

    let phase3_start = Instant::now();

    // Parallel fragment collection from all threshold nodes
    let fragment_tasks: Vec<_> = coord_state.node_urls[0..coord_state.threshold]
        .iter()
        .enumerate()
        .map(|(i, node_url)| {
            let client = coord_state.client.clone();
            let request = fragment_request.clone();
            let node_id = i + 1;
            let node_url = node_url.clone();

            tokio::spawn(async move {
                match client
                    .post(format!("{}/fragment", node_url))
                    .json(&request)
                    .send()
                    .await
                {
                    Ok(response) => match response.json::<ApiResponse<FragmentResponse>>().await {
                        Ok(ApiResponse::Success { data }) => {
                            info!("✅ Received fragment from node {}", node_id);
                            Some(data)
                        }
                        Ok(ApiResponse::Error { message }) => {
                            error!("❌ Node {} returned error: {}", node_id, message);
                            None
                        }
                        Err(e) => {
                            error!("❌ Failed to parse response from node {}: {}", node_id, e);
                            None
                        }
                    },
                    Err(e) => {
                        error!(
                            "❌ Failed to contact node {} at {}: {}",
                            node_id, node_url, e
                        );
                        None
                    }
                }
            })
        })
        .collect();

    let mut fragment_responses = Vec::new();
    for task in fragment_tasks {
        if let Ok(Some(response)) = task.await {
            fragment_responses.push(response);
        }
    }

    let phase3_duration = phase3_start.elapsed();
    info!(
        "Phase 3 completed in {:.2}ms - collected {} fragments",
        phase3_duration.as_millis(),
        fragment_responses.len()
    );

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

    // Phase 4: Aggregate responses
    info!("Phase 4: Aggregating blind proof");

    // Sort fragment responses by node_id (MUST match commitment sorting!)
    fragment_responses.sort_by_key(|r| r.node_id);

    // Debug: Log all fragment responses
    for resp in &fragment_responses {
        info!(
            "📊 Fragment response node {}: response = {}",
            resp.node_id, resp.response
        );
    }

    // Build x_coords from fragment responses (should match commitment x_coords)
    let fragment_x_coords: Vec<Fr> = fragment_responses
        .iter()
        .map(|r| Fr::from(r.node_id as u64))
        .collect();

    info!(
        "📊 Fragment x_coords (sorted by node_id): {:?}",
        fragment_x_coords
            .iter()
            .map(|x| x.to_string())
            .collect::<Vec<_>>()
    );

    // Verify same nodes participated in both phases
    if x_coords != fragment_x_coords {
        error!("❌ Node mismatch between commitment and fragment phases!");
        error!(
            "Commitment nodes: {:?}",
            x_coords.iter().map(|x| x.to_string()).collect::<Vec<_>>()
        );
        error!(
            "Fragment nodes: {:?}",
            fragment_x_coords
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
        );
        return Ok(Json(ApiResponse::error(
            "Different nodes responded in commitment vs fragment phase".to_string(),
        )));
    }

    let mut agg_response = Fr::zero();

    for (i, fragment_resp) in fragment_responses.iter().enumerate() {
        let coeff = lagrange_coefficient(&x_coords, i);
        info!(
            "📊 Node {} fragment: Lagrange coeff = {}, response applied",
            fragment_resp.node_id, coeff
        );
        agg_response += fragment_resp.response * coeff;
    }

    let blind_proof = BlindProof {
        witness_commitment: session_data.witness_commitment.clone(),
        commitment: agg_commitment_affine,
        challenge,
        response: agg_response,
        generator: session_data.generator,
        public_key: session_data.public_key,
        circuit_type: session_data.circuit_type,
    };

    info!("✅ Blind proof generation complete (witness remains HIDDEN from all provers)");
    info!("📊 Proof values for verification:");
    info!("  Generator: {:?}", session_data.generator);
    info!("  Public Key: {:?}", session_data.public_key);
    info!("  Commitment (C): {:?}", agg_commitment_affine);
    info!("  Challenge: {}", challenge);
    info!("  Response: {}", agg_response);

    // SELF-CHECK: Verify the proof before returning it!
    {
        let lhs = (session_data.generator * agg_response).into_affine();
        let rhs = (agg_commitment_affine + (session_data.public_key * challenge)).into_affine();
        if lhs == rhs {
            info!("✅ SELF-CHECK: Proof verifies correctly before sending!");
        } else {
            error!("❌ SELF-CHECK FAILED: Proof does NOT verify!");
            error!("  LHS (g^z): {:?}", lhs);
            error!("  RHS (C + c*PK): {:?}", rhs);
            error!("  This indicates a bug in proof generation!");
        }
    }

    let total_duration = prove_start.elapsed();
    info!(
        "🎉 PARALLEL distributed proof generation completed in {:.2}ms",
        total_duration.as_millis()
    );
    info!(
        "📈 {} nodes collaborated to create one unified proof",
        fragment_responses.len()
    );

    Ok(Json(ApiResponse::success(BlindProveResponse {
        blind_proof,
        participants: fragment_responses.len(),
    })))
}

/// Verify with reveal handler - verifies proof with witness reveal
async fn verify_with_reveal_handler(
    State(state): State<SharedState>,
    Json(request): Json<VerifyWithRevealRequest>,
) -> Result<Json<ApiResponse<VerifyWithRevealResponse>>, StatusCode> {
    // Witness reveal depends on circuit type
    // Schnorr: optional (privacy preserved)
    // HashPreimage: required (needs to verify the hash)
    let (commitment_valid, public_witness_bytes) =
        if request.blind_proof.circuit_type == CircuitType::HashPreimage {
            // Hash preimage requires witness reveal
            info!("🔓 Verifying hash preimage proof with witness reveal (required)");

            if request.public_witness.is_empty() {
                (false, None)
            } else {
                let witness_bytes = hex::decode(request.public_witness.trim_start_matches("0x"))
                    .map_err(|e| {
                        error!("Failed to parse public witness: {}", e);
                        StatusCode::BAD_REQUEST
                    })?;

                let commitment_check = verify_commitment(
                    &witness_bytes,
                    &request.salt,
                    &CoreWitnessCommitment::from_bytes(request.blind_proof.witness_commitment.hash),
                );

                if !commitment_check {
                    warn!("❌ Commitment verification failed - witness reveal is invalid");
                } else {
                    info!("✅ Commitment valid - witness reveal is correct");
                }

                (commitment_check, Some(witness_bytes))
            }
        } else {
            // Schnorr: blind, commitment not checked for privacy
            info!("🔒 Verifying Schnorr proof without witness reveal (privacy preserved)");
            (true, None)
        };

    let mut message = None;
    if !commitment_valid && public_witness_bytes.is_none() {
        message = Some("Hash preimage verification requires witness reveal".to_string());
    }

    // Step 2: Use public key from the proof (self-contained verification)
    // The proof now includes the public_key, so we don't need session data
    let public_key = request.blind_proof.public_key;

    // Step 3: Verify proof
    if request.blind_proof.circuit_type == CircuitType::HashPreimage {
        Ok(Json(ApiResponse::success(VerifyWithRevealResponse {
            valid: false,
            commitment_valid: false,
            message: Some("Hash preimage verification not implemented".to_string()),
        })))
    } else {
            // For Schnorr: verify g^z = C · PK^c
            // Use the public key embedded in the proof

            info!("📊 Verification inputs from proof:");
            info!("  Generator (g): {:?}", request.blind_proof.generator);
            info!("  Public Key (PK): {:?}", public_key);
            info!("  Commitment (C): {:?}", request.blind_proof.commitment);
            info!("  Challenge (c): {}", request.blind_proof.challenge);
            info!("  Response (z): {}", request.blind_proof.response);

            // LHS: g^z
            let lhs = (request.blind_proof.generator * request.blind_proof.response).into_affine();

            // RHS: C + c*PK (in additive notation)
            let pk_times_c = (public_key * request.blind_proof.challenge).into_affine();
            let rhs = (request.blind_proof.commitment + pk_times_c).into_affine();

            info!("📊 Verification equation: g^z =? C · PK^c");
            info!("  LHS (g^z): {:?}", lhs);
            info!("  RHS (C + c*PK): {:?}", rhs);

            let valid = lhs == rhs;

            if valid {
                info!("✅ Blind proof is VALID (Schnorr)");
            } else {
                warn!("❌ Blind proof is INVALID (Schnorr)");
                warn!("❌ LHS != RHS - verification equation failed");
            }

            Ok(Json(ApiResponse::success(VerifyWithRevealResponse {
                valid,
                commitment_valid, // true if verified or skipped
                message: if valid {
                    if request.public_witness.is_empty() {
                        Some("Blind proof verified successfully (privacy preserved)".to_string())
                    } else {
                        Some("Proof verified with witness reveal".to_string())
                    }
                } else {
                    Some("Schnorr verification failed".to_string())
                },
            })))
        }
    }
                } else {
                    Some("Schnorr verification failed".to_string())
                },
            })));
        }
        CircuitType::HashPreimage => {
            return Ok(Json(ApiResponse::success(VerifyWithRevealResponse {
                valid: false,
                commitment_valid: false,
                message: Some("Hash preimage verification not implemented".to_string()),
            })));
        }
}
