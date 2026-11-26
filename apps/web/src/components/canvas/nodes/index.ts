import { AgentNode } from './AgentNode';
import { CoordinatorNode } from './CoordinatorNode';
import { TaskBoardNode } from './TaskBoardNode';
import { ApprovalNode } from './ApprovalNode';
import { ArtifactNode } from './ArtifactNode';
import { BrowserNode } from './BrowserNode';
import { NoteNode } from './NoteNode';
import { FileExplorerNode } from './FileExplorerNode';

export const workspaceNodeTypes = {
  productAgent: AgentNode,
  coordinator: CoordinatorNode,
  productTasks: TaskBoardNode,
  approval: ApprovalNode,
  artifact: ArtifactNode,
  browser: BrowserNode,
  note: NoteNode,
  file: FileExplorerNode,
};

export * from './AgentNode';
export * from './CoordinatorNode';
export * from './TaskBoardNode';
export * from './ApprovalNode';
export * from './ArtifactNode';
export * from './BrowserNode';
export * from './NoteNode';
export * from './FileExplorerNode';
