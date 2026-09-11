import { apiClient } from '../../services/api-client';

/**
 * Live Agent adapter.
 *
 * Talks to the real backend agent routes (`/projects/:projectId/agents` and
 * `/agents/:agentId`, all behind `requireAuth`). Uses the shared `apiClient`
 * (cookie session, throws `ApiError` with the HTTP status on non-2xx). Errors
 * propagate; nothing is swallowed. `createAgent` never sends an `ownerId` or
 * ENS address/verification: the server derives the owner from the session and
 * independently resolves/verifies any ENS name.
 *
 * On failure `ApiError.message` is the server's human sentence (for a Zod
 * failure, the per-field text out of `details`); the machine code stays on
 * `ApiError.data.error` for callers that need to branch on it.
 *
 * Note: unlike `/projects` (which wraps the list in `{ projects }`),
 * `GET /projects/:id/agents` returns a bare array.
 */

/** The backend agent status enum (Prisma `AgentStatus`). */
export type LiveAgentStatus = 'OFFLINE' | 'ONLINE' | 'BUSY';

export interface LiveAgentCapability {
  id: string;
  agentId: string;
  capability: string;
}

export interface LiveAgent {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  provider: string;
  status: LiveAgentStatus;
  ensName: string | null;
  ensAddress: string | null;
  ensVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities?: LiveAgentCapability[];
}

/** Fields a client may set when registering an agent. Owner is server-side only. */
export interface CreateAgentInput {
  name: string;
  provider: string;
  /** Optional ENS name; the server resolves and verifies it against the session wallet. */
  ensName?: string | null;
}

export interface AgentIdentity {
  agentId: string;
  ensName: string | null;
  ensAddress: string | null;
  verified: boolean;
  verifiedAt: string | null;
}

export interface AgentAdapter {
  listAgents(projectId: string): Promise<LiveAgent[]>;
  getAgent(agentId: string): Promise<LiveAgent>;
  createAgent(projectId: string, input: CreateAgentInput): Promise<LiveAgent>;
  getAgentIdentity(agentId: string): Promise<AgentIdentity>;
}

export const liveAgentAdapter: AgentAdapter = {
  async listAgents(projectId: string): Promise<LiveAgent[]> {
    return apiClient.get<LiveAgent[]>(`/projects/${encodeURIComponent(projectId)}/agents`);
  },

  async getAgent(agentId: string): Promise<LiveAgent> {
    return apiClient.get<LiveAgent>(`/agents/${encodeURIComponent(agentId)}`);
  },

  async createAgent(projectId: string, input: CreateAgentInput): Promise<LiveAgent> {
    // Owner is derived from the session server-side; never send ownerId here.
    const body: CreateAgentInput = { name: input.name, provider: input.provider };
    if (input.ensName !== undefined) {
      body.ensName = input.ensName;
    }
    return apiClient.post<LiveAgent>(`/projects/${encodeURIComponent(projectId)}/agents`, body);
  },

  async getAgentIdentity(agentId: string): Promise<AgentIdentity> {
    return apiClient.get<AgentIdentity>(`/agents/${encodeURIComponent(agentId)}/identity`);
  },
};
