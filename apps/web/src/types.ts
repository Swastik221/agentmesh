import type { Node } from '@xyflow/react';

/** Sections in the left rail. Terminal and Browser are reserved for a later pass. */
export type SectionId =
  'project' | 'agents' | 'tasks' | 'activity' | 'files' | 'terminal' | 'browser';

export interface NavItem {
  id: SectionId;
  label: string;
  /** Reserved sections render greyed out and are not selectable. */
  reserved?: boolean;
}

/** One line of explorer-style agent output: block height, tx-ish hash, message. */
export interface AgentLogLine {
  block: string;
  hash: string;
  message: string;
}

export type AgentConnectionStatus = 'connected' | 'idle';

export interface AgentNodeFields extends Record<string, unknown> {
  name: string;
  /** ENS-style identity, e.g. `codex.dev1.eth`. */
  ens: string;
  /** Full address. Always rendered truncated. */
  address: string;
  status: AgentConnectionStatus;
  log: AgentLogLine[];
}

export type TaskStatus = 'proposed' | 'claimed' | 'auto-assigned';

export interface TaskItem {
  id: string;
  title: string;
  /** Short reference token, explorer style. */
  ref: string;
  status: TaskStatus;
  /** ENS-style identity of the claiming agent, when there is one. */
  claimedBy?: string;
}

export interface TaskBoardNodeFields extends Record<string, unknown> {
  title: string;
  tasks: TaskItem[];
}

export type AgentFlowNode = Node<AgentNodeFields, 'agent'>;
export type TaskBoardFlowNode = Node<TaskBoardNodeFields, 'taskBoard'>;
export type WorkspaceNode = AgentFlowNode | TaskBoardFlowNode;
