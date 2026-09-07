import {
  AgentExecutor,
  AgentExecutionRequest,
  AgentExecutionResult,
} from './agent-executor.js';

export class MockAgentExecutor implements AgentExecutor {
  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const input = request.input || {};

    const shouldFail =
      input.fail === true ||
      input.shouldFail === true ||
      (typeof input.instruction === 'string' && input.instruction.toLowerCase().includes('fail'));

    if (shouldFail) {
      return {
        status: 'FAILED',
        error: (input.errorMessage as string) || 'Mock execution failed',
        output: null,
      };
    }

    return {
      status: 'COMPLETED',
      output: {
        message: 'Mock execution completed successfully',
        executedBy: request.agentId,
        taskId: request.taskId,
        result: 'Success',
      },
      error: null,
    };
  }
}

export const mockAgentExecutor = new MockAgentExecutor();
