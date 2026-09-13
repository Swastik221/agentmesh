import { Handle, Position, type NodeProps } from '@xyflow/react';

/**
 * The agent shape this node renders.
 *
 * Every field except identity is optional because the canvas builds this from
 * the real `GET /projects/:id/agents` payload, where ENS, wallet and
 * capabilities are all legitimately absent for a freshly registered agent.
 * Rendering must survive that: an unguarded read here unmounts the whole app,
 * since a thrown render in a React Flow node takes the tree with it.
 */
export interface CanvasAgent {
  id: string;
  name: string;
  provider: string;
  /** The real backend status, shown verbatim. */
  status: 'ONLINE' | 'OFFLINE' | 'BUSY';
  ens?: string | null;
  address?: string | null;
  ownerLabel?: string | null;
  /** True when the signed-in user owns this agent, used only for colour. */
  ownedByViewer?: boolean;
  capabilities?: string[];
  logs?: string[];
}

export interface AgentNodeData {
  agent: CanvasAgent;
}

/** Maps the backend status onto the pill variants the stylesheet defines. */
const STATUS_CLASS: Record<CanvasAgent['status'], string> = {
  ONLINE: 'connected',
  BUSY: 'working',
  OFFLINE: 'idle',
};

export function AgentNode({ data, selected }: NodeProps) {
  const agent = (data as unknown as AgentNodeData | undefined)?.agent;

  if (!agent) {
    return null;
  }

  const ownedByViewer = agent.ownedByViewer === true;
  const ownerClass = ownedByViewer ? 'product-agent--anand' : 'product-agent--swastik';
  const accentVar = ownedByViewer ? 'var(--mesh-owner-anand)' : 'var(--mesh-owner-swastik)';
  const capabilities = agent.capabilities ?? [];
  const logs = agent.logs ?? [];
  const statusClass = STATUS_CLASS[agent.status] ?? 'idle';

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
            {agent.name}{' '}
            <span style={{ fontWeight: 400, color: 'var(--mesh-text-muted)' }}>
              / {agent.provider}
            </span>
          </strong>
        </div>
        <span className={`product-status-pill product-status-pill--${statusClass}`}>
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
              {agent.ownerLabel || 'unknown owner'}
            </span>
          </div>
          <div className="product-agent__identity-row">
            <span className="product-agent__identity-label">Agent ENS</span>
            <span className="product-agent__identity-value" style={{ color: accentVar }}>
              {agent.ens || 'not linked'}
            </span>
          </div>
          <div className="product-agent__identity-row">
            <span className="product-agent__identity-label">Wallet</span>
            <span
              className="product-agent__identity-value"
              style={{ color: 'var(--mesh-text-muted)', fontSize: 10 }}
            >
              {agent.address || 'not linked'}
            </span>
          </div>
        </div>

        {/* Capability Badges */}
        <div className="product-agent__caps">
          {capabilities.length === 0 ? (
            <span className="product-agent__cap-pill">no declared capabilities</span>
          ) : (
            capabilities.map((cap) => (
              <span key={cap} className="product-agent__cap-pill">
                {cap}
              </span>
            ))
          )}
        </div>

        {/* Monospace Protocol Terminal Logs */}
        <div className="product-agent__terminal nowheel nodrag">
          {logs.slice(-4).map((log, index) => (
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
