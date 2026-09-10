import { useState } from 'react';
import { ArrowUp, Bot, ChevronDown, FileText, Globe, ListChecks, Paperclip, ShieldCheck, StickyNote, Terminal } from 'lucide-react';
export const canvasTools = [
  { id: 'codex', label: 'Codex agent', icon: Bot }, { id: 'claude', label: 'Claude agent', icon: Bot }, { id: 'gemini', label: 'Gemini agent', icon: Bot },
  { id: 'terminal', label: 'Terminal node', icon: Terminal }, { id: 'browser', label: 'Browser node', icon: Globe }, { id: 'note', label: 'Note', icon: StickyNote },
  { id: 'file', label: 'File preview', icon: FileText }, { id: 'tasks', label: 'Task board', icon: ListChecks }, { id: 'approval', label: 'Approval gate', icon: ShieldCheck },
] as const;
export type CanvasTool = typeof canvasTools[number]['id'];
export function CanvasTools({ onAdd, onCommand }: { onAdd(tool: CanvasTool): void; onCommand(command: string): string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [command, setCommand] = useState('');
  const [feedback, setFeedback] = useState('Click a tool or drag it onto the canvas');
  return <div className="canvas-tools nodrag nopan"><form onSubmit={(e) => { e.preventDefault(); if (command.trim()) { setFeedback(onCommand(command)); setCommand(''); } }}><button type="button" aria-label="Attach demo document" onClick={() => { onAdd('file'); setFeedback('Demo document added'); }}><Paperclip size={17}/></button><input aria-label="Workspace command" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Try ‘add two coding agents, connect them, split PRD into tasks’"/><button className="composer-send" aria-label="Send workspace command"><ArrowUp size={18}/></button><button type="button" aria-label={collapsed ? 'Expand tools' : 'Collapse tools'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}><ChevronDown size={17}/></button></form>{!collapsed && <div className="tool-dock" aria-label="Canvas tools">{canvasTools.map(({ id, label, icon: Icon }) => <button key={id} draggable title={label} aria-label={`Add ${label}`} onDragStart={(e) => { e.dataTransfer.setData('application/agentmesh-tool', id); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => onAdd(id)}><Icon size={20}/><span>{label}</span></button>)}</div>}<small role="status">{feedback}</small></div>;
}
