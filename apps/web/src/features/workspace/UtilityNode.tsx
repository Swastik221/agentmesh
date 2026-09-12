import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';

export type UtilityData = {
  kind: 'note' | 'file' | 'browser' | 'terminal';
  title: string;
  text: string;
  onEdit?: (text: string) => void;
} & Record<string, unknown>;

export type UtilityFlowNode = Node<UtilityData, 'utility'>;

export function UtilityNode({ data, selected }: NodeProps<UtilityFlowNode>) {
  return (
    <article className={`product-node utility-node utility-node--${data.kind}`}>
      <NodeResizer isVisible={selected} minWidth={300} minHeight={190} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <header>
        <strong>{data.title}</strong>
      </header>
      {data.kind === 'note' ? (
        <textarea
          className="nodrag nowheel"
          aria-label="Note content"
          value={data.text}
          onChange={(e) => data.onEdit?.(e.target.value)}
        />
      ) : (
        <pre className="nowheel">{data.text}</pre>
      )}
    </article>
  );
}
