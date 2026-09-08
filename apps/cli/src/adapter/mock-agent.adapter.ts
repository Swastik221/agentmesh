import {
  AgentAdapter,
  AgentCapabilities,
  AgentExecutionResult,
  AgentIdentity,
  TaskExecutionContext,
} from './agent-adapter.interface.js';

export interface MockAgentAdapterOptions {
  agentId?: string;
  name?: string;
  capabilities?: string[];
}

export class MockAgentAdapter implements AgentAdapter {
  private agentId: string;
  private name: string;
  private capabilities: string[];

  constructor(
    optsOrAgentId?: string | MockAgentAdapterOptions,
    name = 'Mock Local Agent',
    capabilities = ['code-generation', 'testing', 'refactoring'],
  ) {
    if (typeof optsOrAgentId === 'object' && optsOrAgentId !== null) {
      this.agentId = optsOrAgentId.agentId || 'mock-agent-1';
      this.name = optsOrAgentId.name || name;
      this.capabilities = optsOrAgentId.capabilities || capabilities;
    } else {
      this.agentId = optsOrAgentId || 'mock-agent-1';
      this.name = name;
      this.capabilities = capabilities;
    }
  }

  async getIdentity(): Promise<AgentIdentity> {
    return {
      id: this.agentId,
      name: this.name,
      provider: 'mock-local-provider',
    };
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    return {
      capabilities: this.capabilities,
    };
  }

  async executeTask(context: TaskExecutionContext): Promise<AgentExecutionResult> {
    if (!context.taskId || !context.title) {
      throw new Error('Invalid task execution context: missing taskId or title');
    }

    return {
      summary: `Successfully executed local task '${context.title}'`,
      output: {
        executedBy: this.name,
        taskId: context.taskId,
        executionId: context.executionId,
        completedAt: new Date().toISOString(),
        resultStatus: 'SUCCESS',
      },
    };
  }

  async cancelTask(_taskId: string): Promise<void> {
    // Graceful cancellation handling
  }
}
