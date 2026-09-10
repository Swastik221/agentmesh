import { TerminalAdapter, TerminalSession } from '../types';

export class LiveTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveTerminalError';
  }
}

export const liveTerminalAdapter: TerminalAdapter = {
  async createSession(agentId: string): Promise<TerminalSession> {
    throw new LiveTerminalError(`Live interactive terminal session creation for agent ${agentId} is unsupported in Live Mode in INT-1.`);
  },

  async executeCommand(
    _sessionId: string,
    command: string,
    _context?: { workspaceId: string }
  ): Promise<{
    output: string[];
    action?: 'connect' | 'status' | 'tasks' | 'claim' | 'publish' | 'approval' | 'clear' | 'unknown';
    payload?: string;
  }> {
    throw new LiveTerminalError(`Live interactive terminal command execution ('${command}') is unsupported in Live Mode in INT-1.`);
  },
};
