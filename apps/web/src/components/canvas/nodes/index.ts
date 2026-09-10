import { AgentNode } from './AgentNode';
import { CoordinatorNode } from './CoordinatorNode';
import { TaskBoardNode } from './TaskBoardNode';
import { ApprovalNode } from './ApprovalNode';
import { ArtifactNode } from './ArtifactNode';
import { BrowserNode } from './BrowserNode';
import { TerminalNode } from './TerminalNode';
import { NoteNode } from './NoteNode';
import { FileExplorerNode } from './FileExplorerNode';

export const workspaceNodeTypes = {
  productAgent: AgentNode,
  coordinator: CoordinatorNode,
  productTasks: TaskBoardNode,
  approval: ApprovalNode,
  artifact: ArtifactNode,
  browser: BrowserNode,
  terminal: TerminalNode,
  note: NoteNode,
  file: FileExplorerNode,
};

export * from './AgentNode';
export * from './CoordinatorNode';
export * from './TaskBoardNode';
export * from './ApprovalNode';
export * from './ArtifactNode';
export * from './BrowserNode';
export * from './TerminalNode';
export * from './NoteNode';
export * from './FileExplorerNode';
