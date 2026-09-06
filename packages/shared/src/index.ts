export interface HealthStatus {
  status: string;
  service: string;
  database: 'connected' | 'disconnected';
}

export const DEFAULT_SIWE_CHAIN_ID = 11155111;

export type ProjectRole = 'OWNER' | 'MEMBER';
export type AgentStatus = 'OFFLINE' | 'ONLINE' | 'BUSY';

export interface UserDTO {
  id: string;
  walletAddress: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDTO {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberDTO {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
  user?: UserDTO;
}

export interface AgentDTO {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  provider: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentDTO {
  ownerId: string;
  name: string;
  provider: string;
}

export interface UpdateAgentDTO {
  name?: string;
  provider?: string;
  status?: AgentStatus;
}

export interface AgentCapabilityDTO {
  id: string;
  agentId: string;
  capability: string;
  createdAt: string;
}

export interface AgentCapabilitiesResponseDTO {
  agentId: string;
  capabilities: string[];
}

export interface AddCapabilityDTO {
  capability: string;
}

export interface WebSocketMessage<T = unknown> {
  type: string;
  payload: T;
}

export interface WSErrorPayload {
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  details?: unknown[];
}

export type ProjectBrainEntryType = 'REQUIREMENT' | 'DECISION' | 'NOTE' | 'CONSTRAINT';

export interface ProjectBrainEntryDTO {
  id: string;
  projectId: string;
  authorId: string;
  type: ProjectBrainEntryType;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  author?: UserDTO;
}

export interface CreateProjectBrainEntryDTO {
  type: ProjectBrainEntryType;
  title: string;
  content: string;
  tags?: string[];
}

export interface UpdateProjectBrainEntryDTO {
  type?: ProjectBrainEntryType;
  title?: string;
  content?: string;
  tags?: string[];
}

export interface ProjectBrainListResponseDTO {
  entries: ProjectBrainEntryDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

