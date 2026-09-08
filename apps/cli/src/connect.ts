import { AgentMeshClient } from './client.js';
import { MockAgentAdapter } from './adapter/mock-agent.adapter.js';

export interface ConnectOptions {
  workspace: string;
  agent?: string;
  sessionId?: string;
  token?: string;
  url?: string;
}

export async function runConnect(options: ConnectOptions): Promise<AgentMeshClient> {
  const workspaceId = options.workspace?.trim();
  if (!workspaceId) {
    throw new Error("Workspace ID is required. Usage: npx agentmesh connect --workspace <workspace-id>");
  }

  const agentId = options.agent?.trim() || 'mock-agent-1';
  const sessionId = (options.sessionId || options.token || process.env.AGENTMESH_SESSION_ID || process.env.AGENTMESH_TOKEN || '').trim();

  if (!sessionId) {
    throw new Error('Authentication session token is required. Set AGENTMESH_SESSION_ID environment variable or pass --session-id.');
  }

  const serverUrl = (options.url || process.env.AGENTMESH_URL || 'http://localhost:3000').trim();

  const adapter = new MockAgentAdapter(agentId, 'BYOA Local Agent');

  const client = new AgentMeshClient({
    serverUrl,
    workspaceId,
    agentId,
    sessionId,
    adapter,
  });

  console.log(`AgentMesh Connector connecting to workspace '${workspaceId}' as agent '${agentId}'...`);
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
