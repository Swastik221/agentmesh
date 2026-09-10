import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileJson } from 'lucide-react';
import type { Artifact } from '../../../adapters/types';

export interface ArtifactNodeData {
  artifact: Artifact;
  onInspect?: () => void;
}

export function ArtifactNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ArtifactNodeData;
  const artifact = nodeData.artifact;

  return (
    <article className={`product-node product-artifact ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />

      {/* Header */}
      <header className="product-artifact__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileJson size={16} color="var(--mesh-owner-anand)" />
          <strong>{artifact.name}</strong>
        </div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            backgroundColor: 'rgba(139, 111, 232, 0.18)',
            color: 'var(--mesh-owner-anand)',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          PUBLISHED
        </span>
      </header>

      {/* Body */}
      <div className="product-artifact__body">
        <div className="product-artifact__row">
          <span className="product-artifact__label">Schema</span>
          <span className="product-artifact__val">{artifact.schema}</span>
        </div>
        <div className="product-artifact__row">
          <span className="product-artifact__label">Hash</span>
          <span className="product-artifact__val" style={{ fontSize: 10, color: 'var(--mesh-text-muted)' }}>
            {artifact.hash}
          </span>
        </div>
        <div className="product-artifact__row">
          <span className="product-artifact__label">From</span>
          <span className="product-artifact__val" style={{ color: 'var(--mesh-owner-swastik)', fontWeight: 600 }}>
            {artifact.publishedBy}
          </span>
        </div>
        <div className="product-artifact__row" style={{ marginBottom: 0 }}>
          <span className="product-artifact__label">Used By</span>
          <span className="product-artifact__val" style={{ color: 'var(--mesh-owner-anand)', fontWeight: 600 }}>
            {artifact.usedBy}
          </span>
        </div>
      </div>
    </article>
  );
}
