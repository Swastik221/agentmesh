import { useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { StickyNote } from 'lucide-react';

export interface NoteNodeData {
  text?: string;
  onEdit?: (text: string) => void;
}

const DEFAULT_NOTE_TEXT = `PRD NOTES & DEMO SCRIPT:
1. Connect demo wallet (0x1a2b… -> dev1.eth)
2. Deploy local Orion agent (frontend/identity)
3. Swastik joins with Vega (backend/solidity)
4. Coordinator splits tasks on task board
5. Claim AM-114 & AM-115
6. Vega publishes payment-api.json
7. Sign Web3 approval gate for deploy (0.35 ETH)`;

export function NoteNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as NoteNodeData;
  const [content, setContent] = useState(nodeData.text ?? DEFAULT_NOTE_TEXT);

  const handleChange = (newVal: string) => {
    setContent(newVal);
    nodeData.onEdit?.(newVal);
  };

  return (
    <article
      className={`product-node product-note-node ${selected ? 'is-selected' : ''}`}
      style={{ minWidth: 260, minHeight: 200 }}
    >
      <NodeResizer isVisible={selected} minWidth={220} minHeight={160} />
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />

      {/* Header */}
      <div className="product-note-node__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StickyNote size={14} color="#B5A069" />
          <span>Workspace Note</span>
        </div>
        <span style={{ fontSize: 9, color: '#A0967A' }}>AUTO-SAVED</span>
      </div>

      {/* Textarea */}
      <textarea
        className="product-note-node__textarea nodrag nowheel"
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Type workspace notes here..."
      />
    </article>
  );
}
