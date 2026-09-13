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
    } else if (arg === '--connect-token') {
      result.connectToken = args[++i];
    } else if (arg === '--url' || arg === '-u') {
      result.url = args[++i];
    } else if (arg === '--mock') {
      result.mock = 'true';
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
        connectToken: options.connectToken,
        sessionId: options.sessionId,
        url: options.url,
        mock: options.mock === 'true',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  } else {
    console.log(`AgentMesh CLI v0.1.0

Usage:
  agentmesh connect --workspace <workspace-id> --agent <agent-id> --connect-token <token>

Options:
  -w, --workspace <id>     Project the agent joins
  -a, --agent <id>         Agent to connect as
      --connect-token <t>  Short-lived token from the workspace UI
                           (or set AGENTMESH_CONNECT_TOKEN)
  -u, --url <url>          Server URL (default http://localhost:3001)
      --mock               Use the canned mock adapter instead of doing real work
`);
    process.exit(command ? 1 : 0);
  }
}

main();
