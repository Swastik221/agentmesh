/** Credentials and target shared by every CLI command. */
export interface CredentialOptions {
  workspace?: string;
  agent?: string;
  connectToken?: string;
  sessionId?: string;
  url?: string;
}

export interface ResolvedCredentials {
  workspaceId: string;
  agentId: string;
  connectToken?: string;
  sessionId?: string;
  serverUrl: string;
}

/** Reads flags, falling back to AGENTMESH_* environment variables. */
export function resolveCredentials(options: CredentialOptions): ResolvedCredentials {
  const workspaceId = (options.workspace || process.env.AGENTMESH_WORKSPACE || '').trim();
  const agentId = (options.agent || process.env.AGENTMESH_AGENT || '').trim();
  const connectToken = (options.connectToken || process.env.AGENTMESH_CONNECT_TOKEN || '').trim();
  const sessionId = (options.sessionId || process.env.AGENTMESH_SESSION_ID || '').trim();
  const serverUrl = (options.url || process.env.AGENTMESH_URL || 'http://localhost:3001').trim();

  if (!workspaceId) throw new Error('A workspace is required: --workspace <id> (or AGENTMESH_WORKSPACE).');
  if (!agentId) throw new Error('An agent is required: --agent <id> (or AGENTMESH_AGENT).');
  if (!connectToken && !sessionId) {
    throw new Error(
      'A connect token is required. In the workspace, open the agent and choose "Connect this agent" to get one, then pass --connect-token (or set AGENTMESH_CONNECT_TOKEN).',
    );
  }
  return {
    workspaceId,
    agentId,
    serverUrl,
    ...(connectToken ? { connectToken } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}
