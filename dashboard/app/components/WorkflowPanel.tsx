'use client';

import { useState } from 'react';
import type { LogEntry, ApiResponse, SetupResponse, ProofData } from '../types';
import { commitToWitness, generateSalt, generateSessionId } from '../utils/crypto';
import {
  getAllCircuits,
  getCircuitHandler,
  getCircuitMetadata,
  isCircuitActive,
  type CircuitInputField,
  type CircuitSetupInputs,
} from '../circuits';

interface WorkflowPanelProps {
  systemReady: boolean;
  coordinatorRunning: boolean;
  onLog: (message: string, type: LogEntry['type'], source: LogEntry['source']) => void;
}

interface ShareInfo {
  node_id: number;
  share_index: number;
}

const steps = [
  { id: 0, title: 'Setup', icon: '🔧', description: 'Initialize secret sharing' },
  { id: 1, title: 'Prove', icon: '🔐', description: 'Create distributed proof' },
  { id: 2, title: 'Verify', icon: '✓', description: 'Validate the proof' },
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

  const [circuitInputs, setCircuitInputs] = useState<CircuitSetupInputs>({});
  const [selectedCircuit, setSelectedCircuit] = useState<string>('schnorr');

  const [circuitExtraData, setCircuitExtraData] = useState<Record<string, unknown>>({});

  const [salt, setSalt] = useState<Uint8Array | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [shares, setShares] = useState<ShareInfo[]>([]);
  const [publicWitness, setPublicWitness] = useState<string>('');

  const [requestResponses, setRequestResponses] = useState<Record<number, RequestResponse>>({});

  const [showPrivacyDetails, setShowPrivacyDetails] = useState(false);

  const circuits = getAllCircuits();
  const currentHandler = getCircuitHandler(selectedCircuit);
  const currentMetadata = getCircuitMetadata(selectedCircuit);

  const handleInputChange = (fieldId: string, value: string) => {
    setCircuitInputs(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleCircuitChange = (circuitId: string) => {
    setSelectedCircuit(circuitId);
    setCircuitInputs({});
    setCircuitExtraData({});
  };

  const handleSetup = async () => {
    if (!coordinatorRunning) {
      onLog('❌ Coordinator is not running. Start the cluster first.', 'error', 'setup');
      return;
    }

    if (!currentHandler || !isCircuitActive(selectedCircuit)) {
      onLog('❌ Selected circuit is not available.', 'error', 'setup');
      return;
    }

    setLoading(0);
    onLog(`🔧 Initializing BLIND secret sharing for ${currentMetadata?.name || selectedCircuit}...`, 'info', 'setup');

    try {
      const setupPayload = await currentHandler.processSetup(circuitInputs);
      const { secret, witness, extraData } = setupPayload;

      if (extraData) {
        setCircuitExtraData(extraData);
        if (extraData.targetHash) {
          onLog(`🔗 Target hash: ${String(extraData.targetHash).substring(0, 32)}...`, 'info', 'setup');
        }
      }

      setPublicWitness(witness);

      onLog('🔒 Generating commitment client-side...', 'info', 'setup');
      const saltBytes = generateSalt();
      const commitmentHash = await commitToWitness(witness, saltBytes);
      const session = generateSessionId();

      setSalt(saltBytes);
      setSessionId(session);

      const requestPayload = {
        circuit_type: selectedCircuit,
        witness_commitment: { hash: commitmentHash, session_id: session },
        secret
      };

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: ApiResponse<SetupResponse & { shares?: ShareInfo[] }> = await res.json();

      setRequestResponses(prev => ({
        ...prev,
        0: {
          request: { ...requestPayload, secret: secret.substring(0, 10) + '...' },
          response: data,
          timestamp: new Date()
        }
      }));

      if (data.status === 'success') {
        setSetupData(data.data);
        if (data.data.shares) {
          setShares(data.data.shares);
        } else {
          setShares([
            { node_id: 1, share_index: 1 },
            { node_id: 2, share_index: 2 },
            { node_id: 3, share_index: 3 },
          ]);
        }

        setCompletedSteps(prev => [...prev, 0]);
        setCurrentStep(1);
        onLog(`✅ Secret split into ${data.data.num_nodes} shares (threshold: ${data.data.threshold})`, 'success', 'setup');
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

    if (!sessionId) {
      onLog('❌ No session ID found. Please run setup first.', 'error', 'prove');
      return;
    }

    setLoading(1);
    onLog('🔐 Generating distributed proof...', 'info', 'prove');

    try {
      const requestPayload = { session_id: sessionId };

      const res = await fetch('/api/prove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: ApiResponse<{ blind_proof: any; participants?: number }> = await res.json();

      setRequestResponses(prev => ({
        ...prev,
        1: { request: requestPayload, response: data, timestamp: new Date() }
      }));

      if (data.status === 'success') {
        const blindProof = data.data.blind_proof;
        setProofData({
          commitment: JSON.stringify(blindProof.commitment),
          challenge: blindProof.challenge,
          response: blindProof.response,
          generator: JSON.stringify(blindProof.generator),
          public_key: JSON.stringify(blindProof.public_key)
        });

        setCompletedSteps(prev => [...prev, 1]);
        setCurrentStep(2);
        onLog(`✅ Proof generated with ${data.data.participants || 'threshold'} nodes`, 'success', 'prove');
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

    if (!salt || !publicWitness) {
      onLog('❌ Missing salt or public witness.', 'error', 'verify');
      return;
    }

    setLoading(2);
    onLog('🔍 Verifying proof...', 'info', 'verify');

    try {
      if (!proofData.public_key) {
        onLog('❌ Proof is missing public_key. Please re-run Setup and Prove.', 'error', 'verify');
        setLoading(null);
        return;
      }

      const blindProof = {
        witness_commitment: {
          hash: await commitToWitness(publicWitness, salt),
          session_id: sessionId
        },
        commitment: JSON.parse(proofData.commitment),
        challenge: proofData.challenge,
        response: proofData.response,
        generator: JSON.parse(proofData.generator),
        public_key: JSON.parse(proofData.public_key),
        circuit_type: selectedCircuit
      };

      const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
      const encoder = new TextEncoder();
      const witnessBytes = encoder.encode(publicWitness);
      const witnessHex = Array.from(witnessBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      const requestPayload = { blind_proof: blindProof, public_witness: witnessHex, salt: saltHex };

      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: ApiResponse<{ valid: boolean; commitment_valid?: boolean }> = await res.json();

      setRequestResponses(prev => ({
        ...prev,
        2: {
          request: { blind_proof: '...', public_witness: witnessHex.substring(0, 20) + '...', salt: saltHex.substring(0, 16) + '...' },
          response: data,
          timestamp: new Date()
        }
      }));

      if (data.status === 'success') {
        setVerifyResult(data.data.valid);
        setCompletedSteps(prev => [...prev, 2]);
        onLog(data.data.valid ? '✅ Proof is VALID!' : '❌ Proof is INVALID', data.data.valid ? 'success' : 'error', 'verify');
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

  const renderInputField = (field: CircuitInputField) => {
    const value = circuitInputs[field.id] || field.defaultValue || '';
    const borderColor = field.isPrivate ? 'border-accent-red/40' : 'border-accent-green/40';
    const focusRing = field.isPrivate ? 'focus:ring-accent-red/50' : 'focus:ring-accent-green/50';

    return (
      <div key={field.id} className="mb-2">
        <label className="block text-[10px] font-medium text-text-secondary mb-1">
          {field.isPrivate ? '🔒' : '🌐'} {field.label}
        </label>
        <input
          type={field.type === 'password' ? 'password' : 'text'}
          value={value}
          onChange={(e) => handleInputChange(field.id, e.target.value)}
          placeholder={field.placeholder}
          className={`w-full px-2 py-1.5 bg-bg-primary border ${borderColor} rounded text-[11px] ${field.type === 'hex' ? 'font-mono' : ''
            } text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 ${focusRing}`}
          disabled={loading !== null}
        />
      </div>
    );
  };

  const renderRequestResponse = (stepId: number) => {
    const data = requestResponses[stepId];
    if (!data) return null;

    return (
      <div className="text-[10px] mt-3">
        <summary className="cursor-pointer text-text-tertiary hover:text-text-secondary">
          📡 API details
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="bg-bg-tertiary rounded p-2">
            <div className="text-accent-blue font-semibold mb-1">Request</div>
            <pre className="text-[9px] font-mono overflow-x-auto max-h-35 text-text-secondary">
              {JSON.stringify(data.request, null, 1)}
            </pre>
          </div>
          <div className="bg-bg-tertiary rounded p-2">
            <div className="text-accent-green font-semibold mb-1">Response</div>
            <pre className="text-[9px] font-mono overflow-x-auto max-h-35 text-text-secondary">
              {JSON.stringify(data.response, null, 1)}
            </pre>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-text-primary">Proof Workflow</h2>
            <p className="text-[10px] text-text-tertiary">Distributed ZK proof generation</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-blue to-accent-green transition-all"
                style={{ width: `${(completedSteps.length / steps.length) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-text-tertiary">{completedSteps.length}/{steps.length}</span>
          </div>
        </div>

        {/* Circuit Selector */}
        <div className="flex gap-1 mb-4">
          {circuits.filter(c => c.status === 'active' || c.status === 'ui-only').map((circuit) => (
            <button
              key={circuit.id}
              onClick={() => handleCircuitChange(circuit.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${selectedCircuit === circuit.id
                ? 'bg-accent-blue text-white'
                : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'
                }`}
            >
              <span>{circuit.icon}</span>
              <span>{circuit.name}</span>
            </button>
          ))}
        </div>

        {/* Circuit Info */}
        {currentMetadata && (
          <div className="mb-4 bg-bg-secondary rounded-lg p-3 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{currentMetadata.icon}</span>
              <div>
                <span className="text-sm font-semibold text-text-primary">{currentMetadata.name}</span>
                <span className="text-[10px] text-text-tertiary ml-2">{currentMetadata.useCase}</span>
              </div>
            </div>
            <div className="text-[10px] font-mono text-accent-purple bg-accent-purple/10 px-2 py-1 rounded inline-block">
              {currentMetadata.statement}
            </div>
            <div className="flex gap-4 mt-2 text-[10px]">
              <div>
                <span className="text-accent-green">🌐 Public:</span>
                <span className="text-text-secondary ml-1">{currentMetadata.publicInputs.join(', ')}</span>
              </div>
              <div>
                <span className="text-accent-red">🔒 Private:</span>
                <span className="text-text-secondary ml-1">{currentMetadata.privateWitness.join(', ')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Main Workflow - Steps */}
        <div className="grid grid-cols-1 gap-3 mb-4">
          {steps.map((step) => {
            const isCompleted = completedSteps.includes(step.id);
            const isCurrent = currentStep === step.id;
            const isAvailable = step.id === 0 || completedSteps.includes(step.id - 1);

            return (
              <div
                key={step.id}
                className={`rounded-lg p-3 border transition-all ${isCompleted
                  ? 'bg-accent-green/5 border-accent-green/30'
                  : isCurrent
                    ? 'bg-accent-blue/5 border-accent-blue/30'
                    : 'bg-bg-secondary border-border'
                  }`}
              >
                <div className="flex flex-col sm:flex-row gap-4">
                  {/* Left side - Main content */}
                  <div className="flex-1 min-w-0">
                    {/* Step Header */}
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isCompleted
                          ? 'bg-accent-green text-white'
                          : isCurrent
                            ? 'bg-accent-blue text-white'
                            : 'bg-bg-tertiary text-text-tertiary'
                          }`}
                      >
                        {isCompleted ? '✓' : step.id + 1}
                      </div>
                      <span className="text-sm font-semibold text-text-primary">{step.title}</span>
                      <span className="text-lg">{step.icon}</span>
                    </div>

                    {/* Step Content */}
                    <div className="min-h-[120px]">
                      {step.id === 0 && currentHandler && (
                        <div className="space-y-2">
                          {currentHandler.setupFields.map(field => renderInputField(field))}
                        </div>
                      )}

                      {step.id === 1 && (
                        <div className="text-[10px] text-text-secondary space-y-1">
                          {setupData ? (
                            <>
                              <div className="flex justify-between">
                                <span>Threshold:</span>
                                <span className="font-mono text-text-primary">{setupData.threshold}/{setupData.num_nodes}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Session:</span>
                                <span className="font-mono text-text-primary truncate max-w-[100px]">{sessionId.substring(0, 16)}...</span>
                              </div>
                              {currentHandler?.proveFields?.map(field => {
                                const value = circuitExtraData[field.id] as string || '';
                                return value && (
                                  <div key={field.id} className="flex justify-between">
                                    <span>{field.label.split(':')[0]}:</span>
                                    <span className="font-mono text-text-primary truncate max-w-[100px]">{value.substring(0, 16)}...</span>
                                  </div>
                                );
                              })}
                            </>
                          ) : (
                            <div className="text-text-tertiary">Complete setup first</div>
                          )}
                        </div>
                      )}

                      {step.id === 2 && (
                        <div className="text-[10px] text-text-secondary space-y-1">
                          {proofData ? (
                            <>
                              <div className="flex justify-between">
                                <span>Commitment:</span>
                                <span className="font-mono text-text-primary truncate max-w-[100px]">{proofData.commitment.substring(1, 17)}...</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Challenge:</span>
                                <span className="font-mono text-text-primary truncate max-w-[100px]">{proofData.challenge.substring(0, 16)}...</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Response:</span>
                                <span className="font-mono text-text-primary truncate max-w-[100px]">{proofData.response.substring(0, 16)}...</span>
                              </div>
                            </>
                          ) : (
                            <div className="text-text-tertiary">Generate proof first</div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Button */}
                    <button
                      onClick={() => handleStepAction(step.id)}
                      disabled={!isAvailable || loading !== null || !isCircuitActive(selectedCircuit)}
                      className={`w-full mt-3 px-3 py-1.5 rounded text-xs font-medium transition-all ${!isAvailable || loading !== null || !isCircuitActive(selectedCircuit)
                        ? 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
                        : isCompleted
                          ? 'bg-accent-green hover:bg-accent-green/80 text-white'
                          : 'bg-accent-blue hover:bg-accent-blue/80 text-white'
                        }`}
                    >
                      {loading === step.id ? '⏳ Processing...' : isCompleted ? '↻ Re-run' : `▶ Run`}
                    </button>

                    {/* Result Badge */}
                    {step.id === 2 && verifyResult !== null && (
                      <div
                        className={`mt-2 py-1 px-2 rounded text-center text-xs font-semibold ${verifyResult ? 'bg-accent-green/20 text-accent-green' : 'bg-accent-red/20 text-accent-red'
                          }`}
                      >
                        {verifyResult ? '✓ Valid' : '✗ Invalid'}
                      </div>
                    )}
                  </div>

                  {/* Right side - API Details */}
                  <div className="w-full sm:w-200 shrink-0">
                    {renderRequestResponse(step.id)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* Privacy Details */}
        <div className="mb-4">
          <summary
            className="cursor-pointer text-sm font-semibold text-accent-purple flex items-center gap-2 mb-2"
          >
            🛡️ Blind Proving Details
          </summary>

          <div className="bg-gradient-to-br from-purple-900/10 to-blue-900/10 border border-purple-500/30 rounded-lg p-3">
            <div className="grid grid-cols-3 gap-2 mb-3">
              {shares.map((share) => (
                <div key={share.node_id} className="bg-bg-primary/50 rounded p-2 text-center">
                  <div className="w-6 h-6 mx-auto bg-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold mb-1">
                    {share.node_id}
                  </div>
                  <div className="text-[9px] text-text-secondary">Share #{share.share_index}</div>
                  <div className="text-[8px] text-purple-300">🛡️ Witness Hidden</div>
                </div>
              ))}
            </div>

            <div className="text-[10px] text-text-secondary space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-purple-400">✓</span>
                <span>Public witness <span className="font-semibold text-text-primary">"{publicWitness}"</span> never sent to nodes</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-purple-400">✓</span>
                <span>Nodes only receive commitment hash + secret share</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-purple-400">✓</span>
                <span>Witness revealed only at verification time</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}