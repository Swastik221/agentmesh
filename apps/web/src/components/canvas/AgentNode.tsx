import { Handle, Position, type NodeProps } from '@xyflow/react';
import { StatusBadge, TruncatedAddress, WindowDots } from '@agentmesh/ui';
import type { AgentFlowNode } from '../../types';

/**
 * A connected developer's agent, drawn as a terminal window.
 *
 * The body shows explorer-style output — block height, short hash, action —
 * rather than generic console text, so the node reads as a participant in a
 * ledger of work rather than a log viewer.
 */
export function AgentNode({ data }: NodeProps<AgentFlowNode>) {
  const isConnected = data.status === 'connected' || data.status === 'working';

  return (
    <div className="am-node am-node--agent">
      {/* Inbound on the left and top, outbound on the right and bottom, so a
          user can wire nodes together in any arrangement they lay out. */}
      <Handle type="target" position={Position.Left} id="in-left" className="am-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="am-handle" />

      <div className="am-node__titlebar">
        <WindowDots />
        <span className="am-node__title">{data.name}</span>
        <StatusBadge tone={isConnected ? 'success' : 'neutral'}>{data.status}</StatusBadge>
      </div>

      <div className="am-node__body">
        <div className="am-agent__identity">
          <TruncatedAddress address={data.address} label={data.ens} />
        </div>

        {/* Keyed on the block alone. A line whose message changes must update
            in place: re-keying it on the text remounts the row, and under a
            scrubbed scroll that reads as the terminal blinking. */}
        <div className="am-agent__log">
          {data.log.map((line) => (
            <div className="am-agent__line" key={line.block}>
              <span className="am-agent__block">{line.block}</span>
              <span className="am-agent__hash">{line.hash}</span>
              <span className="am-agent__msg">{line.message}</span>
            </div>
          ))}
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="out-right" className="am-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="am-handle" />
    </div>
  );
}
