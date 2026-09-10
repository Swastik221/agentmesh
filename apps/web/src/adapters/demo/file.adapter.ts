import type { Artifact, FileAdapter, FileItem } from '../types';

export const DEMO_ARTIFACTS: Artifact[] = [
  {
    id: 'artifact-payment',
    name: 'payment-api.json',
    schema: 'payment-api/v1',
    hash: 'sha256:7fb2…91cd',
    publishedBy: 'Vega / Claude',
    usedBy: 'Orion / Codex',
    content: JSON.stringify(
      {
        openapi: '3.0.0',
        info: { title: 'Checkout Payment API', version: '1.0.0' },
        paths: {
          '/payment/intent': {
            post: {
              summary: 'Create checkout intent',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        amount: { type: 'string', example: '0.35' },
                        currency: { type: 'string', example: 'ETH' },
                        recipient: { type: 'string', example: '0x1a2b…9f3c' },
                      },
                      required: ['amount', 'currency', 'recipient'],
                    },
                  },
                },
              },
              responses: {
                '200': { description: 'Intent created with hash and signature schema.' },
              },
            },
          },
        },
      },
      null,
      2
    ),
  },
];

export const DEMO_FILES: FileItem[] = [
  {
    id: 'f-readme',
    path: 'README.md',
    name: 'README.md',
    type: 'file',
    content: `# AgentMesh Checkout Protocol

Multiplayer AI agent developer workspace for ETHGlobal.
- Identity: dev1.eth / dev2.eth
- Agents: Orion (Codex), Vega (Claude), Nova (Gemini)
- Shared Coordination Protocol v1.0
`,
  },
  {
    id: 'f-payment-api',
    path: 'payment-api.json',
    name: 'payment-api.json',
    type: 'file',
    content: DEMO_ARTIFACTS[0].content,
  },
  {
    id: 'd-contracts',
    path: 'contracts',
    name: 'contracts',
    type: 'directory',
    children: [
      {
        id: 'f-contract',
        path: 'contracts/CheckoutEscrow.sol',
        name: 'CheckoutEscrow.sol',
        type: 'file',
        content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CheckoutEscrow
 * @dev Human-gated escrow for AgentMesh payment protocol.
 */
contract CheckoutEscrow {
    address public immutable owner;
    uint256 public constant MAX_SPEND_THRESHOLD = 1000; // 0.001 USDC (1000 atomic units)

    event PaymentIntentCreated(bytes32 indexed intentId, address indexed payer, uint256 amount);
    event ApprovalRequired(bytes32 indexed actionId, uint256 amount);
    event ApprovalGranted(bytes32 indexed actionId, address indexed approver);

    constructor() {
        owner = msg.sender;
    }
}
`,
      },
    ],
  },
  {
    id: 'd-apps',
    path: 'apps',
    name: 'apps',
    type: 'directory',
    children: [
      {
        id: 'd-apps-web',
        path: 'apps/web',
        name: 'web',
        type: 'directory',
        children: [
          {
            id: 'f-web-src',
            path: 'apps/web/src/identity.ts',
            name: 'identity.ts',
            type: 'file',
            content: `export const resolveSession = async () => ({ ens: 'dev1.eth', address: '0x1a2b…9f3c' });`,
          },
        ],
      },
      {
        id: 'd-apps-server',
        path: 'apps/server',
        name: 'server',
        type: 'directory',
        children: [
          {
            id: 'f-server-index',
            path: 'apps/server/src/index.ts',
            name: 'index.ts',
            type: 'file',
            content: `// Fastify / WebSocket protocol coordinator router`,
          },
        ],
      },
    ],
  },
  {
    id: 'd-packages',
    path: 'packages',
    name: 'packages',
    type: 'directory',
    children: [
      {
        id: 'd-pkg-protocol',
        path: 'packages/agent-protocol',
        name: 'agent-protocol',
        type: 'directory',
        children: [
          {
            id: 'f-proto-types',
            path: 'packages/agent-protocol/types.ts',
            name: 'types.ts',
            type: 'file',
            content: `export type ProtocolVersion = '1.0';`,
          },
        ],
      },
      {
        id: 'd-pkg-shared',
        path: 'packages/shared',
        name: 'shared',
        type: 'directory',
      },
    ],
  },
];

export class DemoFileAdapter implements FileAdapter {
  private artifacts: Artifact[] = [...DEMO_ARTIFACTS];

  async getFiles(_workspaceId: string): Promise<FileItem[]> {
    return DEMO_FILES;
  }

  async readFile(_workspaceId: string, path: string): Promise<string> {
    const findInTree = (items: FileItem[]): string | null => {
      for (const item of items) {
        if (item.path === path && item.content) return item.content;
        if (item.children) {
          const found = findInTree(item.children);
          if (found) return found;
        }
      }
      return null;
    };
    return findInTree(DEMO_FILES) ?? `// File not found: ${path}`;
  }

  async getArtifacts(_workspaceId: string): Promise<Artifact[]> {
    return this.artifacts;
  }

  async publishArtifact(_workspaceId: string, artifact: Artifact): Promise<Artifact> {
    this.artifacts.push(artifact);
    return artifact;
  }
}
