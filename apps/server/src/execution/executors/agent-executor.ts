export interface AgentExecutionRequest {
  executionId: string;
  taskId: string;
  agentId: string;
  input?: Record<string, unknown> | null;
}

export interface AgentExecutionResult {
  status: 'COMPLETED' | 'FAILED';
  output?: Record<string, unknown> | null;
  error?: string | null;
}

export interface AgentExecutor {
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
}
