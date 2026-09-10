import type {
  HumanOwner,
  ProductAgent,
  ProductWorkspaceState,
  WorkspaceArtifact,
  WorkspacePresence,
} from './workspace.types';

export const owners: HumanOwner[] = [
  { id: 'anand', name: 'Anand-demo', ens: 'dev1.eth', address: '0x1a2b…93f3c', color: 'purple' },
  { id: 'swastik', name: 'Swastik-demo', ens: 'dev2.eth', address: '0x7c81…a6e7', color: 'green' },
];
export const agents: ProductAgent[] = [
  {
    id: 'orion',
    name: 'Orion',
    provider: 'Codex',
    ownerId: 'anand',
    ens: 'codex.dev1.eth',
    address: '0x91a3…b9f3c',
    capabilities: ['frontend', 'identity', 'React'],
    status: 'connected',
    logs: [
      'TASK_PREFERENCE · AM-114',
      'DEPENDENCY_REQUEST · payment-api.json',
      'repo scope · src/identity/**',
    ],
  },
  {
    id: 'vega',
    name: 'Vega',
    provider: 'Claude',
    ownerId: 'swastik',
    ens: 'claude.dev2.eth',
    address: '0x2e50…f8a1',
    capabilities: ['backend', 'API', 'Solidity'],
    status: 'connected',
    logs: ['TASK_PREFERENCE · AM-115', 'ARTIFACT_PUBLISHED · schema', 'repo scope · contracts/**'],
  },
];
export const artifact: WorkspaceArtifact = {
  id: 'artifact-payment',
  name: 'payment-api.json',
  hash: 'sha256:7fb2…91cd',
  schema: 'payment-api/v1',
  publishedBy: 'Vega / Claude',
  usedBy: 'Orion / Codex',
};
export const presence: WorkspacePresence[] = [
  { id: 'presence-anand', humanOwnerId: 'anand', agentId: 'orion' },
  { id: 'presence-swastik', humanOwnerId: 'swastik', agentId: 'vega' },
];

export function createWorkspaceState(): ProductWorkspaceState {
  return {
    tasks: [
      {
        id: 'AM-114',
        title: 'Build wallet identity panel',
        capability: 'frontend',
        status: 'proposed',
        suggestedAgent: 'orion',
        countdown: 24,
        reason: 'Orion matches frontend + identity.',
      },
      {
        id: 'AM-115',
        title: 'Build payment API',
        capability: 'backend',
        status: 'proposed',
        suggestedAgent: 'vega',
        countdown: 31,
        reason: 'Vega matches backend + API.',
      },
      {
        id: 'AM-116',
        title: 'Add approval modal',
        capability: 'security/web3',
        status: 'proposed',
        suggestedAgent: 'orion',
        countdown: 18,
        reason: 'No exact match; coordinator suggests the available frontend agent.',
      },
      {
        id: 'AM-117',
        title: 'Publish ABI artifact',
        capability: 'protocol',
        status: 'auto-assigned',
        suggestedAgent: 'vega',
        claimedBy: 'vega',
        reason: 'No preference received; assigned by closest capability.',
      },
    ],
    approval: {
      id: 'APR-08',
      action: 'Deploy checkout contract',
      detail: 'Requested spend threshold: $0.001 USDC',
      status: 'pending',
    },
    events: [
      {
        id: 'e1',
        time: '10:42:01',
        sender: 'Anand-demo',
        receiver: 'mesh',
        type: 'HELLO',
        payload: 'dev1.eth joined workspace',
      },
      {
        id: 'e2',
        time: '10:42:03',
        sender: 'Orion',
        receiver: 'coordinator',
        type: 'CAPABILITY_ANNOUNCEMENT',
        payload: 'frontend, identity, React',
      },
      {
        id: 'e3',
        time: '10:42:05',
        sender: 'Vega',
        receiver: 'coordinator',
        type: 'CAPABILITY_ANNOUNCEMENT',
        payload: 'backend, API, Solidity',
      },
      {
        id: 'e4',
        time: '10:42:09',
        sender: 'coordinator',
        receiver: 'all agents',
        type: 'TASK_PROPOSAL',
        payload: 'AM-114…AM-117',
      },
      {
        id: 'e5',
        time: '10:42:18',
        sender: 'Orion',
        receiver: 'Vega',
        type: 'DEPENDENCY_REQUEST',
        payload: 'payment-api.json',
      },
      {
        id: 'e6',
        time: '10:42:23',
        sender: 'Vega',
        receiver: 'Orion',
        type: 'ARTIFACT_PUBLISHED',
        payload: 'payment-api.json · v1',
      },
      {
        id: 'e7',
        time: '10:42:26',
        sender: 'Vega',
        receiver: 'Anand-demo',
        type: 'APPROVAL_REQUESTED',
        payload: 'deploy · $0.001 USDC',
      },
    ],
  };
}
