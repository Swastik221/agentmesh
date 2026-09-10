import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { useDemo } from '../../demo/DemoProvider';
export type UtilityData = { kind: 'note' | 'file' | 'browser' | 'terminal'; title: string; text: string; onEdit?: (text: string) => void } & Record<string, unknown>;
export type UtilityFlowNode = Node<UtilityData, 'utility'>;
export function UtilityNode({ data, selected }: NodeProps<UtilityFlowNode>) {
  const { state, runCommand } = useDemo();
  return <article className={`product-node utility-node utility-node--${data.kind}`}><NodeResizer isVisible={selected} minWidth={300} minHeight={190}/><Handle type="target" position={Position.Left}/><Handle type="source" position={Position.Right}/><header><strong>{data.title}</strong><span>DEMO</span></header>{data.kind === 'note' ? <textarea className="nodrag nowheel" aria-label="Note content" value={data.text} onChange={(e) => data.onEdit?.(e.target.value)}/> : data.kind === 'terminal' ? <><div className="utility-log nowheel">{state.terminal.orion.slice(-5).map((line) => <p key={line.id}>{line.text}</p>)}</div><form className="nodrag" onSubmit={(e) => { e.preventDefault(); const input = e.currentTarget.elements.namedItem('command') as HTMLInputElement; runCommand('orion', input.value); input.value = ''; }}><input name="command" aria-label="Node terminal command" placeholder="agentmesh help"/><button>Run</button></form></> : <pre className="nowheel">{data.text}</pre>}</article>;
}
