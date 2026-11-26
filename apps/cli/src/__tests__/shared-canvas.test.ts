import { describe, it, expect } from 'vitest';
import type { WorkspaceContext } from '@agentmesh/agent-protocol';
import { parseArgs } from '../bin.js';
import { ptyCommand, displayCwd } from '../terminal.js';
import { formatContext } from '../context.js';
import { resolveCredentials } from '../credentials.js';

describe('agentmesh terminal / context CLI', () => {
  it('keeps everything after -- as the command, untouched', () => {
    const { options, rest } = parseArgs(['-w', 'p1', '-a', 'a1', '--share', '--', 'claude', '--model', 'x']);
    expect(options).toMatchObject({ workspace: 'p1', agent: 'a1', share: 'true' });
    expect(rest).toEqual(['claude', '--model', 'x']);
  });

  it('runs the command inside a pseudo-terminal using the platform script(1)', () => {
    expect(ptyCommand(['claude', '--x'], 'darwin')).toEqual({ file: 'script', args: ['-q', '/dev/null', 'claude', '--x'] });
    expect(ptyCommand(['echo', "it's"], 'linux')).toEqual({ file: 'script', args: ['-qfec', `'echo' 'it'\\''s'`, '/dev/null'] });
    expect(ptyCommand(['cmd'], 'win32')).toBeNull();
  });

  it('labels the working directory without the home path', () => {
    expect(displayCwd('/Users/dev/code/app', '/Users/dev')).toBe('~/code/app');
    expect(displayCwd('/Users/dev', '/Users/dev')).toBe('~');
    expect(displayCwd('/srv/app', '/Users/dev')).toBe('/srv/app');
  });

  it('requires a credential and says where to get one', () => {
    expect(() => resolveCredentials({ workspace: 'p', agent: 'a' })).toThrow(/Connect this agent/);
    expect(resolveCredentials({ workspace: 'p', agent: 'a', connectToken: 'amct_x' })).toMatchObject({ connectToken: 'amct_x' });
  });

  it('puts overlaps first so an agent sees them before anything else', () => {
    const ctx: WorkspaceContext = {
      generatedAt: new Date().toISOString(),
      project: { projectId: 'p', name: 'Checkout' },
      self: { agentId: 'a', name: 'Claude', capabilities: [] },
      agents: [
        {
          agentId: 'b',
          name: 'Codex',
          provider: 'codex',
          owner: { userId: 'u', displayName: 'Bob', ensName: 'bob.eth' },
          capabilities: ['frontend'],
          online: true,
          status: 'ONLINE',
          currentTasks: [{ taskId: 't', title: 'Login UI', status: 'IN_PROGRESS', filePaths: ['web/login.tsx'] }],
        },
      ],
      tasks: [],
      artifacts: [],
      worktrees: [],
      terminals: [],
      decisions: [],
      handoffs: [],
      pendingMessages: 0,
      overlaps: [
        { kind: 'FILE', taskId: 't', taskTitle: 'Login UI', agentId: 'b', agentName: 'Codex', filePaths: ['web/login.tsx'], explanation: 'Codex is working on "Login UI"' },
      ],
    };
    const text = formatContext(ctx);
    expect(text.indexOf('Check before you start')).toBeLessThan(text.indexOf('Other agents'));
    expect(text).toContain('Codex (codex, owned by bob.eth) [frontend]');
    expect(text).toContain('IN_PROGRESS');
    expect(text).toContain('web/login.tsx');
  });
});
