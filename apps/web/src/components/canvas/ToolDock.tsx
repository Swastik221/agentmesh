import type { DragEvent } from 'react';
import {
  Bot,
  Globe,
  StickyNote,
  FileText,
  ListChecks,
  ShieldCheck,
} from 'lucide-react';

export type DockToolType =
  | 'codex'
  | 'claude'
  | 'gemini'
  | 'terminal'
  | 'browser'
  | 'note'
  | 'file'
  | 'taskboard'
  | 'approval'
  | 'coordinator'
  | 'artifact';

interface DockToolItem {
  id: DockToolType;
  label: string;
  icon?: typeof Bot;
  isTerminalText?: boolean;
  colorClass: string;
}

export const DOCK_TOOLS: DockToolItem[] = [
  { id: 'codex', label: 'Codex agent (Orion)', icon: Bot, colorClass: 'mesh-dock-item--purple' },
  { id: 'claude', label: 'Claude agent (Vega)', icon: Bot, colorClass: 'mesh-dock-item--green' },
  { id: 'gemini', label: 'Gemini agent (Nova)', icon: Bot, colorClass: 'mesh-dock-item--purple' },
  { id: 'terminal', label: 'Terminal', isTerminalText: true, colorClass: '' },
  { id: 'browser', label: 'Browser', icon: Globe, colorClass: '' },
  { id: 'note', label: 'Note', icon: StickyNote, colorClass: '' },
  { id: 'file', label: 'File', icon: FileText, colorClass: '' },
  { id: 'taskboard', label: 'Task board', icon: ListChecks, colorClass: '' },
  { id: 'approval', label: 'Approval gate', icon: ShieldCheck, colorClass: '' },
];

interface ToolDockProps {
  onAddTool: (tool: DockToolType, flowPosition?: { x: number; y: number }) => void;
}

export function ToolDock({ onAddTool }: ToolDockProps) {
  const handleDragStart = (e: DragEvent, toolId: DockToolType) => {
    e.dataTransfer.setData('application/agentmesh-tool', toolId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
      <nav className="mesh-tool-dock" aria-label="AgentMesh Tool Dock">
        {DOCK_TOOLS.map(({ id, label, icon: Icon, isTerminalText, colorClass }) => (
          <button
            key={id}
            type="button"
            className={`mesh-dock-item ${colorClass}`}
            title={`${label} (Click or drag onto canvas)`}
            aria-label={label}
            data-label={label}
            draggable
            onDragStart={(e) => handleDragStart(e, id)}
            onClick={() => onAddTool(id)}
          >
            {isTerminalText ? (
              <span
                style={{
                  fontFamily: 'var(--mesh-font-mono)',
                  fontWeight: 700,
                  fontSize: 14,
                  display: 'inline-block',
                }}
              >
                &gt;_
              </span>
            ) : Icon ? (
              <Icon size={19} strokeWidth={1.75} />
            ) : null}
            <span style={{ display: 'none' }}>{label}</span>
          </button>
        ))}
    </nav>
  );
}
