import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server as HTTPServer } from 'node:http';
import WebSocket from 'ws';
import {
  createAgentMeshMessage,
  AgentMeshMessageType,
  AGENTMESH_PROTOCOL_VERSION,
  AgentMeshMessage,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/websocket.server.js';
import { executionService } from '../execution/execution.service.js';
import { connectorService } from '../connector/connector.service.js';
import { ExecutionStatus } from '@prisma/client';

describe('PRD #11 BYOA Real Agent Connector Integration Tests', () => {
  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  let userA: { id: string; walletAddress: string | null };
  let userB: { id: string; walletAddress: string | null };
  let sessionA: { id: string };

  let projectA: { id: string };
  let projectB: { id: string };

  let agentA1: { id: string };
  let agentB1: { id: string };

  beforeAll(async () => {
    server = createServer();
    wsServer = setupWebSocketServer(server, 100000);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port;
        }
        resolve();
      });
    });

    const walletA = '0x3333333333333333333333333333333333333333';
    const walletB = '0x4444444444444444444444444444444444444444';

    // Clean up previous test entities if any
    const existingUsers = await prisma.user.findMany({
      where: { walletAddress: { in: [walletA, walletB] } },
    });
    for (const u of existingUsers) {
      await prisma.taskExecution.deleteMany({ where: { agentId: { in: [u.id] } } }).catch(() => {});
      await prisma.taskResponsibility.deleteMany({}).catch(() => {});
      await prisma.task.deleteMany({ where: { projectId: { in: [u.id] } } }).catch(() => {});
      await prisma.agentCapability.deleteMany({ where: { agent: { ownerId: u.id } } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { ownerId: u.id } }).catch(() => {});
      await prisma.projectMember.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.project.deleteMany({ where: { ownerId: u.id } }).catch(() => {});
      await prisma.authSession.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    }

    userA = await prisma.user.create({
      data: { walletAddress: walletA, displayName: 'Connector User A' },
    });
    userB = await prisma.user.create({
      data: { walletAddress: walletB, displayName: 'Connector User B' },
    });

    sessionA = await sessionService.createSession(userA.id);
    await sessionService.createSession(userB.id);

    projectA = await prisma.project.create({
      data: { name: 'Connector Project A', ownerId: userA.id },
    });
    projectB = await prisma.project.create({
      data: { name: 'Connector Project B', ownerId: userB.id },
    });

    await prisma.projectMember.create({
      data: { projectId: projectA.id, userId: userA.id, role: 'OWNER' },
    });
    await prisma.projectMember.create({
      data: { projectId: projectB.id, userId: userB.id, role: 'OWNER' },
    });

    agentA1 = await prisma.agent.create({
      data: {
        name: 'Connector Agent A1',
        provider: 'claude',
        projectId: projectA.id,
        ownerId: userA.id,
        status: 'OFFLINE',
        capabilities: {
          create: [{ capability: 'typescript' }],
        },
      },
    });

    agentB1 = await prisma.agent.create({
      data: {
        name: 'Connector Agent B1',
        provider: 'codex',
        projectId: projectB.id,
        ownerId: userB.id,
        status: 'OFFLINE',
        capabilities: {
          create: [{ capability: 'python' }],
        },
      },
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      wsServer.close();
      server.close(() => resolve());
    });

    await prisma.taskExecution.deleteMany({
      where: { agentId: { in: [agentA1.id, agentB1.id] } },
    });
    await prisma.taskResponsibility.deleteMany({
      where: { agentId: { in: [agentA1.id, agentB1.id] } },
    });
    await prisma.task.deleteMany({
      where: { projectId: { in: [projectA.id, projectB.id] } },
    });
    await prisma.agentCapability.deleteMany({
      where: { agentId: { in: [agentA1.id, agentB1.id] } },
    });
    await prisma.agent.deleteMany({
      where: { id: { in: [agentA1.id, agentB1.id] } },
    });
    await prisma.projectMember.deleteMany({
      where: { projectId: { in: [projectA.id, projectB.id] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [projectA.id, projectB.id] } },
    });
    await prisma.authSession.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
  });

  function createClientSocket(projectId: string, token?: string): WebSocket {
    let url = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectId}`;
    if (token) {
      url += `&token=${token}`;
    }
    return new WebSocket(url);
  }

  async function performHandshake(
    ws: WebSocket,
    projectId: string,
    agentId: string,
  ): Promise<AgentMeshMessage> {
    return new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as AgentMeshMessage;
          if (
            msg.type === AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED ||
            msg.type === AgentMeshMessageType.AGENT_HANDSHAKE_REJECTED
          ) {
            resolve(msg);
          }
        } catch (err) {
          reject(err);
        }
      });

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId,
        senderId: agentId,
        payload: {
          agentId,
          clientVersion: AGENTMESH_PROTOCOL_VERSION,
          capabilities: ['typescript'],
        },
      });

      ws.send(JSON.stringify(handshakeMsg));
    });
  }

  it('AC-02 to AC-05: establishes authenticated connection and registers agent', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    const response = await performHandshake(ws, projectA.id, agentA1.id);
    expect(response.type).toBe(AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);
    expect(response.payload).toBeDefined();
    expect(connectorService.isAgentConnected(agentA1.id)).toBe(true);

    ws.close();
  });

  it('AC-03 & AC-04: rejects handshake for unauthorized project/agent combinations', async () => {
    // User A trying to register Agent B1 (which belongs to Project B) on Project A
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    const response = await performHandshake(ws, projectA.id, agentB1.id);
    expect(response.type).toBe(AgentMeshMessageType.AGENT_HANDSHAKE_REJECTED);
    expect((response.payload as { code: string }).code).toBe('AGENT_NOT_OWNED');

    ws.close();
  });

  it('AC-06 to AC-10: delivers assigned task over WebSocket and records completed result', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    const handshakeRes = await performHandshake(ws, projectA.id, agentA1.id);
    expect(handshakeRes.type).toBe(AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);

    // Create task in Project A
    const task = await prisma.task.create({
      data: {
        title: 'BYOA Connector Task',
        description: 'Test task delivery over connector',
        status: 'TODO',
        priority: 'MEDIUM',
        projectId: projectA.id,
        creatorId: userA.id,
      },
    });

    // Create task responsibility for Agent A1
    await prisma.taskResponsibility.create({
      data: {
        taskId: task.id,
        agentId: agentA1.id,
      },
    });

    // Listen for TASK_REQUEST on client socket
    let receivedTaskRequest: AgentMeshMessage | null = null;
    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString()) as AgentMeshMessage;
      if (msg.type === AgentMeshMessageType.TASK_REQUEST) {
        receivedTaskRequest = msg;
        const payload = msg.payload as { taskId: string; executionId: string };

        // Respond with TASK_ACCEPTED
        const acceptedMsg = createAgentMeshMessage({
          type: AgentMeshMessageType.TASK_ACCEPTED,
          projectId: projectA.id,
          senderId: agentA1.id,
          recipientId: 'server',
          payload: {
            taskId: payload.taskId,
            executionId: payload.executionId,
          },
        });
        ws.send(JSON.stringify(acceptedMsg));

        // Simulate local execution completion & respond with TASK_COMPLETED
        const completedMsg = createAgentMeshMessage({
          type: AgentMeshMessageType.TASK_COMPLETED,
          projectId: projectA.id,
          senderId: agentA1.id,
          recipientId: 'server',
          payload: {
            taskId: payload.taskId,
            executionId: payload.executionId,
            result: {
              summary: 'Task executed successfully by BYOA agent',
              output: { status: 'success', modifiedFiles: ['index.ts'] },
            },
          },
        });
        ws.send(JSON.stringify(completedMsg));
      }
    });

    // Trigger execution
    const execution = await executionService.createExecution(
      projectA.id,
      task.id,
      userA.id,
      { agentId: agentA1.id },
    );

    // Wait briefly for WS exchange to complete
    await new Promise((res) => setTimeout(res, 300));

    expect(receivedTaskRequest).not.toBeNull();
    const taskPayload = (receivedTaskRequest as unknown as AgentMeshMessage).payload as { taskId: string; executionId: string; title: string };
    expect(taskPayload.taskId).toBe(task.id);
    expect(taskPayload.executionId).toBe(execution.id);
    expect(taskPayload.title).toBe(task.title);

    // Verify bounded context (NO API keys or secrets in payload)
    expect(taskPayload).not.toHaveProperty('openaiKey');
    expect(taskPayload).not.toHaveProperty('anthropicKey');

    // Verify TaskExecution and Task state updated in DB
    const finalExec = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    expect(finalExec?.status).toBe(ExecutionStatus.COMPLETED);

    const finalTask = await prisma.task.findUnique({
      where: { id: task.id },
    });
    expect(finalTask?.status).toBe('COMPLETED');

    ws.close();
  });

  it('AC-12: duplicate completion messages are handled idempotently without corrupting state', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    await performHandshake(ws, projectA.id, agentA1.id);

    const task = await prisma.task.create({
      data: {
        title: 'Idempotency Test Task',
        description: 'Test duplicate completion payload handling',
        status: 'TODO',
        priority: 'LOW',
        projectId: projectA.id,
        creatorId: userA.id,
      },
    });

    const execution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        agentId: agentA1.id,
        status: ExecutionStatus.RUNNING,
      },
    });

    // Send TASK_COMPLETED message twice
    const completedMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_COMPLETED,
      projectId: projectA.id,
      senderId: agentA1.id,
      recipientId: 'server',
      payload: {
        taskId: task.id,
        executionId: execution.id,
        result: { summary: 'Completed once' },
      },
    });

    const process1 = await connectorService.processConnectorTaskMessage(
      {
        connectionId: 'conn-test-1',
        socket: ws as unknown as import('ws').WebSocket,
        projectId: projectA.id,
        connectedAt: new Date(),
        isAlive: true,
        lastHeartbeat: Date.now(),
        authenticated: true,
        userId: userA.id,
        agentId: agentA1.id,
      },
      completedMsg,
    );
    expect(process1.success).toBe(true);

    const process2 = await connectorService.processConnectorTaskMessage(
      {
        connectionId: 'conn-test-1',
        socket: ws as unknown as import('ws').WebSocket,
        projectId: projectA.id,
        connectedAt: new Date(),
        isAlive: true,
        lastHeartbeat: Date.now(),
        authenticated: true,
        userId: userA.id,
        agentId: agentA1.id,
      },
      completedMsg,
    );
    expect(process2.success).toBe(true);

    const finalExec = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    expect(finalExec?.status).toBe(ExecutionStatus.COMPLETED);

    ws.close();
  });

  it('AC-31: delivers TASK_STATUS cancelled to connected client when execution is cancelled server-side', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    await performHandshake(ws, projectA.id, agentA1.id);

    const task = await prisma.task.create({
      data: {
        title: 'Cancellation Test Task',
        description: 'Test server cancellation notification',
        status: 'TODO',
        priority: 'HIGH',
        projectId: projectA.id,
        creatorId: userA.id,
      },
    });

    const execution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        agentId: agentA1.id,
        status: ExecutionStatus.RUNNING,
      },
    });

    let receivedCancelMsg: AgentMeshMessage | null = null;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as AgentMeshMessage;
      if (
        msg.type === AgentMeshMessageType.TASK_STATUS &&
        (msg.payload as { status?: string }).status === 'CANCELLED'
      ) {
        receivedCancelMsg = msg;
      }
    });

    await executionService.cancelExecution(projectA.id, task.id, execution.id, userA.id);

    await new Promise((res) => setTimeout(res, 150));

    expect(receivedCancelMsg).not.toBeNull();
    const cancelPayload = (receivedCancelMsg as unknown as AgentMeshMessage).payload as { taskId: string };
    expect(cancelPayload.taskId).toBe(task.id);

    const finalExec = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    expect(finalExec?.status).toBe(ExecutionStatus.CANCELLED);

    ws.close();
  });

  it('rejects unknown connector message types', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    await performHandshake(ws, projectA.id, agentA1.id);

    const unknownMsg = {
      id: 'msg-unknown-1',
      protocolVersion: AGENTMESH_PROTOCOL_VERSION,
      type: 'unknown.type',
      projectId: projectA.id,
      senderId: agentA1.id,
      recipientId: 'server',
      timestamp: new Date().toISOString(),
      payload: {},
    } as unknown as AgentMeshMessage;

    const result = await connectorService.processConnectorTaskMessage(
      {
        connectionId: 'conn-unknown',
        socket: ws as unknown as import('ws').WebSocket,
        projectId: projectA.id,
        connectedAt: new Date(),
        isAlive: true,
        lastHeartbeat: Date.now(),
        authenticated: true,
        userId: userA.id,
        agentId: agentA1.id,
      },
      unknownMsg,
    );

    expect(result.success).toBe(false);
    expect((result.error?.payload as { code: string }).code).toBe('INVALID_MESSAGE');

    ws.close();
  });

  it('handles TASK_FAILED message and updates execution state to FAILED', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    await performHandshake(ws, projectA.id, agentA1.id);

    const task = await prisma.task.create({
      data: {
        title: 'Task Failed Test',
        description: 'Test failure reporting',
        status: 'TODO',
        priority: 'MEDIUM',
        projectId: projectA.id,
        creatorId: userA.id,
      },
    });

    const execution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        agentId: agentA1.id,
        status: ExecutionStatus.RUNNING,
      },
    });

    const failedMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_FAILED,
      projectId: projectA.id,
      senderId: agentA1.id,
      recipientId: 'server',
      payload: {
        taskId: task.id,
        executionId: execution.id,
        error: 'Execution failed due to syntax error',
      },
    });

    const result = await connectorService.processConnectorTaskMessage(
      {
        connectionId: 'conn-fail-1',
        socket: ws as unknown as import('ws').WebSocket,
        projectId: projectA.id,
        connectedAt: new Date(),
        isAlive: true,
        lastHeartbeat: Date.now(),
        authenticated: true,
        userId: userA.id,
        agentId: agentA1.id,
      },
      failedMsg,
    );

    expect(result.success).toBe(true);

    const finalExec = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    expect(finalExec?.status).toBe(ExecutionStatus.FAILED);
    expect(finalExec?.error).toBe('Execution failed due to syntax error');

    ws.close();
  });

  it('prevents stale completion message from overwriting cancelled execution', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    await performHandshake(ws, projectA.id, agentA1.id);

    const task = await prisma.task.create({
      data: {
        title: 'Stale Completion Test',
        description: 'Test stale completion after cancellation',
        status: 'TODO',
        priority: 'HIGH',
        projectId: projectA.id,
        creatorId: userA.id,
      },
    });

    const execution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        agentId: agentA1.id,
        status: ExecutionStatus.CANCELLED,
        completedAt: new Date(),
      },
    });

    const staleCompletedMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_COMPLETED,
      projectId: projectA.id,
      senderId: agentA1.id,
      recipientId: 'server',
      payload: {
        taskId: task.id,
        executionId: execution.id,
        result: { summary: 'Stale completion' },
      },
    });

    const result = await connectorService.processConnectorTaskMessage(
      {
        connectionId: 'conn-stale-1',
        socket: ws as unknown as import('ws').WebSocket,
        projectId: projectA.id,
        connectedAt: new Date(),
        isAlive: true,
        lastHeartbeat: Date.now(),
        authenticated: true,
        userId: userA.id,
        agentId: agentA1.id,
      },
      staleCompletedMsg,
    );

    expect(result.success).toBe(true);

    const finalExec = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });
    expect(finalExec?.status).toBe(ExecutionStatus.CANCELLED);

    ws.close();
  });

  it('rejects connector message with mismatched projectId', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    await performHandshake(ws, projectA.id, agentA1.id);

    const mismatchedMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_ACCEPTED,
      projectId: projectB.id,
      senderId: agentA1.id,
      recipientId: 'server',
      payload: {
        taskId: 'task-123',
      },
    });

    const result = await connectorService.processConnectorTaskMessage(
      {
        connectionId: 'conn-cross-1',
        socket: ws as unknown as import('ws').WebSocket,
        projectId: projectA.id,
        connectedAt: new Date(),
        isAlive: true,
        lastHeartbeat: Date.now(),
        authenticated: true,
        userId: userA.id,
        agentId: agentA1.id,
      },
      mismatchedMsg,
    );

    expect(result.success).toBe(false);
    expect((result.error?.payload as { code: string }).code).toBe('AUTHORIZATION_FAILED');

    ws.close();
  });

  it('returns false when trying to dispatch unassigned or non-existent task', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    await performHandshake(ws, projectA.id, agentA1.id);

    const dispatched = await connectorService.dispatchTaskToAgent(
      projectA.id,
      'non-existent-task-id',
      'non-existent-execution-id',
      agentA1.id,
    );

    expect(dispatched).toBe(false);

    ws.close();
  });

  it('handles disconnect during active execution leaving state recoverable', async () => {
    const ws = createClientSocket(projectA.id, sessionA.id);
    await new Promise((res) => ws.on('open', res));

    await performHandshake(ws, projectA.id, agentA1.id);

    const task = await prisma.task.create({
      data: {
        title: 'Disconnect Execution Test',
        description: 'Test socket drop during active execution',
        status: 'TODO',
        priority: 'MEDIUM',
        projectId: projectA.id,
        creatorId: userA.id,
      },
    });

    const execution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        agentId: agentA1.id,
        status: ExecutionStatus.RUNNING,
      },
    });

    ws.close();

    await new Promise((res) => setTimeout(res, 100));

    const currentExec = await prisma.taskExecution.findUnique({
      where: { id: execution.id },
    });

    expect(currentExec?.status).toBe(ExecutionStatus.RUNNING);
  });
});
