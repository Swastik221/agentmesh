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

  // Handle process termination signals
  const cleanup = () => {
    console.log('\nDisconnecting AgentMesh Agent Connector...');
    client.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return client;
}
