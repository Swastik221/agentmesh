import { runConnect } from './connect.js';
import { runTerminal } from './terminal.js';
import { runContext } from './context.js';

export interface ParsedArgs {
  options: Record<string, string>;
  /** Everything after a bare `--`, untouched. */
  rest: string[];
}

export function parseArgs(args: string[]): ParsedArgs {
  const options: Record<string, string> = {};
  const separator = args.indexOf('--');
  const flags = separator === -1 ? args : args.slice(0, separator);
  const rest = separator === -1 ? [] : args.slice(separator + 1);

  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i];
    if (arg === '--workspace' || arg === '-w') {
      options.workspace = flags[++i];
    } else if (arg === '--agent' || arg === '-a') {
      options.agent = flags[++i];
    } else if (arg === '--session-id' || arg === '--token') {
      options.sessionId = flags[++i];
    } else if (arg === '--connect-token') {
      options.connectToken = flags[++i];
    } else if (arg === '--url' || arg === '-u') {
      options.url = flags[++i];
    } else if (arg === '--mock') {
      options.mock = 'true';
    } else if (arg === '--share') {
      options.share = 'true';
    } else if (arg === '--name') {
      options.name = flags[++i];
    } else if (arg === '--json') {
      options.json = 'true';
    } else if (arg === '--files') {
      options.files = flags[++i];
    } else if (arg === '--task') {
      options.taskId = flags[++i];
    } else if (arg === '--tail') {
      options.tail = flags[++i];
    }
  }
  return { options, rest };
}

const USAGE = `AgentMesh CLI v0.1.0

Usage:
  agentmesh connect  --workspace <id> --agent <id> --connect-token <token>
      Run this agent: it receives tasks assigned to it and runs them here.

  agentmesh terminal --workspace <id> --agent <id> --connect-token <token> [--share] [--name <n>] [-- <command...>]
      Run <command> (default: your shell) in this terminal and connect it to
      the workspace. Private unless --share. Read-only for everyone else.
      Example: agentmesh terminal -w <id> -a <id> --connect-token <t> --share -- claude

  agentmesh context  --workspace <id> --agent <id> --connect-token <token> [--files a,b] [--task <id>] [--json]
      Print what other agents are doing, where, and what overlaps your work.
      --tail <terminal-id> prints a shared terminal's recent output instead.

Options:
  -w, --workspace <id>     Project to join            (or AGENTMESH_WORKSPACE)
  -a, --agent <id>         Agent to act as            (or AGENTMESH_AGENT)
      --connect-token <t>  Token from the workspace UI (or AGENTMESH_CONNECT_TOKEN)
  -u, --url <url>          Server URL, default http://localhost:3001 (or AGENTMESH_URL)
      --mock               connect: use the canned mock adapter
`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { options, rest } = parseArgs(args);

  try {
    if (command === 'connect') {
      await runConnect({
        workspace: options.workspace,
        agent: options.agent,
        connectToken: options.connectToken,
        sessionId: options.sessionId,
        url: options.url,
        mock: options.mock === 'true',
      });
    } else if (command === 'terminal') {
      await runTerminal({ ...options, share: options.share === 'true', command: rest });
      process.exit(process.exitCode ?? 0);
    } else if (command === 'context') {
      await runContext({ ...options, json: options.json === 'true' });
      process.exit(0);
    } else {
      console.log(USAGE);
      process.exit(command && command !== 'help' && command !== '--help' ? 1 : 0);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

if (process.env.VITEST === undefined) {
  void main();
}
