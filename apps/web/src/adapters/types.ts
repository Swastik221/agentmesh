/**
 * AgentMesh Core Domain Types & Adapter Interfaces
 *
 * This adapter layer decouples UI components from real/simulated backends and blockchains.
 * A developer or teammate can swap the demo implementations with real Web3/WebSocket/REST
 * services without modifying any UI component.
 */

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface WalletIdentity {
  address: string;
  truncatedAddress: string;
  provider: 'metamask' | 'coinbase' | 'rabby' | 'demo';
  connected: boolean;
  chainId: number;
}

export interface ENSIdentity {
  ens: string;
  address: string;
  avatar?: string;
  resolved: boolean;
}

export interface Agent {
  id: string;
  name: string;
  provider: 'Codex' | 'Claude' | 'Gemini' | string;
  ownerId: string;
  ownerName: string;
  ownerEns: string;
  ownerColor: 'purple' | 'green';
  ens: string;
  address: string;
  capabilities: string[];
  status: 'connected' | 'idle' | 'working' | 'waiting' | 'offline';
  repoScope?: string;
  logs: string[];
}

export interface Workspace {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  agentCount: number;
  online: boolean;
}

export interface Cursor {
  id: string;
  name: string;
  ens: string;
  color: 'purple' | 'green';
  x: number;
  y: number;
  updatedAt: number;
  action?: string;
  activeNodeId?: string;
}

export type TaskStatus = 'proposed' | 'claimed' | 'auto-assigned' | 'waiting' | 'done';

export interface Task {
  id: string;
  title: string;
  capability: string;
  status: TaskStatus;
  suggestedAgent: string;
  claimedBy?: string;
  claimedByName?: string;
  claimedByEns?: string;
  countdown?: number;
  reason?: string;
}

export type ProtocolEventType =
  | 'HELLO'
  | 'CAPABILITY_ANNOUNCEMENT'
  | 'TASK_PROPOSAL'
  | 'TASK_PREFERENCE'
  | 'TASK_CLAIMED'
  | 'TASK_AUTO_ASSIGNED'
  | 'DEPENDENCY_REQUEST'
  | 'ARTIFACT_PUBLISHED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_REJECTED';

export interface ProtocolEvent {
  id: string;
  workspaceId: string;
  time: string;
  timestamp: string;
  sender: string;
  receiver: string;
  type: ProtocolEventType;
  payload: string;
  taskId?: string;
  artifactId?: string;
  approvalId?: string;
}

export interface Artifact {
  id: string;
  name: string;
  schema: string;
  hash: string;
  publishedBy: string;
  usedBy: string;
  content?: string;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  detail: string;
  spendThreshold?: string;
  requestedBy: string;
  ownerEns: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface FileItem {
  id: string;
  path: string;
  name: string;
  type: 'file' | 'directory';
  content?: string;
  children?: FileItem[];
}

export interface TerminalSession {
  sessionId: string;
  agentId: string;
  history: Array<{ id: string; kind: 'command' | 'output' | 'error' | 'success'; text: string }>;
}

/* =========================================================================
 * Adapter Interfaces
 * ========================================================================= */

export interface AuthAdapter {
  login(credentials: { email: string; password?: string; remember?: boolean }): Promise<User>;
  signup(details: { displayName: string; email: string; password?: string }): Promise<User>;
  logout(): Promise<void>;
  getCurrentUser(): User | null;
}

export interface WalletAdapter {
  connectWallet(provider?: WalletIdentity['provider']): Promise<WalletIdentity>;
  resolveEns(address: string): Promise<ENSIdentity>;
  signApproval(approvalId: string, action: string, spendThreshold?: string): Promise<{ signature: string; txHash: string }>;
  disconnect(): Promise<void>;
}

export interface AgentConnectionAdapter {
  getAvailableAgents(): Promise<Agent[]>;
  connectAgent(agentId: string, options?: { provider?: string; repoScope?: string }): Promise<Agent>;
  disconnectAgent(agentId: string): Promise<void>;
  announceCapabilities(agentId: string, capabilities: string[]): Promise<ProtocolEvent>;
}

export interface WorkspaceRealtimeAdapter {
  joinWorkspace(workspaceId: string, user: User): Promise<Workspace>;
  publishCursor(workspaceId: string, cursor: Cursor): void;
  subscribeCursors(workspaceId: string, callback: (cursors: Cursor[]) => void): () => void;
  publishNodeMovement(workspaceId: string, nodeId: string, position: { x: number; y: number }): void;
  subscribeNodeMovements(workspaceId: string, callback: (update: { nodeId: string; position: { x: number; y: number }; actor?: string }) => void): () => void;
  publishEvent(workspaceId: string, event: ProtocolEvent): void;
  subscribeEvents(workspaceId: string, callback: (event: ProtocolEvent) => void): () => void;
}

export interface TaskProtocolAdapter {
  getTasks(workspaceId: string): Promise<Task[]>;
  submitPrd(workspaceId: string, prdText: string): Promise<Task[]>;
  claimTask(workspaceId: string, taskId: string, agentId: string): Promise<Task>;
  autoAssignTask(workspaceId: string, taskId: string, agentId: string): Promise<Task>;
  requestApproval(workspaceId: string, request: ApprovalRequest): Promise<ApprovalRequest>;
  decideApproval(workspaceId: string, approvalId: string, decision: 'approved' | 'rejected'): Promise<ApprovalRequest>;
}

export interface FileAdapter {
  getFiles(workspaceId: string): Promise<FileItem[]>;
  readFile(workspaceId: string, path: string): Promise<string>;
  getArtifacts(workspaceId: string): Promise<Artifact[]>;
  publishArtifact(workspaceId: string, artifact: Artifact): Promise<Artifact>;
}

export interface TerminalAdapter {
  createSession(agentId: string): Promise<TerminalSession>;
  executeCommand(
    sessionId: string,
    command: string,
    context?: { workspaceId: string }
  ): Promise<{
    output: string[];
    action?: 'connect' | 'status' | 'tasks' | 'claim' | 'publish' | 'approval' | 'clear' | 'unknown';
    payload?: string;
  }>;
}

export interface BrowserPreviewAdapter {
  getPreview(url: string): Promise<{ title: string; type: 'html' | 'json'; content: string }>;
}
