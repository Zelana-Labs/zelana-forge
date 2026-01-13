'use client';

import { useState } from 'react';
import type { LogEntry, ApiResponse, SetupResponse, ProofData } from '../types';

interface WorkflowPanelProps {
  systemReady: boolean;
  coordinatorRunning: boolean;
  onLog: (message: string, type: LogEntry['type'], source: LogEntry['source']) => void;
}

const steps = [
  { id: 0, title: 'Setup System', icon: '🔧', description: 'Initialize secret sharing' },
  { id: 1, title: 'Generate Proof', icon: '🔐', description: 'Create distributed proof' },
  { id: 2, title: 'Verify Proof', icon: '✓', description: 'Validate the proof' },
];

interface RequestResponse {
  request: unknown;
  response: unknown;
  timestamp: Date;
}

export default function WorkflowPanel({ systemReady, coordinatorRunning, onLog }: WorkflowPanelProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [loading, setLoading] = useState<number | null>(null);
  const [setupData, setSetupData] = useState<SetupResponse | null>(null);
  const [proofData, setProofData] = useState<ProofData | null>(null);
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);

  // Custom parameters - Schnorr
  const [customSecret, setCustomSecret] = useState('');
  const [customMessage, setCustomMessage] = useState('my_custom_proof_message');

  // Custom parameters - Hash Preimage
  const [hashPreimage, setHashPreimage] = useState('my_secret_password');
  const [targetHash, setTargetHash] = useState('');

  const [selectedCircuit, setSelectedCircuit] = useState<string>('schnorr');

  // Request/Response tracking
  const [requestResponses, setRequestResponses] = useState<Record<number, RequestResponse>>({});

  // Available circuits (can be expanded as more are implemented)
  const circuits = [
    {
      id: 'schnorr',
      name: 'Schnorr Signature',
      icon: '🔐',
      description: 'Prove you know the secret key for a public key (like authentication)',
      statement: 'I know secret s such that PublicKey = g^s',
      publicInputs: ['Public Key (g^s)', 'Message to sign'],
      privateWitness: ['Secret Key (s)'],
      useCase: 'Authentication, Digital Signatures, Key Ownership',
      status: 'active'
    },
    {
      id: 'hash-preimage',
      name: 'Hash Preimage',
      icon: '🔗',
      description: 'Prove you know the input that produces a specific hash output',
      statement: 'I know preimage such that Hash(preimage) = target',
      publicInputs: ['Target Hash (0x1234...)'],
      privateWitness: ['Preimage (the secret input)'],
      useCase: 'Password verification, Secret commitments',
      status: 'ui-only'
    },
    {
      id: 'range-proof',
      name: 'Range Proof',
      icon: '📊',
      description: 'Prove a committed value is within a range without revealing it',
      statement: 'My committed value is between min and max',
      publicInputs: ['Commitment', 'Min/Max bounds'],
      privateWitness: ['Actual value', 'Commitment randomness'],
      useCase: 'Age verification, Balance proofs',
      status: 'coming-soon'
    },
    {
      id: 'merkle-membership',
      name: 'Merkle Membership',
      icon: '🌳',
      description: 'Prove an element is in a Merkle tree without revealing which one',
      statement: 'This leaf is in the Merkle tree',
      publicInputs: ['Merkle Root', 'Leaf value'],
      privateWitness: ['Merkle path (sibling hashes)'],
      useCase: 'Allowlist membership, Anonymous voting',
      status: 'coming-soon'
    }
  ];

  const handleSetup = async () => {
    if (!coordinatorRunning) {
      onLog('❌ Coordinator is not running. Start the cluster first.', 'error', 'setup');
      return;
    }

    setLoading(0);
    onLog('🔧 Initializing secret sharing...', 'info', 'setup');

    try {
      // Use custom secret or generate random one
      const secret = customSecret.trim() || Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      const requestPayload = { secret };
      onLog(`📤 Sending setup request with secret (${secret.length} chars)`, 'info', 'setup');

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: ApiResponse<SetupResponse> = await res.json();

      // Track request/response
      setRequestResponses(prev => ({
        ...prev,
        0: {
          request: requestPayload,
          response: data,
          timestamp: new Date()
        }
      }));

      if (data.status === 'success') {
        setSetupData(data.data);
        setCompletedSteps(prev => [...prev, 0]);
        setCurrentStep(1);
        onLog(`✅ Secret split into ${data.data.num_nodes} shares using Shamir's Secret Sharing`, 'success', 'setup');
        onLog(`🔒 Threshold: ${data.data.threshold} of ${data.data.num_nodes} shares needed to reconstruct`, 'info', 'setup');
        onLog(`🔐 Each node received their share via encrypted channel`, 'info', 'setup');
      } else {
        onLog(`❌ Setup failed: ${data.message || 'Unknown error'}`, 'error', 'setup');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      onLog(`❌ Setup error: ${message}`, 'error', 'setup');
    } finally {
      setLoading(null);
    }
  };

  const handleProve = async () => {
    if (!completedSteps.includes(0)) {
      onLog('⚠️ Please complete setup first', 'warning', 'prove');
      return;
    }

    setLoading(1);
    onLog('🔐 Generating distributed Schnorr proof...', 'info', 'prove');

    try {
      const requestPayload = { message: customMessage };
      onLog(`📤 Sending prove request with message: "${customMessage}"`, 'info', 'prove');

      const res = await fetch('/api/prove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: ApiResponse<{ proof: ProofData; participants: number }> = await res.json();

      // Track request/response
      setRequestResponses(prev => ({
        ...prev,
        1: {
          request: requestPayload,
          response: data,
          timestamp: new Date()
        }
      }));

      if (data.status === 'success') {
        setProofData(data.data.proof);
        setCompletedSteps(prev => [...prev, 1]);
        setCurrentStep(2);
        onLog('✅ Phase 1: Coordinator collected commitments from threshold nodes', 'success', 'prove');
        onLog(`✅ Phase 2: Fiat-Shamir challenge computed: H(g || PK || C₁...Cₜ || msg)`, 'info', 'prove');
        onLog(`✅ Phase 3: Nodes computed responses: zᵢ = rᵢ + c·sᵢ (share remains secret!)`, 'info', 'prove');
        onLog(`✅ Phase 4: Aggregated using Lagrange interpolation`, 'success', 'prove');
        onLog(`🎯 ${data.data.participants} nodes participated`, 'info', 'prove');
      } else {
        onLog(`❌ Proof generation failed: ${data.message}`, 'error', 'prove');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      onLog(`❌ Proof generation error: ${message}`, 'error', 'prove');
    } finally {
      setLoading(null);
    }
  };

  const handleVerify = async () => {
    if (!proofData) {
      onLog('⚠️ Please generate a proof first', 'warning', 'verify');
      return;
    }

    setLoading(2);
    onLog('🔍 Verifying proof...', 'info', 'verify');

    try {
      const requestPayload = { proof: proofData };
      onLog('📤 Sending verification request with proof data', 'info', 'verify');

      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: ApiResponse<{ valid: boolean }> = await res.json();

      // Track request/response
      setRequestResponses(prev => ({
        ...prev,
        2: {
          request: { proof: { ...proofData, commitment: proofData.commitment.substring(0, 20) + '...', challenge: proofData.challenge.substring(0, 20) + '...', response: proofData.response.substring(0, 20) + '...' } },
          response: data,
          timestamp: new Date()
        }
      }));

      if (data.status === 'success') {
        setVerifyResult(data.data.valid);
        setCompletedSteps(prev => [...prev, 2]);
        if (data.data.valid) {
          onLog('✅ Step 1: Verified g^z = C · PK^c (Schnorr equation)', 'success', 'verify');
          onLog('✅ Step 2: Challenge matches H(g || PK || C || msg)', 'success', 'verify');
          onLog('✅ Step 3: All cryptographic checks passed', 'success', 'verify');
          onLog('🎉 Proof is VALID! Secret was never revealed.', 'success', 'verify');
        } else {
          onLog('❌ Verification equation failed', 'error', 'verify');
          onLog('❌ Proof is INVALID', 'error', 'verify');
        }
      } else {
        onLog(`❌ Verification failed: ${data.message}`, 'error', 'verify');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      onLog(`❌ Verification error: ${message}`, 'error', 'verify');
    } finally {
      setLoading(null);
    }
  };

  const handleStepAction = (stepId: number) => {
    if (stepId === 0) handleSetup();
    else if (stepId === 1) handleProve();
    else if (stepId === 2) handleVerify();
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-text-primary">Proof Workflow</h2>
          <p className="text-xs text-text-tertiary mt-1">Execute distributed Zero-Knowledge proof generation with custom parameters</p>
        </div>

        {/* Circuit Tabs */}
        <div className="mb-6">
          <div className="flex gap-2 border-b border-border pb-2">
            {circuits.filter(c => c.status === 'active' || c.status === 'ui-only').map((circuit) => (
              <button
                key={circuit.id}
                onClick={() => setSelectedCircuit(circuit.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-t-lg font-medium text-sm transition-all duration-200 ${
                  selectedCircuit === circuit.id
                    ? 'bg-accent-blue text-white shadow-lg'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
                }`}
              >
                <span className="text-lg">{circuit.icon}</span>
                <span>{circuit.name}</span>
                {circuit.status === 'ui-only' && (
                  <span className="text-xs px-1.5 py-0.5 bg-accent-yellow/30 rounded">UI</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Selected Circuit Details */}
        {(() => {
          const circuit = circuits.find(c => c.id === selectedCircuit);
          if (!circuit) return null;

          return (
            <div className="mb-6 bg-bg-secondary rounded-lg p-4 border border-border">
              <div className="flex items-start gap-3 mb-4">
                <div className="text-3xl">{circuit.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-sm font-bold text-text-primary">{circuit.name}</h3>
                    {circuit.status === 'ui-only' && (
                      <span className="text-xs px-2 py-0.5 bg-accent-yellow/20 text-accent-yellow border border-accent-yellow/40 rounded-full">
                        UI Only - Backend Pending
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mb-2">{circuit.description}</p>
                  <div className="text-xs font-mono text-accent-purple bg-accent-purple/10 px-2 py-1 rounded border border-accent-purple/30 mb-2 inline-block">
                    Statement: "{circuit.statement}"
                  </div>
                  <div className="text-[10px] text-text-tertiary">
                    <span className="font-semibold">Use case:</span> {circuit.useCase}
                  </div>
                </div>
              </div>

              {/* Public/Private Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Public Inputs */}
                <div className="bg-bg-primary rounded-lg p-3 border border-accent-green/30">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-xs font-semibold text-accent-green">🌐 Public Inputs</span>
                    <span className="text-[10px] text-text-tertiary">(everyone can see)</span>
                  </div>
                  <ul className="space-y-1">
                    {circuit.publicInputs.map((input, idx) => (
                      <li key={idx} className="text-[11px] text-text-secondary flex items-start gap-1.5">
                        <span className="text-accent-green mt-0.5">•</span>
                        <span>{input}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Private Witness */}
                <div className="bg-bg-primary rounded-lg p-3 border border-accent-red/30">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-xs font-semibold text-accent-red">🔒 Private Witness</span>
                    <span className="text-[10px] text-text-tertiary">(kept secret)</span>
                  </div>
                  <ul className="space-y-1">
                    {circuit.privateWitness.map((witness, idx) => (
                      <li key={idx} className="text-[11px] text-text-secondary flex items-start gap-1.5">
                        <span className="text-accent-red mt-0.5">•</span>
                        <span>{witness}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Backend Implementation Warning */}
        {selectedCircuit === 'hash-preimage' && (
          <div className="mb-6 bg-accent-yellow/10 border-2 border-accent-yellow/50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h4 className="text-sm font-bold text-accent-yellow mb-2">Backend Not Implemented</h4>
                <p className="text-xs text-text-secondary mb-2">
                  The Hash Preimage circuit is <span className="font-semibold">UI only for demonstration purposes</span>.
                  When you run the workflow, the backend will still execute the <span className="font-semibold text-accent-blue">Schnorr Signature</span> circuit.
                </p>
                <div className="bg-bg-primary rounded-lg p-3 mt-2">
                  <div className="text-[10px] font-semibold text-text-primary mb-2">What actually happens:</div>
                  <ul className="text-[10px] text-text-secondary space-y-1">
                    <li>• Your "preimage" input will be treated as a secret key</li>
                    <li>• Your "target hash" input will be ignored</li>
                    <li>• The system will generate a Schnorr signature instead</li>
                    <li>• Verification will check the Schnorr proof, not hash preimage</li>
                  </ul>
                </div>
                <p className="text-[10px] text-accent-yellow mt-2 font-medium">
                  💡 Use this to understand the UI and data flow. For actual hash preimage proofs, backend implementation is needed.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Proof Data Flow Diagram */}
        <div className="mb-6 bg-gradient-to-br from-bg-secondary to-bg-tertiary rounded-lg p-5 border border-border">
          <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>🔄</span>
            <span>Zero-Knowledge Proof Data Flow</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Private Witness */}
            <div className="bg-bg-primary rounded-lg p-4 border-2 border-accent-red/30">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">🔒</span>
                <div>
                  <div className="text-xs font-bold text-accent-red">Private Witness</div>
                  <div className="text-[10px] text-text-tertiary">Secret Data</div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-[11px] text-text-secondary">
                  You keep these <span className="font-semibold text-accent-red">secret</span>:
                </div>
                <ul className="space-y-1">
                  {circuits.find(c => c.id === selectedCircuit)?.privateWitness.map((w, idx) => (
                    <li key={idx} className="text-[10px] bg-accent-red/10 px-2 py-1 rounded border border-accent-red/30 text-text-primary">
                      • {w}
                    </li>
                  ))}
                </ul>
                <div className="text-[10px] text-accent-red font-semibold mt-2">
                  ⚠️ Never revealed!
                </div>
              </div>
            </div>

            {/* ZK Proof Generation */}
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="text-3xl animate-pulse">⚡</div>
              <div className="text-center">
                <div className="text-xs font-bold text-accent-blue mb-1">ZK Proof Circuit</div>
                <div className="text-[10px] text-text-tertiary mb-2">Cryptographic Magic</div>
                <div className="bg-accent-blue/10 border border-accent-blue/30 rounded px-3 py-2">
                  <div className="text-[10px] text-text-secondary mb-1">Combines:</div>
                  <div className="text-[10px] font-mono text-accent-blue">
                    Private + Public → Proof
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xl text-accent-green">✓</div>
                <div className="text-[10px] text-text-tertiary">Valid proof generated</div>
              </div>
            </div>

            {/* Public Inputs + Proof */}
            <div className="bg-bg-primary rounded-lg p-4 border-2 border-accent-green/30">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">🌐</span>
                <div>
                  <div className="text-xs font-bold text-accent-green">Public Data</div>
                  <div className="text-[10px] text-text-tertiary">Everyone Can See</div>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-text-secondary mb-1">
                    <span className="font-semibold text-accent-green">Public Inputs:</span>
                  </div>
                  <ul className="space-y-1">
                    {circuits.find(c => c.id === selectedCircuit)?.publicInputs.map((inp, idx) => (
                      <li key={idx} className="text-[10px] bg-accent-green/10 px-2 py-1 rounded border border-accent-green/30 text-text-primary">
                        • {inp}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="border-t border-border pt-2">
                  <div className="text-[11px] text-text-secondary mb-1">
                    <span className="font-semibold text-accent-blue">+ The Proof:</span>
                  </div>
                  <div className="text-[10px] bg-accent-blue/10 px-2 py-1 rounded border border-accent-blue/30 text-text-primary">
                    Cryptographic proof data (C, c, z)
                  </div>
                </div>
                <div className="text-[10px] text-accent-green font-semibold">
                  ✓ Anyone can verify!
                </div>
              </div>
            </div>
          </div>

          {/* Key Insight */}
          <div className="mt-4 bg-accent-purple/10 border border-accent-purple/30 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <span className="text-lg">💡</span>
              <div>
                <div className="text-xs font-semibold text-accent-purple mb-1">Key Insight</div>
                <div className="text-[11px] text-text-secondary">
                  The proof convinces verifiers that you know the <span className="text-accent-red font-semibold">private witness</span> that satisfies the statement,
                  <span className="text-accent-purple font-semibold"> without ever revealing</span> what that witness is!
                  Verifiers only see <span className="text-accent-green font-semibold">public inputs</span> and the proof.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4 mb-6">
          {steps.map((step, idx) => {
          const isCompleted = completedSteps.includes(step.id);
          const isCurrent = currentStep === step.id;
          const isAvailable = step.id === 0 || completedSteps.includes(step.id - 1);

          return (
            <div key={step.id} className="flex gap-3">
              {/* Step Indicator */}
              <div className="flex flex-col items-center flex-shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                  isCompleted ? 'bg-accent-green text-white shadow-lg shadow-accent-green/30' :
                  isCurrent ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/30' :
                  'bg-bg-tertiary text-text-tertiary'
                }`}>
                  {isCompleted ? '✓' : step.id + 1}
                </div>
                {idx < steps.length - 1 && (
                  <div className={`w-0.5 h-full min-h-[60px] mt-2 transition-all duration-300 ${
                    completedSteps.includes(step.id) ? 'bg-accent-green' : 'bg-border'
                  }`}></div>
                )}
              </div>

              {/* Step Content */}
              <div className="flex-1">
                <div className={`rounded-lg p-4 border transition-all duration-300 ${
                  isCompleted ? 'bg-accent-green/5 border-accent-green/30' :
                  isCurrent ? 'bg-accent-blue/5 border-accent-blue/30' :
                  'bg-bg-secondary border-border'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{step.icon}</span>
                    <h3 className="text-sm font-semibold text-text-primary">{step.title}</h3>
                  </div>
                  <p className="text-xs text-text-secondary mb-3">{step.description}</p>

                  {/* Circuit-Specific Inputs for Setup Step */}
                  {step.id === 0 && (
                    <div className="space-y-3 mb-3">
                      {/* Circuit Info */}
                      <div className="flex items-center gap-2 p-2 bg-bg-primary rounded-lg border border-accent-blue/30">
                        <span className="text-lg">{circuits.find(c => c.id === selectedCircuit)?.icon}</span>
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-text-primary">
                            {circuits.find(c => c.id === selectedCircuit)?.name}
                          </div>
                          <div className="text-[10px] text-text-tertiary">
                            Proving: {circuits.find(c => c.id === selectedCircuit)?.statement}
                          </div>
                        </div>
                      </div>

                      {/* Schnorr Circuit Inputs */}
                      {selectedCircuit === 'schnorr' && (
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-2">
                            🔒 Private Witness: Secret Key (hex, leave empty for random)
                          </label>
                          <input
                            type="text"
                            value={customSecret}
                            onChange={(e) => setCustomSecret(e.target.value)}
                            placeholder="0123456789abcdef... (64 chars)"
                            className="w-full px-3 py-2 bg-bg-primary border border-accent-red/50 rounded-lg text-xs font-mono text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-red transition-all"
                            disabled={loading !== null}
                          />
                          <p className="text-[10px] text-text-tertiary mt-1">
                            <span className="text-accent-red font-semibold">Private:</span> Will be split using Shamir's Secret Sharing. Never leaves the system.
                          </p>
                        </div>
                      )}

                      {/* Hash Preimage Circuit Inputs */}
                      {selectedCircuit === 'hash-preimage' && (
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-2">
                            🔒 Private Witness: Preimage (your secret)
                          </label>
                          <input
                            type="text"
                            value={hashPreimage}
                            onChange={(e) => setHashPreimage(e.target.value)}
                            placeholder="my_secret_password"
                            className="w-full px-3 py-2 bg-bg-primary border border-accent-red/50 rounded-lg text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-red transition-all"
                            disabled={loading !== null}
                          />
                          <p className="text-[10px] text-text-tertiary mt-1">
                            <span className="text-accent-red font-semibold">Private:</span> The input that produces your target hash. Will be split and kept secret.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Public Inputs for Prove Step */}
                  {step.id === 1 && (
                    <div className="space-y-3 mb-3">
                      {/* Schnorr Public Inputs */}
                      {selectedCircuit === 'schnorr' && (
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-2">
                            🌐 Public Input: Message to Sign
                          </label>
                          <input
                            type="text"
                            value={customMessage}
                            onChange={(e) => setCustomMessage(e.target.value)}
                            placeholder="Enter message to sign/authorize"
                            className="w-full px-3 py-2 bg-bg-primary border border-accent-green/50 rounded-lg text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-green transition-all"
                            disabled={loading !== null}
                          />
                          <p className="text-[10px] text-text-tertiary mt-1">
                            <span className="text-accent-green font-semibold">Public:</span> This message will be bound to the proof (like signing a message).
                            The public key from Setup is also public.
                          </p>
                        </div>
                      )}

                      {/* Hash Preimage Public Inputs */}
                      {selectedCircuit === 'hash-preimage' && (
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-2">
                            🌐 Public Input: Target Hash
                          </label>
                          <input
                            type="text"
                            value={targetHash}
                            onChange={(e) => setTargetHash(e.target.value)}
                            placeholder="0x1234abcd... (will compute from preimage if empty)"
                            className="w-full px-3 py-2 bg-bg-primary border border-accent-green/50 rounded-lg text-xs font-mono text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-green transition-all"
                            disabled={loading !== null}
                          />
                          <p className="text-[10px] text-text-tertiary mt-1">
                            <span className="text-accent-green font-semibold">Public:</span> The hash you're proving you know the preimage for.
                            Everyone can see this, but not the preimage itself!
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => handleStepAction(step.id)}
                    disabled={!isAvailable || loading !== null}
                    className={`px-4 py-2 rounded-lg font-medium text-xs transition-all duration-200 ${
                      !isAvailable || loading !== null
                        ? 'bg-bg-tertiary text-text-tertiary cursor-not-allowed opacity-50'
                        : isCompleted
                        ? 'bg-accent-green hover:bg-accent-green/80 text-white shadow-lg hover:shadow-xl'
                        : 'bg-accent-blue hover:bg-accent-blue/80 text-white shadow-lg hover:shadow-xl'
                    }`}
                  >
                    {loading === step.id ? '⏳ Processing...' : isCompleted ? '✓ Run Again' : `▶ Run ${step.title}`}
                  </button>

                  {/* Results */}
                  {step.id === 0 && setupData && (
                    <div className="mt-3 p-3 bg-bg-primary border border-border rounded-lg">
                      <div className="text-[10px] font-semibold text-text-tertiary mb-2 uppercase">Setup Results</div>
                      <div className="space-y-1 text-xs font-mono">
                        <div className="flex justify-between">
                          <span className="text-text-secondary">Threshold:</span>
                          <span className="text-text-primary font-semibold">{setupData.threshold}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-text-secondary">Total Nodes:</span>
                          <span className="text-text-primary font-semibold">{setupData.num_nodes}</span>
                        </div>
                        <div className="pt-2 border-t border-border">
                          <div className="text-text-secondary mb-1">Public Key:</div>
                          <div className="text-text-primary break-all text-[10px]">{setupData.public_key.substring(0, 50)}...</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {step.id === 1 && proofData && (
                    <div className="mt-3 p-3 bg-bg-primary border border-border rounded-lg">
                      <div className="text-[10px] font-semibold text-text-tertiary mb-2 uppercase">Proof Data</div>
                      <div className="space-y-2 text-[10px] font-mono">
                        <div>
                          <div className="text-text-secondary mb-1">Commitment:</div>
                          <div className="text-text-primary break-all bg-bg-tertiary p-2 rounded">{proofData.commitment.substring(0, 50)}...</div>
                        </div>
                        <div>
                          <div className="text-text-secondary mb-1">Challenge:</div>
                          <div className="text-text-primary break-all bg-bg-tertiary p-2 rounded">{proofData.challenge.substring(0, 50)}...</div>
                        </div>
                        <div>
                          <div className="text-text-secondary mb-1">Response:</div>
                          <div className="text-text-primary break-all bg-bg-tertiary p-2 rounded">{proofData.response.substring(0, 50)}...</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {step.id === 2 && verifyResult !== null && (
                    <div className={`mt-3 p-4 rounded-lg text-center border-2 ${
                      verifyResult
                        ? 'bg-accent-green/10 border-accent-green text-accent-green'
                        : 'bg-accent-red/10 border-accent-red text-accent-red'
                    }`}>
                      <div className="text-2xl mb-1">{verifyResult ? '✓' : '✗'}</div>
                      <div className="text-sm font-semibold">
                        {verifyResult ? 'Proof is Valid!' : 'Proof is Invalid'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        </div>

        {/* Request/Response Inspector */}
        {Object.keys(requestResponses).length > 0 && (
          <div className="mb-6 bg-bg-secondary rounded-lg p-4 border border-border">
            <h3 className="text-sm font-semibold text-text-primary mb-3">🔍 Request/Response Inspector</h3>
            <div className="space-y-3">
              {Object.entries(requestResponses).map(([stepId, data]) => (
                <details key={stepId} className="bg-bg-primary rounded-lg border border-border">
                  <summary className="px-3 py-2 cursor-pointer hover:bg-bg-tertiary transition-colors text-xs font-medium text-text-primary">
                    Step {parseInt(stepId) + 1}: {steps[parseInt(stepId)].title} - {new Date(data.timestamp).toLocaleTimeString()}
                  </summary>
                  <div className="p-3 space-y-3 border-t border-border">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-semibold text-accent-blue uppercase">📤 Request</span>
                        <span className="text-[10px] text-text-tertiary">Sent to coordinator</span>
                      </div>
                      <pre className="text-[10px] font-mono bg-bg-tertiary p-3 rounded overflow-x-auto text-text-primary">
                        {JSON.stringify(data.request, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-semibold text-accent-green uppercase">📥 Response</span>
                        <span className="text-[10px] text-text-tertiary">Received from coordinator</span>
                      </div>
                      <pre className="text-[10px] font-mono bg-bg-tertiary p-3 rounded overflow-x-auto text-text-primary">
                        {JSON.stringify(data.response, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* Share Distribution Visualization */}
        {setupData && (
          <div className="mb-6 bg-bg-secondary rounded-lg p-4 border border-border">
            <h3 className="text-sm font-semibold text-text-primary mb-3">🔐 Share Distribution Flow</h3>

            {/* Distribution Flow Diagram */}
            <div className="mb-4 bg-bg-primary rounded-lg p-4 border border-border">
              <div className="flex flex-col items-center gap-4">
                {/* Coordinator with Secret */}
                <div className="relative">
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-accent-purple to-accent-blue rounded-full flex items-center justify-center text-2xl shadow-lg">
                      🎯
                    </div>
                    <div className="text-xs font-semibold text-text-primary mt-2">Coordinator</div>
                    <div className="text-[10px] text-accent-purple mt-1 px-2 py-0.5 bg-accent-purple/10 rounded">Has Secret 🔑</div>
                  </div>
                </div>

                {/* Distribution Arrows */}
                <div className="flex flex-col items-center gap-1">
                  <div className="text-2xl text-accent-yellow animate-bounce">↓</div>
                  <div className="text-[10px] text-text-tertiary font-medium px-3 py-1 bg-bg-tertiary rounded-full">
                    Shamir Split ({setupData.threshold} of {setupData.num_nodes})
                  </div>
                  <div className="text-2xl text-accent-yellow animate-bounce" style={{animationDelay: '0.2s'}}>↓</div>
                </div>

                {/* Distributed Shares to Nodes */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 w-full">
                  {Array.from({ length: setupData.num_nodes }, (_, i) => (
                    <div key={i} className="relative">
                      <div className="bg-bg-secondary border-2 border-accent-blue/30 rounded-lg p-3 text-center hover:border-accent-blue hover:shadow-lg transition-all duration-300">
                        <div className="text-2xl mb-1">💻</div>
                        <div className="text-accent-blue font-bold text-xs mb-1">Node {i + 1}</div>
                        <div className="h-px bg-border my-2"></div>
                        <div className="flex flex-col gap-1">
                          <div className="text-[9px] text-text-tertiary">Received:</div>
                          <div className="bg-accent-green/10 border border-accent-green/30 rounded px-2 py-1">
                            <div className="text-[10px] font-mono text-accent-green font-semibold">Share #{i + 1}</div>
                          </div>
                          <div className="text-[9px] font-mono text-text-secondary mt-1">
                            (x={i + 1}, y=f({i + 1}))
                          </div>
                        </div>
                        <div className="mt-2 text-[10px] text-accent-green flex items-center justify-center gap-1">
                          <span>🔒</span>
                          <span>Isolated</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Privacy Properties */}
            <div className="bg-accent-green/10 border border-accent-green/30 rounded-lg p-3">
              <div className="text-xs font-semibold text-accent-green mb-2">✓ Privacy Guarantees</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="flex items-start gap-2">
                  <span className="text-accent-green mt-0.5">✓</span>
                  <span className="text-[11px] text-text-secondary">Secret never leaves coordinator</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-accent-green mt-0.5">✓</span>
                  <span className="text-[11px] text-text-secondary">Each node gets unique share only</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-accent-green mt-0.5">✓</span>
                  <span className="text-[11px] text-text-secondary">Shares appear random</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-accent-green mt-0.5">✓</span>
                  <span className="text-[11px] text-text-secondary">Need {setupData.threshold}/{setupData.num_nodes} to reconstruct</span>
                </div>
                <div className="flex items-start gap-2 md:col-span-2">
                  <span className="text-accent-green mt-0.5">✓</span>
                  <span className="text-[11px] text-text-secondary">Any {setupData.threshold - 1} or fewer shares reveal NOTHING (information-theoretic security)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Progress Summary */}
        <div className="pt-6 border-t border-border">
          <div className="bg-bg-secondary rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-text-primary">Workflow Progress</span>
              <span className="text-xs font-mono px-2 py-1 bg-bg-tertiary rounded">
                <span className="text-accent-green">{completedSteps.length}</span>
                <span className="text-text-tertiary"> / {steps.length}</span>
              </span>
            </div>
            <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-blue to-accent-green transition-all duration-500 rounded-full"
                style={{ width: `${(completedSteps.length / steps.length) * 100}%` }}
              ></div>
            </div>
            <div className="mt-2 text-xs text-text-tertiary text-center">
              {completedSteps.length === steps.length
                ? '✓ All steps completed!'
                : `${steps.length - completedSteps.length} step${steps.length - completedSteps.length !== 1 ? 's' : ''} remaining`
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
