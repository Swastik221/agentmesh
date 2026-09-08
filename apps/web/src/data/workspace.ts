import { MarkerType, type Edge } from '@xyflow/react';
import type { NavItem, WorkspaceNode } from '../types';

/**
 * Placeholder workspace state.
 *
 * Everything here is mock data for the UI shell pass — no agent is really
 * connected and no task is really claimed. It exists so the layout, the canvas
 * interactions and the colour semantics can be exercised end to end.
 */

export const currentUser = {
  ens: 'dev1.eth',
  address: '0x1a2b3c4d5e6f7081920a1b2c3d4e5f60718293f3c',
} as const;

export const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'files', label: 'Files' },
  { id: 'activity', label: 'Activity' },
  { id: 'terminal', label: 'Terminal', reserved: true },
  { id: 'browser', label: 'Browser', reserved: true },
];

/** Placeholder project. There is no project switching yet. */
export const currentProject = {
  id: 'agentmesh-demo',
  name: 'AgentMesh Demo Project',
  slug: 'agentmesh-demo',
} as const;

/**
 * Visual-only agent roster for the Overview page. These are placeholders and
 * are deliberately offline — no agent registration exists yet.
 */
export const placeholderAgents = [
  { id: 'claude', name: 'Claude', vendor: 'Anthropic', status: 'offline' as const },
  { id: 'codex', name: 'Codex', vendor: 'OpenAI', status: 'offline' as const },
  { id: 'gemini', name: 'Gemini', vendor: 'Google', status: 'offline' as const },
];

export const initialNodes: WorkspaceNode[] = [
  {
    id: 'agent-orion',
    type: 'agent',
    position: { x: 20, y: 70 },
    data: {
      name: 'Orion',
      ens: 'codex.dev1.eth',
      address: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b9f3c',
      status: 'connected',
      log: [
        { block: '#18432901', hash: '0x9f2c41ab', message: 'claim tasks/AM-114' },
        { block: '#18432903', hash: '0x4de81c07', message: 'lock contracts/payment.sol' },
        { block: '#18432908', hash: '0xb7a0e93d', message: 'emit proposal -> mesh' },
      ],
    },
  },
  {
    id: 'agent-vega',
    type: 'agent',
    position: { x: 1080, y: 150 },
    data: {
      name: 'Vega',
      ens: 'claude.dev2.eth',
      address: '0x7c81de0a4b2f3915e6d7c8b9a0f1e2d3c4b5a6e7',
      status: 'idle',
      log: [
        { block: '#18432896', hash: '0x2e50f8a1', message: 'ack mesh handshake' },
        { block: '#18432899', hash: '0xc31b7d64', message: 'await task offer' },
      ],
    },
  },
  {
    id: 'task-board',
    type: 'taskBoard',
    position: { x: 470, y: 20 },
    data: {
      title: 'Shared Task Board',
      tasks: [
        {
          id: 'AM-114',
          title: 'Implement POST /payment handler',
          ref: '0x9f2c41ab',
          status: 'claimed',
          claimedBy: 'codex.dev1.eth',
        },
        {
          id: 'AM-115',
          title: 'Add idempotency keys to checkout',
          ref: '0x71ca08de',
          status: 'proposed',
        },
        {
          id: 'AM-116',
          title: 'Backfill settlement ledger indexes',
          ref: '0x3ab6f290',
          status: 'auto-assigned',
          claimedBy: 'claude.dev2.eth',
        },
        {
          id: 'AM-117',
          title: 'Draft refund reconciliation spec',
          ref: '0xd402e75b',
          status: 'proposed',
        },
      ],
    },
  },
];

/**
 * Shared edge presentation. Every edge is directional and carries an
 * arrowhead so the direction of a dependency is never ambiguous.
 */
export const edgeDefaults = {
  type: 'smoothstep' as const,
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#22d3ee' },
  style: { stroke: '#22d3ee', strokeWidth: 1.5 },
  labelShowBg: true,
  labelBgPadding: [6, 4] as [number, number],
  labelBgBorderRadius: 3,
  labelStyle: { fill: '#8b98ad', fontFamily: 'var(--am-font-mono)', fontSize: 10 },
  labelBgStyle: { fill: '#0d1117', stroke: '#232c40' },
};

export const initialEdges: Edge[] = [
  {
    ...edgeDefaults,
    id: 'e-orion-board',
    source: 'agent-orion',
    sourceHandle: 'out-right',
    target: 'task-board',
    targetHandle: 'in-left',
    label: 'claim: AM-114',
  },
  {
    ...edgeDefaults,
    id: 'e-board-vega',
    source: 'task-board',
    sourceHandle: 'out-right',
    target: 'agent-vega',
    targetHandle: 'in-left',
    label: 'dependency: POST /payment',
  },
];
