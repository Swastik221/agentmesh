import { useState, type FormEvent } from 'react';
import { Paperclip, ArrowUp, ChevronDown, ChevronUp } from 'lucide-react';
import type { DockToolType } from './ToolDock';

interface CommandComposerProps {
  onAddTool: (tool: DockToolType) => void;
  onRunNaturalCommand: (command: string) => string;
}

export function CommandComposer({ onAddTool, onRunNaturalCommand }: CommandComposerProps) {
  const [command, setCommand] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = command.trim();
    if (!text) return;

    const feedback = onRunNaturalCommand(text);
    setStatusMessage(feedback);
    setCommand('');
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleAttach = () => {
    onAddTool('file');
    setStatusMessage('Project explorer file preview added');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <form className="mesh-command-composer" onSubmit={handleSubmit}>
        <button
          type="button"
          className="mesh-composer-btn"
          title="Attach project file/document"
          onClick={handleAttach}
        >
          <Paperclip size={16} />
        </button>

        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Try ‘add two coding agents, connect them, split PRD into tasks’"
          aria-label="Workspace Command Input"
        />

        <button
          type="submit"
          className="mesh-composer-btn mesh-composer-btn--send"
          title="Send command"
          disabled={!command.trim()}
        >
          <ArrowUp size={16} />
        </button>

        <button
          type="button"
          className="mesh-composer-btn"
          title={collapsed ? 'Expand tools dock' : 'Collapse tools dock'}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </form>

      {statusMessage && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--mesh-primary-green)',
            backgroundColor: 'var(--mesh-bg-card)',
            border: '1px solid var(--mesh-border-subtle)',
            borderRadius: 6,
            padding: '3px 8px',
            alignSelf: 'center',
            boxShadow: '0 2px 6px rgba(30, 43, 38, 0.06)',
          }}
        >
          {statusMessage}
        </div>
      )}
    </div>
  );
}
