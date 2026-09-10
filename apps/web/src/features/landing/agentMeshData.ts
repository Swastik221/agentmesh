/**
 * Content for the three agents in the HeroAgentMesh scroll animation.
 *
 * Kept apart from the component so the terminal copy is easy to edit without
 * touching the choreography. `command` is the line each developer "types" into
 * the laptop in stage 1; `lines` are the terminal rows that scroll into the
 * agent card in stage 2 (revealed progressively, one by one, with scroll).
 */
export type AgentAccent = 'purple' | 'cyan' | 'teal';

export interface AgentMeshCard {
  id: string;
  /** Agent name, e.g. Orion. */
  name: string;
  /** Model / CLI behind it, e.g. Codex. */
  provider: string;
  /** Human owner shown on the card. */
  owner: string;
  /** The command the developer types into the laptop. */
  command: string;
  /** Terminal lines that reveal one-by-one inside the risen card. */
  lines: string[];
  /** Identity / cable-glow accent. */
  accent: AgentAccent;
  /** Where the coder + card sit: hero (top), or the two lower seats. */
  seat: 'top' | 'left' | 'right';
}

export const WORKSPACE_ID = 'AM-7X92';

export const AGENT_MESH_CARDS: AgentMeshCard[] = [
  {
    id: 'orion',
    name: 'Orion',
    provider: 'Codex',
    owner: 'anand.eth',
    command: `npx agentmesh connect --workspace ${WORKSPACE_ID}`,
    lines: [
      `$ npx agentmesh connect --workspace ${WORKSPACE_ID}`,
      '✓ Authenticated as anand.eth',
      '✓ Agent selected: Codex',
      'agent.ready',
      '↳ backend / devops',
      '↳ awaiting shared connection',
      '○ Local agent ready _',
    ],
    accent: 'purple',
    seat: 'top',
  },
  {
    id: 'vega',
    name: 'Vega',
    provider: 'Claude',
    owner: 'swastik.eth',
    command: `npx agentmesh connect --workspace ${WORKSPACE_ID}`,
    lines: [
      `$ npx agentmesh connect --workspace ${WORKSPACE_ID}`,
      '✓ Authenticated as swastik.eth',
      '✓ Agent selected: Claude',
      'agent.ready',
      '↳ frontend / solidity',
      '↳ awaiting shared connection',
      '○ Local agent ready _',
    ],
    accent: 'teal',
    seat: 'left',
  },
  {
    id: 'nova',
    name: 'Nova',
    provider: 'Gemini CLI',
    owner: 'dev.eth',
    command: `npx agentmesh connect --workspace ${WORKSPACE_ID}`,
    lines: [
      `$ npx agentmesh connect --workspace ${WORKSPACE_ID}`,
      '✓ Authenticated as dev.eth',
      '✓ Agent selected: Gemini CLI',
      'agent.ready',
      '↳ testing / QA',
      '↳ awaiting shared connection',
      '○ Local agent ready _',
    ],
    accent: 'cyan',
    seat: 'right',
  },
];
