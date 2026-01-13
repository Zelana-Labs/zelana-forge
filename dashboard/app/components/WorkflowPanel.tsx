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

  // Custom parameters
  const [customSecret, setCustomSecret] = useState('');
  const [customMessage, setCustomMessage] = useState('my_custom_proof_message');

  // Request/Response tracking
  const [requestResponses, setRequestResponses] = useState<Record<number, RequestResponse>>({});

  const handleSetup = async () => {
    if (!coordinatorRunning) {
      onLog('❌ Coordinator is not running. Start the cluster first.', 'error', 'setup');
      return;
    }

    setLoading(0);
    onLog('🔧 Initializing secret sharing...', 'info', 'setup');

    try {
      // Generate a random secret (32 bytes = 64 hex characters)
      const secret = Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: ApiResponse<SetupResponse> = await res.json();

      if (data.status === 'success') {
        setSetupData(data.data);
        setCompletedSteps(prev => [...prev, 0]);
        setCurrentStep(1);
        onLog(`✅ Setup complete! Distributed ${data.data.num_nodes} shares (threshold: ${data.data.threshold})`, 'success', 'setup');
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
      const res = await fetch('/api/prove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'proof_generation_request'
        })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: ApiResponse<{ proof: ProofData; participants: number }> = await res.json();

      if (data.status === 'success') {
        setProofData(data.data.proof);
        setCompletedSteps(prev => [...prev, 1]);
        setCurrentStep(2);
        onLog('✅ Proof generated successfully!', 'success', 'prove');
        onLog(`Commitment: ${data.data.proof.commitment.substring(0, 20)}...`, 'info', 'prove');
        onLog(`Participants: ${data.data.participants}`, 'info', 'prove');
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
    onLog('✓ Verifying proof...', 'info', 'verify');

    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof: proofData })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: ApiResponse<{ valid: boolean }> = await res.json();

      if (data.status === 'success') {
        setVerifyResult(data.data.valid);
        setCompletedSteps(prev => [...prev, 2]);
        if (data.data.valid) {
          onLog('✅ Proof verification successful! The proof is valid.', 'success', 'verify');
        } else {
          onLog('❌ Proof verification failed! The proof is invalid.', 'error', 'verify');
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
    <div className="p-6 h-full flex flex-col max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-text-primary">Proof Workflow</h2>
        <p className="text-xs text-text-tertiary mt-1">Execute distributed ZK proof generation</p>
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

      {/* Progress Summary */}
      <div className="mt-auto pt-6 border-t border-border">
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
  );
}
