/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, Server as HTTPServer } from 'node:http';
import WebSocket from 'ws';
import {
  createAgentHandshake,
  createArtifactCreatedMessage,
  AgentMeshMessageType,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/websocket.server.js';

describe('PRD-15 Realtime WebSocket & BYOA Artifact Integration Tests', () => {
  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  let userA: { id: string };
  let sessionA: { id: string };
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
      data: { walletAddress: '0x1500000000000000000000000000000000000001', displayName: 'User Realtime' },
    });
    userA = { id: uA.id };
    sessionA = await sessionService.createSession(uA.id);

    const pA = await prisma.project.create({
      data: {
        name: 'Project Realtime A',
        ownerId: uA.id,
        members: { create: { userId: uA.id, role: 'OWNER' } },
      },
    });
    projectA = { id: pA.id };

    const pB = await prisma.project.create({
      data: {
        name: 'Project Realtime B',
        ownerId: uA.id,
        members: { create: { userId: uA.id, role: 'OWNER' } },
      },
    });
    projectB = { id: pB.id };

    const agA = await prisma.agent.create({
      data: {
        projectId: pA.id,
        ownerId: uA.id,
        name: 'Realtime Agent',
        provider: 'custom',
        status: 'ONLINE',
      },
    });
    agentA = { id: agA.id };

    const tA = await prisma.task.create({
      data: { projectId: pA.id, creatorId: uA.id, title: 'Realtime Task', description: 'Task for artifact' },
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
      client.on('open', () => resolve(client));
      client.on('error', (err) => reject(err));
    });
  };

  function waitForMessage(
    ws: WebSocket,
    predicate: (msg: any) => boolean,
    timeoutMs = 5000,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for message matching predicate (${timeoutMs}ms)`));
      }, timeoutMs);

      const messageHandler = (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString());
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

  it('1. Connected BYOA agent can publish artifact over WebSocket and receive broadcast', async () => {
    const wsAgent = await connectWs(projectA.id, sessionA.id, false);
    const wsUser = await connectWs(projectA.id, sessionA.id, true);

    // Wait for user snapshot
    await waitForMessage(wsUser, (m) => m.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);

    // Handshake BYOA agent
    const handshakeMsg = createAgentHandshake(
      { projectId: projectA.id, senderId: agentA.id },
      { agentId: agentA.id },
    );
    wsAgent.send(JSON.stringify(handshakeMsg));
    await waitForMessage(wsAgent, (m) => m.type === AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);

    // Connected BYOA agent sends artifact.created
    const createArtifactMsg = createArtifactCreatedMessage(
      { projectId: projectA.id, senderId: agentA.id, taskId: taskA.id },
      {
        artifactId: 'art_temp',
        projectId: projectA.id,
        taskId: taskA.id,
        agentId: agentA.id,
        type: 'SCHEMA',
        name: 'WebSocket Created Schema',
        version: 1,
      },
    );
    (createArtifactMsg as any).payload.payload = { tables: ['users', 'tasks'] };

    // Promise for user connection receiving broadcast
    const userBroadcastPromise = waitForMessage(
      wsUser,
      (m) => m.type === AgentMeshMessageType.ARTIFACT_CREATED && m.payload?.name === 'WebSocket Created Schema',
    );

    wsAgent.send(JSON.stringify(createArtifactMsg));

    const broadcastMsg = await userBroadcastPromise;
    expect(broadcastMsg.payload.artifactId).toBeDefined();
    expect(broadcastMsg.payload.type).toBe('SCHEMA');
    expect(broadcastMsg.payload.version).toBe(1);

    // Verify persisted in database
    const dbArtifact = await prisma.artifact.findFirst({
      where: { taskId: taskA.id, name: 'WebSocket Created Schema' },
    });
    expect(dbArtifact).not.toBeNull();
    expect(dbArtifact?.agentId).toBe(agentA.id);

    wsAgent.close();
    wsUser.close();
  });

  it('2. Cross-project isolation: Project B clients do NOT receive Project A artifact events', async () => {
    const wsUserA = await connectWs(projectA.id, sessionA.id, true);
    const wsUserB = await connectWs(projectB.id, sessionA.id, true);

    await waitForMessage(wsUserA, (m) => m.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);
    await waitForMessage(wsUserB, (m) => m.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);

    let projectBReceivedArtifact = false;
    wsUserB.on('message', (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === AgentMeshMessageType.ARTIFACT_CREATED) {
          projectBReceivedArtifact = true;
        }
      } catch {
        // ignore
      }
    });

    const userABroadcastPromise = waitForMessage(
      wsUserA,
      (m) => m.type === AgentMeshMessageType.ARTIFACT_CREATED,
    );

    // Create artifact in Project A via HTTP API
    const { artifactService } = await import('../services/artifact.service.js');
    await artifactService.createArtifact(projectA.id, taskA.id, userA.id, {
      type: 'CONFIG',
      name: 'Project A Config',
      agentId: agentA.id,
      payload: { env: 'test' },
    });

    await userABroadcastPromise;

    // Small delay to verify wsUserB didn't receive event
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(projectBReceivedArtifact).toBe(false);

    wsUserA.close();
    wsUserB.close();
  });
});
