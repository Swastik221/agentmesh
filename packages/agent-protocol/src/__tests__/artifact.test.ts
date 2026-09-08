import { describe, it, expect } from 'vitest';
import {
  createArtifactCreatedMessage,
  createArtifactAvailableMessage,
  createDependencyDeclaredMessage,
  createDependencyAvailableMessage,
  agentMeshMessageSchema,
  AgentMeshMessageType,
  PROTOCOL_VERSION,
} from '../index.js';

describe('PRD-15 Canonical Agent Protocol — Artifact & Dependency Messages', () => {
  it('should build and validate artifact.created message', () => {
    const msg = createArtifactCreatedMessage(
      {
        projectId: 'project_1',
        senderId: 'agent_1',
        taskId: 'task_1',
      },
      {
        artifactId: 'art_1',
        projectId: 'project_1',
        taskId: 'task_1',
        executionId: 'exec_1',
        agentId: 'agent_1',
        type: 'API_CONTRACT',
        name: 'Auth Spec',
        version: 1,
      },
    );

    expect(msg.type).toBe(AgentMeshMessageType.ARTIFACT_CREATED);
    expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(msg.payload.version).toBe(1);

    const parseResult = agentMeshMessageSchema.safeParse(msg);
    expect(parseResult.success).toBe(true);
  });

  it('should build and validate artifact.available message', () => {
    const msg = createArtifactAvailableMessage(
      {
        projectId: 'project_1',
        senderId: 'server',
        taskId: 'task_1',
      },
      {
        artifactId: 'art_1',
        projectId: 'project_1',
        taskId: 'task_1',
        consumerTaskId: 'task_2',
      },
    );

    expect(msg.type).toBe(AgentMeshMessageType.ARTIFACT_AVAILABLE);
    const parseResult = agentMeshMessageSchema.safeParse(msg);
    expect(parseResult.success).toBe(true);
  });

  it('should build and validate dependency.declared message', () => {
    const msg = createDependencyDeclaredMessage(
      {
        projectId: 'project_1',
        senderId: 'user_1',
        taskId: 'task_2',
      },
      {
        dependencyId: 'dep_1',
        projectId: 'project_1',
        taskId: 'task_2',
        dependencyType: 'ARTIFACT_REQUIRED',
        artifactId: 'art_1',
      },
    );

    expect(msg.type).toBe(AgentMeshMessageType.DEPENDENCY_DECLARED);
    const parseResult = agentMeshMessageSchema.safeParse(msg);
    expect(parseResult.success).toBe(true);
  });

  it('should build and validate dependency.available message', () => {
    const msg = createDependencyAvailableMessage(
      {
        projectId: 'project_1',
        senderId: 'server',
        taskId: 'task_2',
      },
      {
        dependencyId: 'dep_1',
        projectId: 'project_1',
        taskId: 'task_2',
        artifactId: 'art_1',
        available: true,
      },
    );

    expect(msg.type).toBe(AgentMeshMessageType.DEPENDENCY_AVAILABLE);
    const parseResult = agentMeshMessageSchema.safeParse(msg);
    expect(parseResult.success).toBe(true);
  });

  it('should reject invalid protocol version or malformed payload', () => {
    const invalidMsg = {
      id: 'msg_1',
      protocolVersion: '0.1', // invalid
      type: AgentMeshMessageType.ARTIFACT_CREATED,
      projectId: 'project_1',
      senderId: 'agent_1',
      timestamp: new Date().toISOString(),
      payload: {
        artifactId: 'art_1',
        projectId: 'project_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        type: 'API_CONTRACT',
        name: 'Auth Spec',
        version: -1, // invalid negative version
      },
    };

    const parseResult = agentMeshMessageSchema.safeParse(invalidMsg);
    expect(parseResult.success).toBe(false);
  });
});
