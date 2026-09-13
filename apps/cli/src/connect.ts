import readline from 'node:readline';
import { AgentMeshClient } from './client.js';
import { MockAgentAdapter } from './adapter/mock-agent.adapter.js';
import { RealAgentAdapter } from './adapter/real-agent.adapter.js';

export interface ConnectOptions {
  workspace: string;
  agent?: string;
  /** Short-lived, agent-scoped credential minted from the workspace UI. */
  connectToken?: string;
  sessionId?: string;
  token?: string;
  url?: string;
  /** Opt in to the canned mock adapter instead of doing real work. */
  mock?: boolean;
}

export async function runConnect(options: ConnectOptions): Promise<AgentMeshClient> {
  const workspaceId = options.workspace?.trim();
  if (!workspaceId) {
    throw new Error(
      'Workspace ID is required. Usage: npx agentmesh connect --workspace <workspace-id> --agent <agent-id> --connect-token <token>',
    );
  }

  const agentId = options.agent?.trim() || 'mock-agent-1';

  const connectToken = (
    options.connectToken ||
    process.env.AGENTMESH_CONNECT_TOKEN ||
    ''
  ).trim();
  const sessionId = (
    options.sessionId ||
    options.token ||
    process.env.AGENTMESH_SESSION_ID ||
    process.env.AGENTMESH_TOKEN ||
    ''
  ).trim();

  if (!connectToken && !sessionId) {
    throw new Error(
      'A connect token is required. Open the agent in the AgentMesh workspace, choose "Connect this agent", and paste the command it shows. You can also set AGENTMESH_CONNECT_TOKEN.',
    );
  }

  const serverUrl = (options.url || process.env.AGENTMESH_URL || 'http://localhost:3001').trim();

  // Real work is the default: a connected agent that quietly returns canned
  // output would be indistinguishable from a working one, which is exactly the
  // failure this flow is meant to remove. The mock stays available behind
  // --mock for tests and offline demos.
  //
  // Neither adapter declares capabilities. The server rejects a handshake that
  // claims a capability the agent is not registered for, and rightly so: what
  // an agent may be assigned is the operator's decision, made in the workspace,
  // not something a local process gets to assert about itself. Declaring none
  // means the server's registered set is authoritative, and it returns that set
  // in the handshake acceptance.
  const adapter = options.mock
    ? new MockAgentAdapter({ agentId, name: 'BYOA Local Agent', capabilities: [] })
    : new RealAgentAdapter({ agentId, name: 'BYOA Local Agent', capabilities: [] });

  const client = new AgentMeshClient({
    serverUrl,
    workspaceId,
    agentId,
    ...(connectToken ? { connectToken } : {}),
    ...(sessionId ? { sessionId } : {}),
    adapter,
  });

  console.log(
    `AgentMesh Connector connecting to workspace '${workspaceId}' as agent '${agentId}'${options.mock ? ' (mock adapter)' : ''}...`,
  );
  await client.connect();
  console.log(`Authenticated & registered successfully as agent '${agentId}'. Waiting for tasks...`);
  console.log(`Type a prompt and press Enter: it becomes a real task, assigned to this agent, and runs immediately.`);
  console.log(`  /who              list the other agents on this workspace`);
  console.log(`  @<agent> <text>   send that agent a direct message`);
  console.log(`Ctrl+C to disconnect.\n`);

  // Interactive terminal, the same shape as running `claude` in a terminal:
  // anything typed here is posted to the real server over the already-open
  // WebSocket (AgentMeshClient.sendPrompt), which shows it live on this
  // agent's card in the workspace canvas for every connected viewer AND
  // creates a real Task assigned to this agent, dispatched straight back to
  // this same process for real execution. Progress, artifacts, and
  // completion print below as they actually happen.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'agentmesh> ',
  });
  rl.prompt();
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // /who: who else is connected to this workspace right now.
    if (trimmed === '/who') {
      const roster = client.getRoster();
      if (roster.length === 0) {
        console.log('\n[team] No other agents are registered on this workspace yet.\n');
      } else {
        console.log('\n[team] Other agents on this workspace:');
        for (const a of roster) {
          console.log(`  ${a.online ? '●' : '○'} ${a.name}${a.online ? '' : ' (offline)'}`);
        }
        console.log('');
      }
      rl.prompt();
      return;
    }

    // @agent message: a direct message to a teammate agent, delivered over the
    // protocol's existing agent-to-agent messaging path.
    if (trimmed.startsWith('@')) {
      const space = trimmed.indexOf(' ');
      const target = space === -1 ? trimmed.slice(1) : trimmed.slice(1, space);
      const body = space === -1 ? '' : trimmed.slice(space + 1).trim();

      if (!body) {
        console.log('\n[usage] @<agent> <message>\n');
      } else if (!client.sendDirectMessage(target, body)) {
        console.log(`\n[team] No agent named '${target}' on this workspace. Try /who.\n`);
      } else {
        console.log(`[dm to ${target}] ${body}`);
      }
      rl.prompt();
      return;
    }

    client.sendPrompt(trimmed);
    rl.prompt();
  });

  // Handle process termination signals
  const cleanup = () => {
    console.log('\nDisconnecting AgentMesh Agent Connector...');
    rl.close();
    client.disconnect();
    process.exit(0);
  };

  rl.on('close', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return client;
}
