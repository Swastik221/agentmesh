import { createWorkspaceState } from '../features/workspace/workspace.mock';
import type { DemoProfile, DemoState, DemoWorkspace } from './demo.types';

export const DEMO_PROFILES: DemoProfile[] = [
  { id: 'anand', name: 'Anand', email: 'anand@agentmesh.demo', wallet: '0x1a2b...9f3c', ens: 'dev1.eth', color: 'purple', agent: { id: 'orion', name: 'Orion', provider: 'Codex', ens: 'codex.dev1.eth', capabilities: ['frontend', 'React', 'identity'] } },
  { id: 'swastik', name: 'Swastik', email: 'swastik@agentmesh.demo', wallet: '0x7c81...a6e7', ens: 'dev2.eth', color: 'teal', agent: { id: 'vega', name: 'Vega', provider: 'Claude', ens: 'claude.dev2.eth', capabilities: ['backend', 'API', 'Solidity'] } },
];
export const PRIMARY_WORKSPACE: DemoWorkspace = { id: 'checkout-demo', name: 'Checkout Protocol Workspace', inviteCode: 'MESH-2026', memberCount: 2, agentCount: 2, online: true };
export const PREPARED_PRD = `Build a checkout protocol with wallet identity, a payment API, human approval for contract deployment, and a published ABI artifact.`;
export const REPLAY_STEPS = [
  ['HELLO', 'Swastik joined the workspace'],
  ['CAPABILITY_ANNOUNCEMENT', 'Vega announced backend, API, Solidity'],
  ['TASK_PROPOSAL', 'Coordinator generated AM-114 through AM-117'],
  ['TASK_PREFERENCE', 'Anand selected frontend work'],
  ['TASK_PREFERENCE', 'Swastik selected backend work'],
  ['TASK_AUTO_ASSIGNED', 'AM-116 assigned by capability after countdown'],
  ['ARTIFACT_PUBLISHED', 'Vega published payment-api.json'],
  ['DEPENDENCY_REQUEST', 'Orion received payment-api.json'],
  ['APPROVAL_REQUESTED', 'Orion requested contract deployment approval'],
] as const;

export function initialDemoState(): DemoState {
  return {
    session: null, identity: null, workspaces: [PRIMARY_WORKSPACE], workspace: createWorkspaceState(),
    terminal: {
      orion: [{ id: 'welcome-orion', kind: 'output', text: 'Orion ready. Type agentmesh help.' }],
      vega: [{ id: 'welcome-vega', kind: 'output', text: 'Vega ready. Type agentmesh help.' }],
    },
    browser: { history: ['agentmesh://preview/checkout'], index: 0, loading: false },
    replay: { active: false, playing: false, step: 0, completed: false },
    prdSubmitted: true, revision: 0,
  };
}
