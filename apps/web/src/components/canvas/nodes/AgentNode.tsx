import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Agent } from '../../../adapters/types';

export interface AgentNodeData {
  agent: Agent;
}

export function AgentNode({ data, selected }: NodeProps) {
  const agent = (data as unknown as AgentNodeData).agent;
  const isAnand = agent.ownerColor === 'purple';
  const ownerClass = isAnand ? 'product-agent--anand' : 'product-agent--swastik';

  return (
    <article
      className={`product-node product-agent ${ownerClass} ${selected ? 'is-selected' : ''}`}
    >
      {/* 4 Connection Ports */}
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />

      {/* Header */}
      <header className="product-agent__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="product-window-dots">
            <i />
            <i />
            <i />
          </span>
          <strong style={{ fontSize: 13, color: 'var(--mesh-text-main)' }}>
            {agent.name} <span style={{ fontWeight: 400, color: 'var(--mesh-text-muted)' }}>/ {agent.provider}</span>
          </strong>
        </div>
        <span className={`product-status-pill product-status-pill--${agent.status}`}>
          {agent.status}
        </span>
      </header>

      {/* Body */}
      <div className="product-agent__body">
        {/* Owner & ENS Identity */}
        <div className="product-agent__identity">
          <div className="product-agent__identity-row">
            <span className="product-agent__identity-label">Owner</span>
            <span
              className="product-agent__owner-badge"
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {agent.ownerName} ({agent.ownerEns})
            </span>
          </div>
          <div className="product-agent__identity-row">
            <span className="product-agent__identity-label">Agent ENS</span>
            <span className="product-agent__identity-value" style={{ color: isAnand ? 'var(--mesh-owner-anand)' : 'var(--mesh-owner-swastik)' }}>
              {agent.ens}
            </span>
          </div>
          <div className="product-agent__identity-row">
            <span className="product-agent__identity-label">Wallet</span>
            <span className="product-agent__identity-value" style={{ color: 'var(--mesh-text-muted)', fontSize: 10 }}>
              {agent.address}
            </span>
          </div>
        </div>

        {/* Capability Badges */}
        <div className="product-agent__caps">
          {agent.capabilities.map((cap) => (
            <span key={cap} className="product-agent__cap-pill">
              {cap}
            </span>
          ))}
        </div>

        {/* Monospace Protocol Terminal Logs */}
        <div className="product-agent__terminal nowheel nodrag">
          {agent.logs.slice(-4).map((log, index) => (
            <div key={index} className="product-agent__log-line">
              <span className="product-agent__log-prefix">›</span>
              <span>{log}</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
