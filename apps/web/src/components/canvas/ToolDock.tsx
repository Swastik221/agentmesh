import type { DragEvent } from 'react';
import { StickyNote, FileText, ListChecks, ShieldCheck } from 'lucide-react';

export type DockToolType =
  | 'note'
  | 'file'
  | 'taskboard'
  | 'approval'
  | 'coordinator'
  | 'artifact';

interface DockToolItem {
  id: DockToolType;
  label: string;
  icon: typeof StickyNote;
  colorClass: string;
}

// Agents are not dock tools: a real agent is registered in the Agents view and
// then connects over the protocol. Dock entries that dropped a named agent onto
// the canvas created nothing server-side, so they were removed rather than left
// looking like they worked.
//
// Terminal and Browser went the same way. Both dropped a card holding a canned
// string ("$ agentmesh status", "https://localhost:3001") that ran nothing and
// loaded nothing. An agent's real terminal is its CLI, whose output already
// streams onto that agent's card on this canvas.
export const DOCK_TOOLS: DockToolItem[] = [
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
        {DOCK_TOOLS.map(({ id, label, icon: Icon, colorClass }) => (
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
            <Icon size={19} strokeWidth={1.75} />
            <span style={{ display: 'none' }}>{label}</span>
          </button>
        ))}
    </nav>
  );
}
