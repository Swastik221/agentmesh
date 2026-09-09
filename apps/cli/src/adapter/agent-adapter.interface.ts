export interface AgentIdentity {
  id: string;
  name: string;
  provider: string;
}

export interface AgentCapabilities {
  capabilities: string[];
}

export interface TaskExecutionContext {
  taskId: string;
  executionId?: string;
  title: string;
  description: string;
  requiredCapabilities?: string[];
  metadata?: Record<string, unknown>;
  worktreePath?: string;
  onProgress?: (progress: number, message?: string) => Promise<void> | void;
  publishArtifact?: (artifact: {
    type: string;
    name: string;
    payload: unknown;
    requiresReview?: boolean;
  }) => Promise<void> | void;
}

export interface AgentExecutionResult {
  summary?: string;
  output?: unknown;
  error?: string;
}

export interface AgentAdapter {
  getIdentity(): Promise<AgentIdentity>;
  getCapabilities(): Promise<AgentCapabilities>;
  executeTask(context: TaskExecutionContext): Promise<AgentExecutionResult>;
  cancelTask?(taskId: string): Promise<void>;
}

