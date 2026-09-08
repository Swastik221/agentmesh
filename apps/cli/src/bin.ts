import { runConnect } from './connect.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--workspace' || arg === '-w') {
      result.workspace = args[++i];
    } else if (arg === '--agent' || arg === '-a') {
      result.agent = args[++i];
    } else if (arg === '--session-id' || arg === '--token') {
      result.sessionId = args[++i];
    } else if (arg === '--url' || arg === '-u') {
      result.url = args[++i];
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'connect') {
    const options = parseArgs(args.slice(1));
    try {
      await runConnect({
        workspace: options.workspace,
        agent: options.agent,
        sessionId: options.sessionId,
        url: options.url,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  } else {
    console.log(`AgentMesh CLI v0.1.0

Usage:
  agentmesh connect --workspace <workspace-id> [--agent <agent-id>] [--session-id <token>]
`);
    process.exit(command ? 1 : 0);
  }
}

main();
