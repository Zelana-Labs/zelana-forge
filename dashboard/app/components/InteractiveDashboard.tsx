'use client';

import { useState, useEffect, useCallback } from 'react';
import ClusterView from './ClusterView';
import WorkflowPanel from './WorkflowPanel';
import LogViewer from './LogViewer';
import type { Node, LogEntry } from '../types';

const nodeUrls = [
  '/node1',
  '/node2',
  '/node3',
  '/node4',
  '/node5',
];

export default function InteractiveDashboard() {
  const [nodesRunning, setNodesRunning] = useState(false);
  const [coordinatorRunning, setCoordinatorRunning] = useState(false);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [systemReady, setSystemReady] = useState(false);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', source: LogEntry['source'] = 'system') => {
    setLogs(prev => [{
      timestamp: new Date(),
      message,
      type,
      source
    }, ...prev].slice(0, 200));
  }, []);

  const checkStatus = useCallback(async () => {
    // Check coordinator
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setCoordinatorRunning(data.status === 'success');
      setSystemReady(data.data?.ready || false);
    } catch {
      setCoordinatorRunning(false);
      setSystemReady(false);
    }

    // Check nodes
    const nodePromises = nodeUrls.map(async (url, idx) => {
      try {
        const res = await fetch(`${url}/health`);
        const data = await res.json();
        return {
          id: idx + 1,
          url: `localhost:${3001 + idx}`,
          online: true,
          ready: data.data?.ready || false
        };
      } catch {
        return {
          id: idx + 1,
          url: `localhost:${3001 + idx}`,
          online: false,
          ready: false
        };
      }
    });

    const newNodes = await Promise.all(nodePromises);
    setNodes(newNodes);
    setNodesRunning(newNodes.some(n => n.online));
  }, []);

  const startCluster = async () => {
    addLog('🚀 Starting Docker Compose cluster...', 'info', 'system');

    try {
      const res = await fetch('/control/cluster/start', { method: 'POST' });
      const data = await res.json();

      if (data.status === 'success') {
        addLog('✅ Cluster started successfully!', 'success', 'system');
        addLog('📦 Starting 5 prover nodes...', 'info', 'system');
        addLog('⏳ Waiting for nodes to become healthy (this takes ~30 seconds)...', 'info', 'system');

        // Poll for coordinator readiness
        let attempts = 0;
        const maxAttempts = 20; // 20 attempts * 3 seconds = 60 seconds max wait

        const waitForCoordinator = async () => {
          await checkStatus();
          attempts++;

          try {
            const healthRes = await fetch('/api/health');
            const healthData = await healthRes.json();

            if (healthData.status === 'success') {
              addLog('✅ Coordinator is online and ready!', 'success', 'system');
              addLog('✅ All services are online', 'success', 'system');
            } else if (attempts < maxAttempts) {
              addLog(`⏳ Coordinator starting... (${attempts}/${maxAttempts})`, 'info', 'system');
              setTimeout(waitForCoordinator, 3000);
            } else {
              addLog('⚠️ Coordinator took longer than expected. Check logs.', 'warning', 'system');
            }
          } catch {
            if (attempts < maxAttempts) {
              addLog(`⏳ Waiting for coordinator... (${attempts}/${maxAttempts})`, 'info', 'system');
              setTimeout(waitForCoordinator, 3000);
            } else {
              addLog('❌ Coordinator failed to start. Try stopping and restarting.', 'error', 'system');
            }
          }
        };

        setTimeout(waitForCoordinator, 3000);
      } else {
        addLog(`❌ Failed to start cluster: ${data.message}`, 'error', 'system');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog(`❌ Error starting cluster: ${message}`, 'error', 'system');
      addLog('⚠️ Make sure the control server is running (cargo run -p prover-control)', 'warning', 'system');
    }
  };

  const stopCluster = async () => {
    addLog('⏹️ Stopping Docker Compose cluster...', 'info', 'system');

    try {
      const res = await fetch('/control/cluster/stop', { method: 'POST' });
      const data = await res.json();

      if (data.status === 'success') {
        addLog('✅ Cluster stopped successfully', 'success', 'system');
        addLog('All containers have been removed', 'info', 'system');

        setNodesRunning(false);
        setCoordinatorRunning(false);
        setSystemReady(false);
        setNodes([]);
      } else {
        addLog(`❌ Failed to stop cluster: ${data.message}`, 'error', 'system');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      addLog(`❌ Error stopping cluster: ${message}`, 'error', 'system');
    }
  };

  useEffect(() => {
    addLog('🚀 Dashboard initialized', 'success', 'system');
    addLog('Welcome to Zelana Prover - Distributed ZK Proof System', 'info', 'system');
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [addLog, checkStatus]);

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Header */}
      <header className="relative bg-gradient-to-r from-bg-secondary via-bg-secondary to-bg-primary border-b border-border/50 flex-shrink-0 overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-accent-blue rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
          <div className="absolute top-0 right-1/4 w-96 h-96 bg-accent-purple rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: '2s' }}></div>
        </div>

        <div className="relative z-10 p-6">
          <div className="flex justify-between items-center max-w-full">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-accent-blue to-accent-purple rounded-2xl blur-xl opacity-50"></div>
                <div className="relative w-14 h-14 bg-gradient-to-br from-accent-blue to-accent-purple rounded-2xl flex items-center justify-center text-3xl shadow-lg">
                  ⚡
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-text-primary via-accent-blue to-accent-purple bg-clip-text text-transparent">
                  Zelana Prover
                </h1>
                <p className="text-sm text-text-secondary font-medium mt-0.5">
                  Distributed Zero-Knowledge Proof System
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Status indicator */}
              <div className="relative">
                <div className={`absolute inset-0 ${coordinatorRunning && nodesRunning ? 'bg-accent-green' : 'bg-accent-red'} rounded-xl blur-xl opacity-30`}></div>
                <div className={`relative flex items-center gap-3 px-5 py-3 rounded-xl border backdrop-blur-sm ${
                  coordinatorRunning && nodesRunning
                    ? 'bg-accent-green/10 border-accent-green/30'
                    : 'bg-accent-red/10 border-accent-red/30'
                }`}>
                  <div className="relative">
                    <span className={`relative flex h-3 w-3 ${coordinatorRunning && nodesRunning ? 'opacity-100' : 'opacity-70'}`}>
                      {coordinatorRunning && nodesRunning && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75"></span>
                      )}
                      <span className={`relative inline-flex rounded-full h-3 w-3 ${
                        coordinatorRunning && nodesRunning ? 'bg-accent-green' : 'bg-accent-red'
                      }`}></span>
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-text-primary">
                      {coordinatorRunning && nodesRunning ? 'System Online' : nodesRunning ? 'Partial' : 'Offline'}
                    </div>
                    <div className="text-xs text-text-tertiary">
                      {nodes.filter(n => n.ready).length}/{nodes.length} nodes ready
                    </div>
                  </div>
                </div>
              </div>

              {/* Action button */}
              {!coordinatorRunning || !nodesRunning ? (
                <button
                  onClick={startCluster}
                  className="relative group px-6 py-3 bg-gradient-to-r from-accent-green to-accent-blue hover:from-accent-green/90 hover:to-accent-blue/90 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                    Start Cluster
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-r from-accent-green to-accent-blue rounded-xl blur opacity-50 group-hover:opacity-75 transition-opacity"></div>
                </button>
              ) : (
                <button
                  onClick={stopCluster}
                  className="relative group px-6 py-3 bg-gradient-to-r from-accent-red to-accent-yellow hover:from-accent-red/90 hover:to-accent-yellow/90 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                    </svg>
                    Stop Cluster
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-r from-accent-red to-accent-yellow rounded-xl blur opacity-50 group-hover:opacity-75 transition-opacity"></div>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-0">
        {/* Left Sidebar - Cluster View */}
        <div className="w-full lg:w-80 xl:w-96 bg-bg-secondary border-b lg:border-b-0 lg:border-r border-border overflow-y-auto flex-shrink-0">
          <ClusterView nodes={nodes} coordinatorRunning={coordinatorRunning} />
        </div>

        {/* Center Content - Workflow */}
        <div className="flex-1 bg-bg-primary overflow-y-auto">
          <WorkflowPanel
            systemReady={systemReady}
            coordinatorRunning={coordinatorRunning}
            onLog={addLog}
          />
        </div>

        {/* Right Sidebar - Logs */}
        <div className="w-full lg:w-96 xl:w-[440px] bg-bg-secondary border-t lg:border-t-0 lg:border-l border-border overflow-y-auto flex-shrink-0">
          <LogViewer logs={logs} nodes={nodes} onClearLogs={() => setLogs([])} />
        </div>
      </div>
    </div>
  );
}
