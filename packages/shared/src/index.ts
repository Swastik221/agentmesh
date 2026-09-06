export interface HealthStatus {
  status: string;
  service: string;
  database: 'connected' | 'disconnected';
}

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

export interface ApiErrorResponse {
  error: string;
  message: string;
  details?: unknown[];
}
