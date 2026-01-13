'use client';

import { useEffect, useState } from 'react';
import HashGenerator from './HashGenerator';
import type { Node } from '../types';

interface ClusterViewProps {
  nodes: Node[];
  coordinatorRunning: boolean;
}

export default function ClusterView({ nodes, coordinatorRunning }: ClusterViewProps) {
  const [particles, setParticles] = useState<Array<{ id: number; progress: number; from: number; to: number }>>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setParticles(prev => {
        // Add new particles from healthy nodes
        const newParticles = nodes
          .filter((n, idx) => n.ready && Math.random() > 0.7)
          .map((_, idx) => ({
            id: Date.now() + idx,
            progress: 0,
            from: nodes.findIndex(n => n.ready),
            to: -1 // -1 means coordinator
          }));

        // Update existing particles
        const updated = prev
          .map(p => ({ ...p, progress: p.progress + 0.02 }))
          .filter(p => p.progress < 1);

        return [...updated, ...newParticles].slice(0, 10);
      });
    }, 50);

    return () => clearInterval(interval);
  }, [nodes]);

  const centerX = 175;
  const centerY = 150;
  const radius = 90;

  const nodePositions = nodes.map((_, idx) => {
    const angle = (idx * 2 * Math.PI) / 5 - Math.PI / 2;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    };
  });

  return (
    <div className="p-4 h-full flex flex-col bg-bg-secondary">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Cluster Topology</h2>
          <p className="text-xs text-text-tertiary mt-0.5">Network visualization</p>
        </div>
        <div className="flex items-center gap-2 px-2 py-1 bg-bg-tertiary rounded-lg">
          <div className="w-2 h-2 rounded-full bg-accent-green animate-pulse"></div>
          <span className="text-xs text-text-secondary font-medium">Live</span>
        </div>
      </div>

      {/* SVG Visualization */}
      <div className="mb-6 bg-bg-primary rounded-xl border border-border p-4">
        <svg width="350" height="300" className="mx-auto">
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.3" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* Connection Lines */}
          {nodes.map((node, idx) => {
            if (!node.online) return null;
            const pos = nodePositions[idx];
            const strokeColor = node.ready ? '#10b981' : node.online ? '#f59e0b' : '#6b7280';
            const strokeWidth = node.ready ? '2.5' : '1.5';
            const opacity = node.ready ? 0.7 : 0.4;

            return (
              <g key={`line-${idx}`}>
                <line
                  x1={centerX}
                  y1={centerY}
                  x2={pos.x}
                  y2={pos.y}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  opacity={opacity}
                  strokeLinecap="round"
                  className="transition-all duration-500"
                />
              </g>
            );
          })}

          {/* Data Flow Particles */}
          {particles.map(particle => {
            const fromIdx = particle.from;
            if (particle.to === -1 && fromIdx >= 0 && fromIdx < nodePositions.length) {
              const from = nodePositions[fromIdx];
              const x = from.x + (centerX - from.x) * particle.progress;
              const y = from.y + (centerY - from.y) * particle.progress;
              return (
                <circle
                  key={particle.id}
                  cx={x}
                  cy={y}
                  r="2.5"
                  fill="#10b981"
                  opacity={0.8 * (1 - particle.progress * 0.5)}
                />
              );
            }
            return null;
          })}

          {/* Nodes */}
          {nodes.map((node, idx) => {
            const pos = nodePositions[idx];
            const nodeColor = node.ready ? '#10b981' : node.online ? '#3b82f6' : '#6b7280';
            const statusColor = node.ready ? '#10b981' : node.online ? '#f59e0b' : '#ef4444';

            return (
              <g key={`node-${idx}`} className="transition-all duration-500">
                {/* Outer glow ring for ready nodes */}
                {node.ready && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r="26"
                    fill="none"
                    stroke={nodeColor}
                    strokeWidth="1.5"
                    opacity="0.3"
                    className="animate-pulse"
                    style={{ animationDuration: '2s' }}
                  />
                )}

                {/* Node circle with border */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r="22"
                  fill="#1e293b"
                  stroke={nodeColor}
                  strokeWidth="2.5"
                  opacity={node.online ? 1 : 0.5}
                  className="transition-all duration-500"
                />

                {/* Node icon/emoji */}
                <text
                  x={pos.x}
                  y={pos.y + 6}
                  textAnchor="middle"
                  fontSize="16"
                  className="transition-all duration-500"
                >
                  💻
                </text>

                {/* Node number label */}
                <text
                  x={pos.x}
                  y={pos.y + 32}
                  textAnchor="middle"
                  fill={node.online ? '#94a3b8' : '#6b7280'}
                  fontSize="9"
                  fontWeight="600"
                  className="transition-all duration-500"
                >
                  N{node.id}
                </text>

                {/* Status indicator dot */}
                <circle
                  cx={pos.x + 14}
                  cy={pos.y - 14}
                  r="5"
                  fill={statusColor}
                  stroke="#1e293b"
                  strokeWidth="1.5"
                  className={node.ready ? 'animate-pulse' : ''}
                />
              </g>
            );
          })}

          {/* Coordinator */}
          <defs>
            <linearGradient id="coordGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
            <linearGradient id="nodeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
          </defs>

          {coordinatorRunning && (
            <circle
              cx={centerX}
              cy={centerY}
              r="40"
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="1.5"
              opacity="0.3"
              className="animate-pulse"
              style={{ animationDuration: '3s' }}
            />
          )}

          <circle
            cx={centerX}
            cy={centerY}
            r="34"
            fill="#1e293b"
            stroke={coordinatorRunning ? '#8b5cf6' : '#6b7280'}
            strokeWidth="3"
            opacity={coordinatorRunning ? 1 : 0.5}
            className="transition-all duration-500"
          />

          {/* Coordinator icon */}
          <text
            x={centerX}
            y={centerY + 8}
            textAnchor="middle"
            fontSize="28"
            className="transition-all duration-500"
          >
            🎯
          </text>

          {/* Coordinator status indicator */}
          {coordinatorRunning && (
            <circle
              cx={centerX + 20}
              cy={centerY - 20}
              r="5"
              fill="#8b5cf6"
              stroke="#1e293b"
              strokeWidth="2"
              className="animate-pulse"
            />
          )}
        </svg>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-accent-green"></div>
            <span className="text-text-tertiary">Ready</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-accent-yellow"></div>
            <span className="text-text-tertiary">Starting</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-accent-red"></div>
            <span className="text-text-tertiary">Offline</span>
          </div>
          <div className="h-4 w-px bg-border mx-1"></div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-0.5 bg-accent-green rounded"></div>
            <span className="text-text-tertiary">Active Link</span>
          </div>
        </div>
      </div>

      {/* Node List */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Nodes</h3>
          <div className="text-xs px-2 py-1 bg-bg-tertiary rounded font-medium">
            <span className="text-accent-green">{nodes.filter(n => n.ready).length}</span>
            <span className="text-text-tertiary"> / {nodes.length} Ready</span>
          </div>
        </div>
        <div className="space-y-2">
          {nodes.map((node) => (
            <div
              key={node.id}
              className={`p-3 rounded-lg border transition-all duration-300 ${
                node.ready
                  ? 'bg-bg-primary border-accent-green/30 hover:border-accent-green/50'
                  : node.online
                  ? 'bg-bg-primary border-accent-yellow/30 hover:border-accent-yellow/50'
                  : 'bg-bg-primary/50 border-border opacity-60'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <div className={`w-2 h-2 rounded-full ${
                      node.ready ? 'bg-accent-green animate-pulse' :
                      node.online ? 'bg-accent-yellow' : 'bg-text-tertiary'
                    }`}></div>
                  </div>
                  <span className="font-semibold text-sm text-text-primary">Node {node.id}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                  node.ready
                    ? 'bg-accent-green/20 text-accent-green'
                    : node.online
                    ? 'bg-accent-yellow/20 text-accent-yellow'
                    : 'bg-text-tertiary/20 text-text-tertiary'
                }`}>
                  {node.ready ? 'Ready' : node.online ? 'Starting' : 'Offline'}
                </span>
              </div>

              <div className="text-[11px] text-text-tertiary font-mono">
                {node.url}
              </div>

              {/* Progress bar for starting nodes */}
              {node.online && !node.ready && (
                <div className="mt-2 h-1 bg-bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-2/3 bg-accent-yellow rounded-full animate-pulse"></div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="grid grid-cols-3 gap-2">
          <div className="p-3 bg-bg-tertiary rounded-lg text-center">
            <div className="text-xl font-bold text-accent-green">
              {nodes.filter(n => n.online).length}
            </div>
            <div className="text-[10px] text-text-tertiary mt-1 font-medium">Online</div>
          </div>
          <div className="p-3 bg-bg-tertiary rounded-lg text-center">
            <div className="text-xl font-bold text-accent-blue">
              {nodes.filter(n => n.ready).length}
            </div>
            <div className="text-[10px] text-text-tertiary mt-1 font-medium">Ready</div>
          </div>
          <div className="p-3 bg-bg-tertiary rounded-lg text-center">
            <div className={`text-xl font-bold ${coordinatorRunning ? 'text-accent-purple' : 'text-text-tertiary'}`}>
              {coordinatorRunning ? '✓' : '✗'}
            </div>
            <div className="text-[10px] text-text-tertiary mt-1 font-medium">Coordinator</div>
          </div>
        </div>
      </div>

      {/* Hash Generator Utility */}
      <div className="mt-4 pt-4 border-t border-border">
        <HashGenerator />
      </div>
    </div>
  );
}

