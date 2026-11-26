import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Lock, SquareTerminal, Users } from 'lucide-react';
import type { LiveTerminalSession } from '../../../adapters/live/terminal.adapter';

export interface TerminalsNodeData {
  sessions: LiveTerminalSession[];
  viewerUserId: string | null;
  /** Opens the Terminals view, where sessions are watched read-only. */
  onOpen: () => void;
}

/**
 * Connected terminals on the canvas: yours (private or shared) and
 * teammates' shared ones, with who owns each, which agent it runs, and
 * whether it is live. Watching happens in the Terminals view.
 */
export function TerminalsNode({ data, selected }: NodeProps) {
  const { sessions = [], viewerUserId, onOpen } = data as unknown as TerminalsNodeData;
  const live = sessions.filter((s) => s.status === 'ACTIVE').length;

  return (
    <article className={`product-node product-terminals-node ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <header className="product-terminals-node__head">
        <SquareTerminal size={14} />
        <strong>Connected terminals</strong>
        <span>{live} live</span>
      </header>

      {sessions.length === 0 ? (
        <p className="product-terminals-node__empty">
          No terminals yet. Run <code>agentmesh terminal … -- claude</code> on your machine to connect one.
        </p>
      ) : (
        <ul className="product-terminals-node__list nowheel">
          {sessions.map((s) => (
            <li key={s.terminalId}>
              <span className={`product-terminals-node__dot is-${s.status.toLowerCase()}`} aria-label={s.status.toLowerCase()} />
              <span className="product-terminals-node__name">{s.name}</span>
              <span className="product-terminals-node__who">
                {s.owner.userId === viewerUserId ? 'you' : s.owner.displayName ?? 'teammate'}
                {s.agent ? ` · ${s.agent.name}` : ''}
              </span>
              {s.visibility === 'SHARED' ? <Users size={11} aria-label="shared read-only" /> : <Lock size={11} aria-label="private" />}
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="product-terminals-node__open nodrag nopan" onClick={onOpen}>
        Open terminals
      </button>
    </article>
  );
}
