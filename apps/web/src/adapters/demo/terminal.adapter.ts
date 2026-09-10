import type { TerminalAdapter, TerminalSession } from '../types';

export class DemoTerminalAdapter implements TerminalAdapter {
  private sessions: Map<string, TerminalSession> = new Map();

  async createSession(agentId: string): Promise<TerminalSession> {
    const sessionId = `term-${agentId}-${Date.now()}`;
    const ens = agentId === 'vega' ? 'claude.dev2.eth' : 'codex.dev1.eth';
    const initialSession: TerminalSession = {
      sessionId,
      agentId,
      history: [
        {
          id: 'init-1',
          kind: 'output',
          text: `AgentMesh CLI v1.0.0 · connected to checkout-demo`,
        },
        {
          id: 'init-2',
          kind: 'output',
          text: `Agent identity: ${ens} (${agentId}) · Type "help" or "agentmesh help"`,
        },
      ],
    };
    this.sessions.set(sessionId, initialSession);
    return initialSession;
  }

  async executeCommand(
    _sessionId: string,
    command: string,
    _context?: { workspaceId: string }
  ): Promise<{
    output: string[];
    action?: 'connect' | 'status' | 'tasks' | 'claim' | 'publish' | 'approval' | 'clear' | 'unknown';
    payload?: string;
  }> {
    const trimmed = command.trim();
    const parts = trimmed.split(/\s+/);
    const main = parts[0]?.toLowerCase();
    const sub = parts[1]?.toLowerCase();
    const arg = parts[2];

    if (!trimmed) {
      return { output: [] };
    }

    if (main === 'clear') {
      return { output: [], action: 'clear' };
    }

    if (main === 'help' || (main === 'agentmesh' && (!sub || sub === 'help'))) {
      return {
        output: [
          'Available AgentMesh CLI commands:',
          '  agentmesh connect            - Connect current AI agent to mesh',
          '  agentmesh status             - Show identity, wallet, and protocol sync',
          '  agentmesh tasks              - List shared task board & assigned owners',
          '  agentmesh claim <task-id>    - Claim a proposed task (e.g. claim AM-114)',
          '  agentmesh publish <file>     - Publish schema artifact (e.g. payment-api.json)',
          '  agentmesh approve <req-id>   - Sign & approve high-risk Web3 action (e.g. APR-08)',
          '  clear                        - Clear terminal buffer',
        ],
        action: 'unknown',
      };
    }

    if (main === 'agentmesh') {
      if (sub === 'connect') {
        return {
          output: [
            '✓ Local AI coding agent connected to Mesh Coordinator.',
            '✓ Protocol handshake accepted · Event: HELLO emitted.',
            '✓ Scoped capabilities announced to team.',
          ],
          action: 'connect',
        };
      }

      if (sub === 'status') {
        return {
          output: [
            'Workspace : Checkout protocol workspace (checkout-demo)',
            'Identity  : Anand · dev1.eth · 0x1a2b…9f3c',
            'Agent     : Orion / Codex (codex.dev1.eth)',
            'Auto-comm : ENABLED · Local-first broadcast channel active',
            'Peers     : Swastik (dev2.eth) with Vega / Claude',
          ],
          action: 'status',
        };
      }

      if (sub === 'tasks') {
        return {
          output: [
            'TASK BOARD (4 tasks):',
            '  AM-114 [frontend]    - Build wallet identity panel    (PROPOSED · 24s countdown)',
            '  AM-115 [backend]     - Build payment API              (PROPOSED · 32s countdown)',
            '  AM-116 [security]    - Add approval modal             (PROPOSED · 18s countdown)',
            '  AM-117 [protocol]    - Publish ABI artifact           (AUTO-ASSIGNED -> Vega)',
          ],
          action: 'tasks',
        };
      }

      if (sub === 'claim') {
        const taskId = (arg || 'AM-114').toUpperCase();
        return {
          output: [
            `✓ Claim request sent for ${taskId}`,
            `✓ Coordinator verified capability match for Orion / Codex`,
            `✓ Event emitted: TASK_CLAIMED (${taskId} claimed by codex.dev1.eth)`,
          ],
          action: 'claim',
          payload: taskId,
        };
      }

      if (sub === 'publish') {
        const file = arg || 'payment-api.json';
        return {
          output: [
            `✓ Published schema artifact: ${file}`,
            `✓ Schema hash: sha256:7fb2…91cd verified`,
            `✓ Broadcast to peers: Event ARTIFACT_PUBLISHED`,
          ],
          action: 'publish',
          payload: file,
        };
      }

      if (sub === 'approve') {
        const reqId = (arg || 'APR-08').toUpperCase();
        return {
          output: [
            `✓ Human approval requested for ${reqId} (Deploy checkout contract)`,
            `✓ Opening human confirmation modal · Wallet signature required`,
          ],
          action: 'approval',
          payload: reqId,
        };
      }
    }

    return {
      output: [`Command not found: "${trimmed}". Type "agentmesh help" for available commands.`],
      action: 'unknown',
    };
  }
}
