import { StickyNote } from 'lucide-react';

export type DockToolType = 'note';

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
//
// File, Task board and Approval gate went too: they added node types the
// canvas could not render, or duplicated the live board that is always on the
// canvas. A note is the one thing a viewer can add, and it is explicitly a
// private scratch note kept on this device.
export const DOCK_TOOLS: DockToolItem[] = [
  { id: 'note', label: 'Note (only you)', icon: StickyNote, colorClass: '' },
];

interface ToolDockProps {
  onAddTool: (tool: DockToolType, flowPosition?: { x: number; y: number }) => void;
}

export function ToolDock({ onAddTool }: ToolDockProps) {
  return (
      <nav className="mesh-tool-dock" aria-label="AgentMesh Tool Dock">
        {DOCK_TOOLS.map(({ id, label, icon: Icon, colorClass }) => (
          <button
            key={id}
            type="button"
            className={`mesh-dock-item ${colorClass}`}
            title={label}
            aria-label={label}
            data-label={label}
            onClick={() => onAddTool(id)}
          >
            <Icon size={19} strokeWidth={1.75} />
            <span style={{ display: 'none' }}>{label}</span>
          </button>
        ))}
    </nav>
  );
}
