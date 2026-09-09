import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, Server as HTTPServer } from 'node:http';
import WebSocket from 'ws';
import { createAgentMeshMessage, AgentMeshMessageType } from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/websocket.server.js';
import { executionService } from '../execution/execution.service.js';
import { ExecutionStatus } from '@prisma/client';

/**
 * Product-loop live status integration tests.
 *
 * The execution service is the middle of the product loop
 * (task -> claim -> execution -> live status). This suite pins the realtime
 * contract: when an execution moves, web clients receive TASK_STATUS frames
 * and a persisted activity event is recorded — not just a silent DB write.
 */
describe('PRD Execution -> Live Status vertical slice', () => {
  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  let userA: { id: string };
  let sessionA: { id: string };
  let projectA: { id: string };
  let agentA: { id: string };
  let taskA: { id: string };

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
  });

  afterAll(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    connectionManager.clear();

    await prisma.gitWorktree.deleteMany();
    await prisma.taskExecution.deleteMany();
    await prisma.taskResponsibility.deleteMany();
    await prisma.taskDependency.deleteMany();
    await prisma.artifact.deleteMany();
    await prisma.activityEvent.deleteMany();
    await prisma.task.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectBrainEntry.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.projectWorkspace.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();

    const uA = await prisma.user.create({
      data: {
        walletAddress: '0x1600000000000000000000000000000000000001',
        displayName: 'Live Status Owner',
      },
    });
    userA = { id: uA.id };
    sessionA = await sessionService.createSession(uA.id);

    const pA = await prisma.project.create({
      data: {
        name: 'Live Status Project',
        ownerId: uA.id,
        members: { create: { userId: uA.id, role: 'OWNER' } },
      },
    });
    projectA = { id: pA.id };

    const agA = await prisma.agent.create({
      data: {
        projectId: pA.id,
        ownerId: uA.id,
        name: 'Live Agent',
        provider: 'cli',
        status: 'ONLINE',
      },
    });
    agentA = { id: agA.id };

    const tA = await prisma.task.create({
      data: {
        projectId: pA.id,
        creatorId: uA.id,
        title: 'Live Status Task',
        description: 'Task exercised through the execution pipeline',
      },
    });
    taskA = { id: tA.id };

    await prisma.taskResponsibility.create({
      data: {
        taskId: tA.id,
        agentId: agA.id,
      },
    });
  });

  const connectWs = (projectId: string, sessionId?: string, isUser = false): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (sessionId) {
        headers['Cookie'] = `agentmesh_session=${sessionId}`;
      }
      let url = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectId}`;
      if (isUser) {
        url += `&clientType=user`;
      }
      const client = new WebSocket(url, { headers });
      (client as unknown as { _msgBuffer: unknown[] })._msgBuffer = [];
      client.on('message', (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString());
          (client as unknown as { _msgBuffer: unknown[] })._msgBuffer.push(parsed);
        } catch {
          // ignore non-json
        }
      });
      client.on('open', () => resolve(client));
      client.on('error', (err) => reject(err));
    });
  };

  function waitForMessage(
    ws: WebSocket,
    predicate: (msg: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    const buffer = (ws as unknown as { _msgBuffer: Record<string, unknown>[] })._msgBuffer || [];
    const existingIndex = buffer.findIndex(predicate);
    if (existingIndex !== -1) {
      const [found] = buffer.splice(existingIndex, 1);
      return Promise.resolve(found);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for message matching predicate (${timeoutMs}ms)`));
      }, timeoutMs);

      const messageHandler = (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
          if (predicate(parsed)) {
            cleanup();
            resolve(parsed);
          }
        } catch {
          // ignore non-json
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        ws.removeListener('message', messageHandler);
      };

      ws.on('message', messageHandler);
    });
  }

  const waitForTaskStatus = (ws: WebSocket, taskId: string, status: string) =>
    waitForMessage(
      ws,
      (m) =>
        m.type === AgentMeshMessageType.TASK_STATUS &&
        (m.payload as Record<string, unknown>)?.taskId === taskId &&
        (m.payload as Record<string, unknown>)?.status === status,
    );

  const waitForActivity = (ws: WebSocket, type: string) =>
    waitForMessage(
      ws,
      (m) =>
        m.type === AgentMeshMessageType.ACTIVITY_CREATED &&
        (m.payload as Record<string, unknown>)?.type === type,
    );

  it('1. Execution start broadcasts IN_PROGRESS live and records task.started activity', async () => {
    const wsAgent = await connectWs(projectA.id, sessionA.id, false);
    const wsUser = await connectWs(projectA.id, sessionA.id, true);
    await waitForMessage(wsUser, (m) => m.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);

    // Register the agent so the pipeline dispatches TASK_REQUEST (BYOA path)
    const handshakeMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_HANDSHAKE,
      projectId: projectA.id,
      senderId: agentA.id,
      payload: { agentId: agentA.id },
    });
    wsAgent.send(JSON.stringify(handshakeMsg));
    await waitForMessage(wsAgent, (m) => m.type === AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);

    // User client sees the running transition live
    const liveInProgress = waitForTaskStatus(wsUser, taskA.id, 'IN_PROGRESS');
    const liveActivity = waitForActivity(wsUser, 'task.started');

    const execution = await executionService.createExecution(
      projectA.id,
      taskA.id,
      userA.id,
      { agentId: agentA.id },
    );

    expect(execution.status).toBe(ExecutionStatus.QUEUED);

    const statusMsg = await liveInProgress;
    expect(statusMsg.type).toBe(AgentMeshMessageType.TASK_STATUS);

    await liveActivity;

    // Persisted state + activity
    const task = await prisma.task.findUnique({ where: { id: taskA.id } });
    expect(task?.status).toBe('IN_PROGRESS');

    const started = await prisma.activityEvent.findFirst({
      where: { projectId: projectA.id, type: 'task.started', taskId: taskA.id },
    });
    expect(started).not.toBeNull();
    expect(started?.actorType).toBe('agent');
    expect(started?.actorId).toBe(agentA.id);

    wsAgent.close();
    wsUser.close();
  });

  it('2. Connector TASK_COMPLETED transitions task live to COMPLETED with activity', async () => {
    const wsAgent = await connectWs(projectA.id, sessionA.id, false);
    const wsUser = await connectWs(projectA.id, sessionA.id, true);
    await waitForMessage(wsUser, (m) => m.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);

    const handshakeMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_HANDSHAKE,
      projectId: projectA.id,
      senderId: agentA.id,
      payload: { agentId: agentA.id },
    });
    wsAgent.send(JSON.stringify(handshakeMsg));
    await waitForMessage(wsAgent, (m) => m.type === AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);

    let executionId: string | null = null;
    const taskRequestReceived = new Promise<void>((resolve) => {
      wsAgent.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === AgentMeshMessageType.TASK_REQUEST) {
          const payload = msg.payload as { taskId: string; executionId: string };
          executionId = payload.executionId;
          resolve();
        }
      });
    });

    const execution = await executionService.createExecution(
      projectA.id,
      taskA.id,
      userA.id,
      { agentId: agentA.id },
    );
    await taskRequestReceived;

    // Agent accepts (may be idempotent if pipeline already moved to RUNNING) and completes
    wsAgent.send(
      JSON.stringify(
        createAgentMeshMessage({
          type: AgentMeshMessageType.TASK_ACCEPTED,
          projectId: projectA.id,
          senderId: agentA.id,
          recipientId: 'server',
          payload: { taskId: taskA.id, executionId: execution.id },
        }),
      ),
    );

    const liveCompleted = waitForTaskStatus(wsUser, taskA.id, 'COMPLETED');
    const liveActivity = waitForActivity(wsUser, 'task.completed');

    wsAgent.send(
      JSON.stringify(
        createAgentMeshMessage({
          type: AgentMeshMessageType.TASK_COMPLETED,
          projectId: projectA.id,
          senderId: agentA.id,
          recipientId: 'server',
          payload: {
            taskId: taskA.id,
            executionId,
            result: { summary: 'Done', output: { ok: true } },
          },
        }),
      ),
    );

    await liveCompleted;
    await liveActivity;

    const task = await prisma.task.findUnique({ where: { id: taskA.id } });
    expect(task?.status).toBe('COMPLETED');

    const completed = await prisma.activityEvent.findFirst({
      where: { projectId: projectA.id, type: 'task.completed', taskId: taskA.id },
    });
    expect(completed).not.toBeNull();

    wsAgent.close();
    wsUser.close();
  });

  it('3. Agent progress is streamed live without an error round-trip', async () => {
    const wsAgent = await connectWs(projectA.id, sessionA.id, false);
    const wsUser = await connectWs(projectA.id, sessionA.id, true);
    await waitForMessage(wsUser, (m) => m.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);

    const handshakeMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_HANDSHAKE,
      projectId: projectA.id,
      senderId: agentA.id,
      payload: { agentId: agentA.id },
    });
    wsAgent.send(JSON.stringify(handshakeMsg));
    await waitForMessage(wsAgent, (m) => m.type === AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);

    const liveProgress = waitForMessage(
      wsUser,
      (m) =>
        m.type === AgentMeshMessageType.TASK_STATUS &&
        (m.payload as Record<string, unknown>)?.taskId === taskA.id &&
        (m.payload as Record<string, unknown>)?.progress === 42,
    );

    wsAgent.send(
      JSON.stringify(
        createAgentMeshMessage({
          type: AgentMeshMessageType.TASK_PROGRESS,
          projectId: projectA.id,
          senderId: agentA.id,
          recipientId: 'server',
          payload: { taskId: taskA.id, progress: 42, message: 'writing tests' },
        }),
      ),
    );

    const progressMsg = await liveProgress;
    const payload = progressMsg.payload as Record<string, unknown>;
    expect(payload.message).toBe('writing tests');
    expect(payload.status).toBe('TODO');

    // No error frame should be sent back to the agent for progress
    const agentReceivedError = waitForMessage(
      wsAgent,
      (m) => m.type === AgentMeshMessageType.ERROR,
      1500,
    ).then(
      () => true,
      () => false,
    );
    expect(await agentReceivedError).toBe(false);

    wsAgent.close();
    wsUser.close();
  });
});