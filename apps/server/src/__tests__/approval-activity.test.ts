import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, Server as HTTPServer } from 'node:http';
import request from 'supertest';
import WebSocket from 'ws';
import {
  createAgentHandshake,
  createArtifactCreatedMessage,
  AgentMeshMessageType,
} from '@agentmesh/agent-protocol';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/websocket.server.js';

const app = createApp();

/**
 * PRD-17 Task Review / Approval + Activity Feed integration tests.
 *
 * Exercises the vertical slice: agent publishes reviewable artifact over WS
 * -> task enters PENDING_APPROVAL -> user reviews via REST -> terminal state
 * -> persisted activity feed -> live ACTIVITY_CREATED broadcasts.
 */
describe('PRD-17 Artifact Review, Approval & Activity Feed', () => {
  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  let userA: { id: string };
  let sessionA: { id: string };
  let sessionB: { id: string };
  let projectA: { id: string };
  let projectB: { id: string };
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
        walletAddress: '0x1400000000000000000000000000000000000001',
        displayName: 'Approval Owner',
      },
    });
    userA = { id: uA.id };
    sessionA = await sessionService.createSession(uA.id);

    const pA = await prisma.project.create({
      data: {
        name: 'Approval Project A',
        ownerId: uA.id,
        members: { create: { userId: uA.id, role: 'OWNER' } },
      },
    });
    projectA = { id: pA.id };

    const uB = await prisma.user.create({
      data: {
        walletAddress: '0x1400000000000000000000000000000000000002',
        displayName: 'Approval Outsider',
      },
    });
    void uB;
    sessionB = await sessionService.createSession(uB.id);

    const pB = await prisma.project.create({
      data: {
        name: 'Approval Project B',
        ownerId: uB.id,
        members: { create: { userId: uB.id, role: 'OWNER' } },
      },
    });
    projectB = { id: pB.id };

    const agA = await prisma.agent.create({
      data: {
        projectId: pA.id,
        ownerId: uA.id,
        name: 'Approval Agent',
        provider: 'custom',
        status: 'ONLINE',
      },
    });
    agentA = { id: agA.id };

    const tA = await prisma.task.create({
      data: {
        projectId: pA.id,
        creatorId: uA.id,
        title: 'Approval Task',
        description: 'Task awaiting human review',
      },
    });
    taskA = { id: tA.id };
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

  it('1. Agent publishes reviewable artifact over WS -> task PENDING_APPROVAL -> live visibility', async () => {
    const wsAgent = await connectWs(projectA.id, sessionA.id, false);
    const wsUser = await connectWs(projectA.id, sessionA.id, true);

    await waitForMessage(wsUser, (m) => m.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);

    // Handshake the agent
    const handshakeMsg = createAgentHandshake(
      { projectId: projectA.id, senderId: agentA.id },
      { agentId: agentA.id },
    );
    wsAgent.send(JSON.stringify(handshakeMsg));
    await waitForMessage(wsAgent, (m) => m.type === AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);

    // Task must be in a non-terminal state before agent publishes
    const before = await prisma.task.findUnique({ where: { id: taskA.id } });
    expect(before?.status).not.toBe('COMPLETED');

    // Agent publishes artifact -> server marks requiresReview + PENDING_APPROVAL
    const createArtifactMsg = createArtifactCreatedMessage(
      { projectId: projectA.id, senderId: agentA.id, taskId: taskA.id },
      {
        artifactId: 'temp-artifact-id',
        projectId: projectA.id,
        taskId: taskA.id,
        agentId: agentA.id,
        type: 'CODE',
        name: 'Implementation Patch',
        version: 1,
      },
    );
    (createArtifactMsg as unknown as { payload: Record<string, unknown> }).payload.payload = {
      files: ['src/index.ts'],
      summary: 'Implemented auth middleware',
    };

    // User client should observe the pending approval transition live
    const pendingPromise = waitForTaskStatus(wsUser, taskA.id, 'PENDING_APPROVAL');
    wsAgent.send(JSON.stringify(createArtifactMsg));

    const pendingMsg = await pendingPromise;
    expect(pendingMsg.type).toBe(AgentMeshMessageType.TASK_STATUS);

    // Artifact persisted with review gate enabled
    const artifacts = await prisma.artifact.findMany({ where: { taskId: taskA.id } });
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].requiresReview).toBe(true);
    expect(artifacts[0].status).toBe('PENDING');

    // Agent received the canonical artifact back
    await waitForMessage(wsAgent, (m) => m.type === AgentMeshMessageType.ARTIFACT_CREATED);

    // Live activity event for the pending-approval transition
    await waitForMessage(
      wsUser,
      (m) =>
        m.type === AgentMeshMessageType.ACTIVITY_CREATED &&
        (m.payload as Record<string, unknown>)?.type === 'task.pending_approval',
    );

    wsAgent.close();
    wsUser.close();
  });

  it('2. User approves artifact via REST -> artifact APPROVED + task COMPLETED + live + activity', async () => {
    // Prepare reviewable artifact directly (as the agent would via WS)
    const res = await request(app)
      .post(`/api/projects/${projectA.id}/tasks/${taskA.id}/artifacts`)
      .set('Authorization', `Bearer ${sessionA.id}`)
      .send({
        type: 'CODE',
        name: 'Patch for review',
        agentId: agentA.id,
        requiresReview: true,
        payload: { files: ['a.ts'] },
      });
    expect(res.status).toBe(201);
    const artifactId = res.body.id as string;

    const { taskService } = await import('../tasks/task.service.js');
    await taskService.markPendingApproval(projectA.id, taskA.id, agentA.id);

    const pending = await prisma.task.findUnique({ where: { id: taskA.id } });
    expect(pending?.status).toBe('PENDING_APPROVAL');

    const wsUser = await connectWs(projectA.id, sessionA.id, true);
    await waitForMessage(wsUser, (m) => m.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);

    const completedPromise = waitForTaskStatus(wsUser, taskA.id, 'COMPLETED');
    const activityPromise = waitForMessage(
      wsUser,
      (m) =>
        m.type === AgentMeshMessageType.ACTIVITY_CREATED &&
        (m.payload as Record<string, unknown>)?.type === 'artifact.approved',
    );

    // Approve through the real backend
    const reviewRes = await request(app)
      .post(`/api/projects/${projectA.id}/artifacts/${artifactId}/review`)
      .set('Authorization', `Bearer ${sessionA.id}`)
      .send({ approved: true, note: 'LGTM' });

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.artifact.status).toBe('APPROVED');
    expect(reviewRes.body.artifact.reviewedById).toBe(userA.id);
    expect(reviewRes.body.artifact.reviewNote).toBe('LGTM');
    expect(reviewRes.body.task.status).toBe('COMPLETED');

    // Live status + activity
    await completedPromise;
    const activityMsg = await activityPromise;
    const activityPayload = activityMsg.payload as Record<string, unknown>;
    expect(activityPayload.taskId).toBe(taskA.id);
    expect(activityPayload.message).toContain('approved');

    // Persisted activity
    const events = await prisma.activityEvent.findMany({
      where: { projectId: projectA.id },
      orderBy: { createdAt: 'asc' },
    });
    const types = events.map((e) => e.type);
    expect(types).toContain('artifact.created');
    expect(types).toContain('task.pending_approval');
    expect(types).toContain('artifact.approved');

    // Activity API
    const listRes = await request(app)
      .get(`/api/projects/${projectA.id}/activity`)
      .set('Authorization', `Bearer ${sessionA.id}`);
    expect(listRes.status).toBe(200);
    const apiTypes = listRes.body.events.map((e: { type: string }) => e.type);
    expect(apiTypes).toContain('artifact.approved');
    expect(apiTypes).toContain('task.pending_approval');

    wsUser.close();
  });

  it('3. User rejects artifact -> artifact REJECTED + task reopened to IN_PROGRESS', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectA.id}/tasks/${taskA.id}/artifacts`)
      .set('Authorization', `Bearer ${sessionA.id}`)
      .send({
        type: 'CODE',
        name: 'Flawed patch',
        agentId: agentA.id,
        requiresReview: true,
        payload: { files: ['bad.ts'] },
      });
    expect(res.status).toBe(201);
    const artifactId = res.body.id as string;

    const { taskService } = await import('../tasks/task.service.js');
    await taskService.markPendingApproval(projectA.id, taskA.id, agentA.id);

    const reviewRes = await request(app)
      .post(`/api/projects/${projectA.id}/artifacts/${artifactId}/review`)
      .set('Authorization', `Bearer ${sessionA.id}`)
      .send({ approved: false, note: 'Needs refactor' });

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.artifact.status).toBe('REJECTED');
    expect(reviewRes.body.task.status).toBe('IN_PROGRESS');

    const events = await prisma.activityEvent.findMany({
      where: { projectId: projectA.id, type: 'artifact.rejected' },
    });
    expect(events.length).toBe(1);
    expect(events[0].artifactId).toBe(artifactId);

    const denied = await request(app)
      .post(`/api/projects/${projectA.id}/artifacts/${artifactId}/review`)
      .set('Authorization', `Bearer ${sessionA.id}`)
      .send({ approved: true });
    expect(denied.status).toBe(400);
    expect(denied.body.error).toBe('BAD_REQUEST');
  });

  it('4. Review gate is enforced: non-reviewable artifacts and unauthorized users are rejected', async () => {
    // No requiresReview -> cannot review
    const ok = await request(app)
      .post(`/api/projects/${projectA.id}/tasks/${taskA.id}/artifacts`)
      .set('Authorization', `Bearer ${sessionA.id}`)
      .send({
        type: 'NOTE',
        name: 'Plain note',
        agentId: agentA.id,
        payload: { note: 'no gate' },
      });
    expect(ok.status).toBe(201);

    const denied = await request(app)
      .post(`/api/projects/${projectA.id}/artifacts/${ok.body.id}/review`)
      .set('Authorization', `Bearer ${sessionA.id}`)
      .send({ approved: true });
    expect(denied.status).toBe(400);

    // Reviewable artifact
    const gate = await request(app)
      .post(`/api/projects/${projectA.id}/tasks/${taskA.id}/artifacts`)
      .set('Authorization', `Bearer ${sessionA.id}`)
      .send({
        type: 'CODE',
        name: 'Gated patch',
        agentId: agentA.id,
        requiresReview: true,
        payload: { files: ['g.ts'] },
      });
    expect(gate.status).toBe(201);

    // Non-member of project A cannot review
    const outsider = await request(app)
      .post(`/api/projects/${projectA.id}/artifacts/${gate.body.id}/review`)
      .set('Authorization', `Bearer ${sessionB.id}`)
      .send({ approved: true });
    expect(outsider.status).toBe(403);

    // Artifact from another project cannot be reviewed through project A
    const otherProjectArtifact = await prisma.artifact.create({
      data: {
        projectId: projectB.id,
        taskId: taskA.id,
        agentId: agentA.id,
        ownerUserId: userA.id,
        type: 'CODE',
        name: 'Outsider artifact',
        version: 1,
        payload: { x: 1 },
        requiresReview: true,
      },
    });
    const crossProject = await request(app)
      .post(`/api/projects/${projectA.id}/artifacts/${otherProjectArtifact.id}/review`)
      .set('Authorization', `Bearer ${sessionA.id}`)
      .send({ approved: true });
    expect(crossProject.status).toBe(404);
  });

  it('5. Project list endpoint returns the authenticated user’s projects', async () => {
    const res = await request(app).get('/projects').set('Authorization', `Bearer ${sessionB.id}`);

    expect(res.status).toBe(200);
    const names = res.body.projects.map((p: { name: string }) => p.name);
    expect(names).toContain('Approval Project B');
    expect(names).not.toContain('Approval Project A');

    // Unauthenticated access denied
    const unauth = await request(app).get('/projects');
    expect(unauth.status).toBe(401);
  });

  it('6. markPendingApproval is a no-op for terminal or already-pending tasks', async () => {
    const { taskService } = await import('../tasks/task.service.js');

    await prisma.task.update({
      where: { id: taskA.id },
      data: { status: 'COMPLETED' },
    });
    const completed = await taskService.markPendingApproval(projectA.id, taskA.id, agentA.id);
    expect(completed).toBe('COMPLETED');

    await prisma.task.update({
      where: { id: taskA.id },
      data: { status: 'PENDING_APPROVAL' },
    });
    const pending = await taskService.markPendingApproval(projectA.id, taskA.id, agentA.id);
    expect(pending).toBe('PENDING_APPROVAL');

    // Activity events should not have been recorded for the no-op calls
    const types = await prisma.activityEvent.findMany({
      where: { projectId: projectA.id },
      select: { type: true },
    });
    expect(types.filter((t) => t.type === 'task.pending_approval')).toHaveLength(0);
  });
});