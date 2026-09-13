import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Network, Sparkles } from 'lucide-react';

export interface CoordinatorNodeData {
  activity: string;
}

export function CoordinatorNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as CoordinatorNodeData;

  return (
    <article className={`product-node product-coordinator ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />

      <div className="product-coordinator__header">
        <div className="product-coordinator__title">
          <Network size={16} color="#6F9E18" />
          <span>Mesh Coordinator</span>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#6F9E18',
            backgroundColor: 'rgba(168, 217, 95, 0.3)',
            padding: '2px 6px',
            borderRadius: 999,
          }}
        >
          ACTIVE
        </span>
      </div>

      <div className="product-coordinator__status">
        <Sparkles size={14} color="#6F9E18" style={{ flexShrink: 0 }} />
        <span>{nodeData.activity || 'Matching tasks to agents by capability'}</span>
      </div>
    </article>
  );
}
