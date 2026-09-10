import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { Terminal as TerminalIcon, Send } from 'lucide-react';
import { adapters } from '../../../adapters';

export interface TerminalNodeData {
  agentId?: string;
  onExecuteCommand?: (command: string) => void;
}

interface LogLine {
  id: string;
  kind: 'cmd' | 'out' | 'err' | 'ok';
  text: string;
}

export function TerminalNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as TerminalNodeData;
  const agentId = nodeData.agentId || 'orion';
  const [lines, setLines] = useState<LogLine[]>([
    { id: '1', kind: 'out', text: `AgentMesh Interactive CLI · ${agentId}@dev1.eth` },
    { id: '2', kind: 'out', text: 'Type "agentmesh tasks", "agentmesh claim AM-114", or "help"' },
  ]);
  const [input, setInput] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd) return;
    setInput('');

    const newLines: LogLine[] = [...lines, { id: `cmd-${Date.now()}`, kind: 'cmd', text: `$ ${cmd}` }];
    setLines(newLines);

    if (cmd === 'clear') {
      setLines([]);
      return;
    }

    const result = await adapters.terminal.executeCommand(`session-${agentId}`, cmd);
    if (result.action === 'clear') {
      setLines([]);
      return;
    }

    const outputLines: LogLine[] = result.output.map((text, i) => ({
      id: `out-${Date.now()}-${i}`,
      kind: text.startsWith('✓') ? 'ok' : text.startsWith('Command not') ? 'err' : 'out',
      text,
    }));

    setLines((prev) => [...prev, ...outputLines]);
    nodeData.onExecuteCommand?.(cmd);
  };

  return (
    <article
      className={`product-node product-terminal-node ${selected ? 'is-selected' : ''}`}
      style={{ minWidth: 380, minHeight: 240 }}
    >
      <NodeResizer isVisible={selected} minWidth={340} minHeight={200} />
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />

      {/* Header */}
      <div className="product-terminal-node__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="product-window-dots">
            <i />
            <i />
            <i />
          </span>
          <TerminalIcon size={13} color="#55D688" />
          <span style={{ color: '#D6E8DE', fontWeight: 600 }}>
            {agentId}@dev1.eth:~/agentmesh
          </span>
        </div>
        <span style={{ color: '#7AA695', fontSize: 10 }}>zsh</span>
      </div>

      {/* Terminal logs */}
      <div className="product-terminal-node__body nowheel nodrag">
        {lines.map((line) => (
          <div
            key={line.id}
            style={{
              marginBottom: 3,
              color:
                line.kind === 'cmd'
                  ? '#8B6FE8'
                  : line.kind === 'ok'
                    ? '#55D688'
                    : line.kind === 'err'
                      ? '#FF6B6B'
                      : '#D6E8DE',
            }}
          >
            {line.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* Command Input Form */}
      <form className="product-terminal-node__input-form nodrag" onSubmit={handleSubmit}>
        <span className="product-terminal-node__prompt">›</span>
        <input
          className="product-terminal-node__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type agentmesh status, claim AM-114..."
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          className="mesh-composer-btn nodrag nopan"
          style={{ padding: 3, color: '#55D688' }}
        >
          <Send size={12} />
        </button>
      </form>
    </article>
  );
}
