import type { ApprovalRequest, Task, TaskProtocolAdapter } from '../types';

export const INITIAL_DEMO_TASKS: Task[] = [
  {
    id: 'AM-114',
    title: 'Build wallet identity panel',
    capability: 'frontend',
    status: 'proposed',
    suggestedAgent: 'orion',
    countdown: 24,
    reason: 'Orion matches frontend + identity capabilities.',
  },
  {
    id: 'AM-115',
    title: 'Build payment API',
    capability: 'backend',
    status: 'proposed',
    suggestedAgent: 'vega',
    countdown: 32,
    reason: 'Vega matches backend + API capabilities.',
  },
  {
    id: 'AM-116',
    title: 'Add approval modal',
    capability: 'security/web3',
    status: 'proposed',
    suggestedAgent: 'orion',
    countdown: 18,
    reason: 'Coordinator assigns available frontend/security agent.',
  },
  {
    id: 'AM-117',
    title: 'Publish ABI artifact',
    capability: 'protocol',
    status: 'auto-assigned',
    suggestedAgent: 'vega',
    claimedBy: 'vega',
    claimedByName: 'Vega',
    claimedByEns: 'claude.dev2.eth',
    reason: 'No claim within timer; auto-assigned by capability match.',
  },
];

export const INITIAL_DEMO_APPROVAL: ApprovalRequest = {
  id: 'APR-08',
  action: 'Deploy checkout contract',
  detail: 'Requested spend threshold: $0.001 USDC',
  spendThreshold: '$0.001 USDC',
  requestedBy: 'Orion / Codex',
  ownerEns: 'dev1.eth',
  status: 'pending',
};

export class DemoTaskProtocolAdapter implements TaskProtocolAdapter {
  private tasks: Task[] = INITIAL_DEMO_TASKS.map((t) => ({ ...t }));
  private approval: ApprovalRequest = { ...INITIAL_DEMO_APPROVAL };

  async getTasks(_workspaceId: string): Promise<Task[]> {
    return this.tasks.map((t) => ({ ...t }));
  }

  async submitPrd(_workspaceId: string, _prdText: string): Promise<Task[]> {
    this.tasks = [
      {
        id: 'AM-114',
        title: 'Build wallet identity panel',
        capability: 'frontend',
        status: 'proposed',
        suggestedAgent: 'orion',
        countdown: 24,
        reason: 'PRD item 1 assigned to frontend scope.',
      },
      {
        id: 'AM-115',
        title: 'Build payment API',
        capability: 'backend',
        status: 'proposed',
        suggestedAgent: 'vega',
        countdown: 32,
        reason: 'PRD item 2 assigned to backend scope.',
      },
      {
        id: 'AM-116',
        title: 'Add approval modal',
        capability: 'security/web3',
        status: 'proposed',
        suggestedAgent: 'orion',
        countdown: 18,
        reason: 'PRD item 3 assigned to security gate.',
      },
      {
        id: 'AM-117',
        title: 'Publish ABI artifact',
        capability: 'protocol',
        status: 'proposed',
        suggestedAgent: 'vega',
        countdown: 12,
        reason: 'PRD item 4 assigned to contract schema.',
      },
    ];
    return this.tasks.map((t) => ({ ...t }));
  }

  async claimTask(_workspaceId: string, taskId: string, agentId: string): Promise<Task> {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const isVega = agentId === 'vega';
    task.status = 'claimed';
    task.claimedBy = agentId;
    task.claimedByName = isVega ? 'Vega' : 'Orion';
    task.claimedByEns = isVega ? 'claude.dev2.eth' : 'codex.dev1.eth';
    task.countdown = undefined;
    task.reason = `Claimed by ${task.claimedByName} based on capability preference.`;
    return { ...task };
  }

  async autoAssignTask(_workspaceId: string, taskId: string, agentId: string): Promise<Task> {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const isVega = agentId === 'vega';
    task.status = 'auto-assigned';
    task.claimedBy = agentId;
    task.claimedByName = isVega ? 'Vega' : 'Orion';
    task.claimedByEns = isVega ? 'claude.dev2.eth' : 'codex.dev1.eth';
    task.countdown = undefined;
    task.reason = 'Countdown expired; auto-assigned by closest capability match.';
    return { ...task };
  }

  async requestApproval(_workspaceId: string, request: ApprovalRequest): Promise<ApprovalRequest> {
    this.approval = { ...request };
    return { ...this.approval };
  }

  async decideApproval(
    _workspaceId: string,
    approvalId: string,
    decision: 'approved' | 'rejected'
  ): Promise<ApprovalRequest> {
    if (this.approval.id === approvalId) {
      this.approval.status = decision;
    }
    return { ...this.approval };
  }
}
