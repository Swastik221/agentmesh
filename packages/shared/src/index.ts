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
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  author?: UserDTO;
}

export interface CreateProjectBrainEntryDTO {
  type: ProjectBrainEntryType;
  title: string;
  content: string;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateProjectBrainEntryDTO {
  type?: ProjectBrainEntryType;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown> | null;
}

export interface ProjectBrainListResponseDTO {
  items: ProjectBrainEntryDTO[];
  page: number;
  limit: number;
  total: number;
}

export type TaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface TaskDTO {
  id: string;
  projectId: string;
  creatorId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  filePaths?: string[];
  createdAt: string;
  updatedAt: string;
  creator?: UserDTO;
  responsibilities?: TaskResponsibilityDTO[];
  dependencies?: TaskDependencyDTO[];
}

export interface TaskResponsibilityDTO {
  id: string;
  taskId: string;
  agentId: string;
  role: string | null;
  createdAt: string;
  agent?: AgentDTO;
}

export interface TaskDependencyDTO {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  createdAt: string;
}

export interface TaskListResponseDTO {
  items: TaskDTO[];
  page: number;
  limit: number;
  total: number;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  priority?: TaskPriority;
  filePaths?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  filePaths?: string[];
}

export interface ProjectWorkspaceDTO {
  id: string;
  projectId: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTaskStateDTO {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  responsibleAgentIds: string[];
  filePaths: string[];
}

export interface WorkspaceStateDTO {
  projectId: string;
  workspace: {
    id: string;
  };
  tasks: WorkspaceTaskStateDTO[];
}

export interface ExecutionContextDTO {
  projectId: string;
  workspaceId: string;
  rootPath: string;
  workingDirectory: string;
}


export interface AssignTaskResponsibilityInput {
  agentId: string;
  role?: string;
}

export interface CreateTaskDependencyInput {
  dependsOnTaskId: string;
}

export type ExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface TaskExecutionDTO {
  id: string;
  taskId: string;
  agentId: string;
  status: ExecutionStatus;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  agent?: AgentDTO;
  task?: TaskDTO;
}

export interface CreateTaskExecutionInput {
  agentId: string;
  input?: Record<string, unknown> | null;
}

export interface TaskExecutionListResponseDTO {
  items: TaskExecutionDTO[];
  page: number;
  limit: number;
  total: number;
}



