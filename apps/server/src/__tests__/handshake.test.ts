import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, Server as HTTPServer } from 'node:http';
import WebSocket from 'ws';
import {
  createAgentMeshMessage,
  AgentMeshMessageType,
  AGENTMESH_PROTOCOL_VERSION,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/websocket.server.js';

describe('PRD #9 Authenticated Agent Handshake Integration Tests', () => {
  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  // Test Entities
  let userA: { id: string; walletAddress: string | null };
  let userB: { id: string; walletAddress: string | null };
  let sessionA: { id: string };
  let sessionB: { id: string };

  let projectA: { id: string };
  let projectB: { id: string };

  let agentA1: { id: string }; // User A, Project A
  let agentA2: { id: string }; // User A, Project A (second agent)
  let agentB1: { id: string }; // User B, Project B

  beforeAll(async () => {
    // 1. Create HTTP & WS Server
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

    const walletA = '0x1111111111111111111111111111111111111111';
    const walletB = '0x2222222222222222222222222222222222222222';

    // Clean up stale test data if present
    const existingUsers = await prisma.user.findMany({
      where: { walletAddress: { in: [walletA, walletB] } },
    });
    for (const u of existingUsers) {
      await prisma.agentCapability.deleteMany({ where: { agent: { ownerId: u.id } } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { ownerId: u.id } }).catch(() => {});
      await prisma.projectMember.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.project.deleteMany({ where: { ownerId: u.id } }).catch(() => {});
      await prisma.authSession.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    }

    // 2. Setup Test Database Entities
    userA = await prisma.user.create({
      data: { walletAddress: walletA, displayName: 'User A' },
    });
    userB = await prisma.user.create({
      data: { walletAddress: walletB, displayName: 'User B' },
    });

    sessionA = await sessionService.createSession(userA.id);
    sessionB = await sessionService.createSession(userB.id);

    projectA = await prisma.project.create({
      data: { name: 'Project A', ownerId: userA.id },
    });
    projectB = await prisma.project.create({
      data: { name: 'Project B', ownerId: userB.id },
    });

    // Memberships: User A in Project A, User B in Project B
    await prisma.projectMember.create({
      data: { projectId: projectA.id, userId: userA.id, role: 'OWNER' },
    });
    await prisma.projectMember.create({
      data: { projectId: projectB.id, userId: userB.id, role: 'OWNER' },
    });

    // Agents
    agentA1 = await prisma.agent.create({
      data: {
        name: 'Agent A1',
        provider: 'claude',
        projectId: projectA.id,
        ownerId: userA.id,
        status: 'OFFLINE',
        capabilities: {
          create: [{ capability: 'frontend' }, { capability: 'typescript' }],
        },
      },
    });

    agentA2 = await prisma.agent.create({
      data: {
        name: 'Agent A2',
        provider: 'gemini',
        projectId: projectA.id,
        ownerId: userA.id,
        status: 'OFFLINE',
        capabilities: {
          create: [{ capability: 'backend' }],
        },
      },
    });

    agentB1 = await prisma.agent.create({
      data: {
        name: 'Agent B1',
        provider: 'codex',
        projectId: projectB.id,
        ownerId: userB.id,
        status: 'OFFLINE',
      },
    });
  });

  afterAll(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // Clean DB safely
    const agentIds = [agentA1?.id, agentA2?.id, agentB1?.id].filter(Boolean);
    const projectIds = [projectA?.id, projectB?.id].filter(Boolean);
    const sessionIds = [sessionA?.id, sessionB?.id].filter(Boolean);
    const userIds = [userA?.id, userB?.id].filter(Boolean);

    if (agentIds.length > 0) {
      await prisma.agentCapability.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { id: { in: agentIds } } }).catch(() => {});
    }
    if (projectIds.length > 0) {
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => {});
    }
    if (sessionIds.length > 0) {
      await prisma.authSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {});
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    connectionManager.clear();
    // Reset agent statuses to OFFLINE
    await prisma.agent.updateMany({
      where: { id: { in: [agentA1.id, agentA2.id, agentB1.id] } },
      data: { status: 'OFFLINE' },
    });
  });

  const connectWs = (projectId: string, sessionId?: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (sessionId) {
        headers['Cookie'] = `agentmesh_session=${sessionId}`;
      }
      const client = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?projectId=${projectId}`, {
        headers,
      });
      client.on('open', () => resolve(client));
      client.on('error', (err) => reject(err));
    });
  };

  /**
   * Waits for the next agent.handshake.accepted / agent.handshake.rejected
   * reply, skipping unrelated live events (e.g. activity.created broadcasts
   * from the project-level event feed).
   */
  const receiveHandshakeReply = (ws: WebSocket): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
      let skipGuard = 0;
      const onMessage = (data: WebSocket.RawData): void => {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          if (msg.type !== 'agent.handshake.accepted' && msg.type !== 'agent.handshake.rejected') {
            skipGuard += 1;
            if (skipGuard > 100) {
              reject(new Error('Gave up waiting for a handshake reply'));
              return;
            }
            ws.once('message', onMessage);
            return;
          }
          resolve(msg);
        } catch (err) {
          reject(err);
        }
      };
      ws.once('message', onMessage);
    });
  };

  describe('1. Authentication & Session Verification', () => {
    it('1. should reject unauthenticated upgrade when no session cookie is provided', async () => {
      let error: unknown;
      try {
        await connectWs(projectA.id); // No session cookie
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
    });

    it('2. should accept valid authenticated handshake with session cookie', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.accepted');
      const payload = res.payload as Record<string, unknown>;
      expect(payload.agentId).toBe(agentA1.id);
      expect(payload.projectId).toBe(projectA.id);
      expect(typeof payload.sessionId).toBe('string');
      expect((payload.sessionId as string).length).toBeGreaterThan(10);

      ws.close();
    });

    it('15 & 16. should reject client handshake request containing unexpected sessionId field', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const invalidMsg = {
        id: 'msg-1',
        protocolVersion: AGENTMESH_PROTOCOL_VERSION,
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        timestamp: new Date().toISOString(),
        payload: {
          agentId: agentA1.id,
          sessionId: 'client-chosen-session-id',
        },
      };

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(invalidMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.rejected');
      const payload = res.payload as Record<string, unknown>;
      expect(payload.code).toBe('INVALID_MESSAGE');

      ws.close();
    });
  });

  describe('2. Agent Ownership & Access Control', () => {
    it('3. should succeed when user authenticates their own registered agent', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.accepted');
      ws.close();
    });

    it('4. should reject with AGENT_NOT_OWNED when user attempts to connect another user agent', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      // User A attempts to connect Agent B1 (owned by User B)
      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentB1.id,
        payload: { agentId: agentB1.id },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.rejected');
      expect((res.payload as Record<string, unknown>).code).toBe('AGENT_NOT_OWNED');
      ws.close();
    });

    it('5. should reject with AGENT_PROJECT_MISMATCH when agent from Project B attempts Project A WS', async () => {
      // First grant User B access to Project A so project membership isn't the failure point
      await prisma.projectMember.create({
        data: { projectId: projectA.id, userId: userB.id, role: 'MEMBER' },
      });

      const ws = await connectWs(projectA.id, sessionB.id);

      // User B attempts to connect Agent B1 (registered under Project B) into Project A WebSocket
      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentB1.id,
        payload: { agentId: agentB1.id },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.rejected');
      expect((res.payload as Record<string, unknown>).code).toBe('AGENT_PROJECT_MISMATCH');

      ws.close();

      // Clean up temp membership
      await prisma.projectMember.delete({
        where: { projectId_userId: { projectId: projectA.id, userId: userB.id } },
      });
    });

    it('6. should reject pre-upgrade with HTTP 403 when user is not a member of the project', async () => {
      // Create an agent owned by User B under Project A, but remove User B from Project A membership
      const tempAgent = await prisma.agent.create({
        data: {
          name: 'Temp Agent',
          provider: 'claude',
          projectId: projectA.id,
          ownerId: userB.id,
          status: 'OFFLINE',
        },
      });

      let error: unknown;
      try {
        await connectWs(projectA.id, sessionB.id);
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();

      await prisma.agent.delete({ where: { id: tempAgent.id } }).catch(() => {});
    });
  });

  describe('3. Capabilities Verification', () => {
    it('7. should accept handshake with valid registered capabilities', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id, capabilities: ['frontend', 'typescript'] },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.accepted');
      expect((res.payload as Record<string, unknown>).capabilities).toEqual(['frontend', 'typescript']);
      ws.close();
    });

    it('8. should reject with INVALID_CAPABILITIES when requesting an unregistered capability', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id, capabilities: ['frontend', 'unregistered-capability'] },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.rejected');
      expect((res.payload as Record<string, unknown>).code).toBe('INVALID_CAPABILITIES');
      ws.close();
    });

    it('9. should correctly handle capability trim and lowercase normalization', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id, capabilities: [' FRONTEND ', 'TypeScript'] },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.accepted');
      expect((res.payload as Record<string, unknown>).capabilities).toEqual(['frontend', 'typescript']);
      ws.close();
    });
  });

  describe('4. Agent Status & Session Lifecycle', () => {
    it('10. should mark agent status ONLINE in database upon successful handshake', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      await responsePromise;

      // Verify DB status
      const agent = await prisma.agent.findUnique({ where: { id: agentA1.id } });
      expect(agent?.status).toBe('ONLINE');

      ws.close();
    });

    it('11. should mark agent status OFFLINE when connection disconnects', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      await responsePromise;

      // Close socket
      ws.close();

      // Give async disconnect handler time to execute
      await new Promise((resolve) => setTimeout(resolve, 150));

      const agent = await prisma.agent.findUnique({ where: { id: agentA1.id } });
      expect(agent?.status).toBe('OFFLINE');
    });

    it('12. should keep agent ONLINE if one of multiple active sessions disconnects', async () => {
      const ws1 = await connectWs(projectA.id, sessionA.id);
      const ws2 = await connectWs(projectA.id, sessionA.id);

      const handshakeMsg1 = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id },
      });

      const handshakeMsg2 = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id },
      });

      // Perform handshake on both connections for same agent
      const p1 = receiveHandshakeReply(ws1);
      ws1.send(JSON.stringify(handshakeMsg1));
      await p1;

      const p2 = receiveHandshakeReply(ws2);
      ws2.send(JSON.stringify(handshakeMsg2));
      await p2;

      // Close first connection
      ws1.close();
      await new Promise((r) => setTimeout(r, 150));

      // Agent must remain ONLINE because ws2 is still connected!
      let agent = await prisma.agent.findUnique({ where: { id: agentA1.id } });
      expect(agent?.status).toBe('ONLINE');

      // Now close second connection
      ws2.close();
      await new Promise((r) => setTimeout(r, 150));

      agent = await prisma.agent.findUnique({ where: { id: agentA1.id } });
      expect(agent?.status).toBe('OFFLINE');
    });

    it('13. should reject duplicate handshake on same connection with HANDSHAKE_ALREADY_COMPLETED', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: { agentId: agentA1.id },
      });

      // First handshake
      const p1 = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      const res1 = await p1;
      expect(res1.type).toBe('agent.handshake.accepted');

      // Second handshake on same connection
      const p2 = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(handshakeMsg));
      const res2 = await p2;

      expect(res2.type).toBe('agent.handshake.rejected');
      expect((res2.payload as Record<string, unknown>).code).toBe('HANDSHAKE_ALREADY_COMPLETED');

      ws.close();
    });

    it('14. should reject application messages prior to handshake with HANDSHAKE_REQUIRED', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      // Attempt to send task.request without having completed handshake
      const appMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.TASK_REQUEST,
        projectId: projectA.id,
        senderId: agentA1.id,
        payload: {
          taskId: 'task-1',
          title: 'Test Task',
          description: 'Testing pre-handshake blocking',
        },
      });

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(appMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.rejected');
      expect((res.payload as Record<string, unknown>).code).toBe('HANDSHAKE_REQUIRED');

      ws.close();
    });
  });

  describe('5. Protocol Errors & Schema Validation', () => {
    it('17. should return structured rejection for malformed handshake payload', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const malformedMsg = {
        id: 'msg-1',
        protocolVersion: AGENTMESH_PROTOCOL_VERSION,
        type: 'agent.handshake',
        projectId: projectA.id,
        senderId: 'user',
        timestamp: new Date().toISOString(),
        payload: {}, // Missing required agentId
      };

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(malformedMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.rejected');
      expect((res.payload as Record<string, unknown>).code).toBe('INVALID_MESSAGE');

      ws.close();
    });

    it('18. should reject with UNSUPPORTED_PROTOCOL_VERSION when protocol version is invalid', async () => {
      const ws = await connectWs(projectA.id, sessionA.id);

      const invalidVersionMsg = {
        id: 'msg-1',
        protocolVersion: '99.0',
        type: 'agent.handshake',
        projectId: projectA.id,
        senderId: agentA1.id,
        timestamp: new Date().toISOString(),
        payload: { agentId: agentA1.id },
      };

      const responsePromise = receiveHandshakeReply(ws);
      ws.send(JSON.stringify(invalidVersionMsg));
      const res = await responsePromise;

      expect(res.type).toBe('agent.handshake.rejected');
      expect((res.payload as Record<string, unknown>).code).toBe('UNSUPPORTED_PROTOCOL_VERSION');

      ws.close();
    });
  });
});
