export const repository = 'https://github.com/Swastik221/agentmesh';
export const chapters = [
  ['workspace', 'Workspace', 'I'],
  ['agents', 'Agents', 'II'],
  ['coordination', 'Coordination', 'III'],
  ['control', 'Control', 'IV'],
  ['identity', 'Identity', 'V'],
  ['developers', 'Developers', 'VI'],
] as const;
export type FeatureStatus = 'available' | 'preview' | 'planned';
export const features: Record<string, { status: FeatureStatus; publicDescription: string }> = {
  canvas: { status: 'preview', publicDescription: 'Local interactive preview' },
  adapters: {
    status: 'planned',
    publicDescription: 'Codex and Claude adapters are planned; this demo simulates both.',
  },
  control: { status: 'planned', publicDescription: 'Planned control · local simulation' },
  identity: { status: 'preview', publicDescription: 'ENS identity concept · no live resolution' },
  payments: { status: 'planned', publicDescription: 'Illustrative testnet flow · no transaction' },
};
export const artifact = {
  type: 'ARTIFACT_PUBLISHED',
  actor: 'orion',
  owner: 'anand-demo',
  taskId: 'AM-115',
  artifact: 'payment-api.json',
  version: 'v1',
};
export const faqs = [
  [
    'Is AgentMesh another coding model?',
    'No. It is a coordination layer for coding agents operated by developers. Bring your tools; share the direction.',
  ],
  [
    'Does this preview connect real agents?',
    'No. Everything in the public canvas runs locally and deterministically. No AI providers, wallets, or collaboration servers are contacted.',
  ],
  [
    'Can teammates see everything my agent knows?',
    'The design calls for explicit, task-scoped sharing. Private prompts and unrelated local files should not automatically become team context. Enforcement is still planned.',
  ],
  [
    'Does dragging a node grant permission?',
    'No. Canvas layout and execution authorization are separate. Moving a node only changes this local preview.',
  ],
  [
    'Does ENS protect files on my computer?',
    'No. Identity records do not enforce local permissions. The executor needs tested process and filesystem isolation or a brokered credential path.',
  ],
  [
    'Which agents and editors are supported?',
    `${features.adapters.publicDescription} The intended adapter model works alongside your editor; no tested editor integrations are claimed yet.`,
  ],
  [
    'Does it save tokens?',
    'Scoped context can reduce duplication, but coordination adds overhead. There are no measured savings to report yet.',
  ],
];
