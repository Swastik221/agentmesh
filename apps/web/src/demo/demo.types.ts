import type { ProductWorkspaceState } from '../features/workspace/workspace.types';

export type DemoProfileId = 'anand' | 'swastik';
export interface DemoSession { id: string; email: string; displayName: string; profileId: DemoProfileId; createdAt: string }
export interface DemoProfile {
  id: DemoProfileId; name: string; email: string; wallet: string; ens: string;
  agent: { id: 'orion' | 'vega'; name: string; provider: string; ens: string; capabilities: string[] };
  color: 'purple' | 'teal';
}
export interface DemoIdentity { profileId: DemoProfileId; walletConnected: boolean; ensResolved: boolean; agentConnected: boolean }
export interface DemoWorkspace { id: string; name: string; inviteCode: string; memberCount: number; agentCount: number; online: boolean }
export interface TerminalLine { id: string; kind: 'command' | 'output' | 'success' | 'error'; text: string }
export interface BrowserState { history: string[]; index: number; loading: boolean; error?: string }
export interface ReplayState { active: boolean; playing: boolean; step: number; completed: boolean }
export interface DemoState {
  session: DemoSession | null;
  identity: DemoIdentity | null;
  workspaces: DemoWorkspace[];
  workspace: ProductWorkspaceState;
  terminal: Record<'orion' | 'vega', TerminalLine[]>;
  browser: BrowserState;
  replay: ReplayState;
  prdSubmitted: boolean;
  revision: number;
}

export interface LoginInput { email: string; password: string; remember: boolean }
export interface SignupInput { displayName: string; email: string; password: string }
export interface AuthGateway {
  login(input: LoginInput): Promise<DemoSession>;
  signup(input: SignupInput): Promise<DemoSession>;
  logout(): Promise<void>;
  getSession(): DemoSession | null;
}
export interface IdentityGateway {
  connectWallet(profileId: DemoProfileId): Promise<DemoIdentity>;
  resolveEns(identity: DemoIdentity): Promise<DemoIdentity>;
  registerAgent(identity: DemoIdentity): Promise<DemoIdentity>;
}
export interface WorkspaceGateway {
  create(name: string): Promise<DemoWorkspace>;
  join(inviteCode: string): Promise<DemoWorkspace>;
}
export interface PresenceGateway { publish(message: DemoSyncMessage): void; subscribe(listener: (message: DemoSyncMessage) => void): () => void }
export interface TaskGateway { claim(taskId: string, profile: DemoProfile): void }
export interface ProtocolGateway { append(type: string, payload: string): void }
export interface ApprovalGateway { decide(decision: 'approved' | 'rejected'): void }
export interface TerminalGateway { execute(command: string, state: DemoState): { output: string[]; action?: string; value?: string } }
export interface BrowserGateway { resolve(route: string, state: DemoState): { title: string; body: string; code?: string } }
export type DemoSyncMessage =
  | { kind: 'STATE'; source: string; state: DemoState }
  | { kind: 'CURSOR'; source: string; profileId: DemoProfileId; x: number; y: number; action?: string; at: number }
  | { kind: 'NODE'; source: string; nodeId: string; x: number; y: number; action: 'move' | 'select' };
