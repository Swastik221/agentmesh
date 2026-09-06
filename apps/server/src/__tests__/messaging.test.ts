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

describe('PRD #10 Agent-to-Agent Messaging Integration Tests', () => {
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

    const walletA = '0x3333333333333333333333333333333333333333';
    const walletB = '0x4444444444444444444444444444444444444444';

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
      data: { walletAddress: walletA, displayName: 'Messaging User A' },
    });
    userB = await prisma.user.create({
      data: { walletAddress: walletB, displayName: 'Messaging User B' },
    });

    sessionA = await sessionService.createSession(userA.id);
    sessionB = await sessionService.createSession(userB.id);

    projectA = await prisma.project.create({
      data: { name: 'Messaging Project A', ownerId: userA.id },
    });
    projectB = await prisma.project.create({
      data: { name: 'Messaging Project B', ownerId: userB.id },
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
        name: 'Messaging Agent A1',
        provider: 'claude',
        projectId: projectA.id,
        ownerId: userA.id,
        status: 'OFFLINE',
      },
    });

    agentA2 = await prisma.agent.create({
      data: {
        name: 'Messaging Agent A2',
        provider: 'gemini',
        projectId: projectA.id,
        ownerId: userA.id,
        status: 'OFFLINE',
      },
    });

    agentB1 = await prisma.agent.create({
      data: {
        name: 'Messaging Agent B1',
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

  const performHandshake = async (ws: WebSocket, projectId: string, agentId: string): Promise<Record<string, unknown>> => {
    const handshakeMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_HANDSHAKE,
      projectId,
      senderId: agentId,
      payload: { agentId },
    });

    const responsePromise = receiveMessage(ws);
    ws.send(JSON.stringify(handshakeMsg));
    return responsePromise;
  };

  const receiveMessage = (ws: WebSocket): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
      ws.once('message', (data) => {
        try {
          resolve(JSON.parse(data.toString()));
        } catch (err) {
          reject(err);
        }
      });
    });
  };

  describe('1. Authentication & Pre-Handshake Checks', () => {
    it('1. should reject agent.message on unauthenticated connection with HANDSHAKE_REQUIRED', async () => {
      const ws = await connectWs(projectA.id); // No session cookie

      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: agentA2.id,
        payload: { body: 'Unauthenticated message' },
      });

      const responsePromise = receiveMessage(ws);
      ws.send(JSON.stringify(msg));
      const res = await responsePromise;

      expect(res.type).toBe('error');
      expect((res.payload as Record<string, unknown>).code).toBe('HANDSHAKE_REQUIRED');
      ws.close();
    });

    it('2. should reject message when senderId does NOT match connection agentId (SENDER_ID_MISMATCH)', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsSender, projectA.id, agentA1.id);

      // Authenticated as Agent A1, but attempting to send with senderId = agentA2.id (spoofing)
      const spoofedMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA2.id, // Mismatched sender ID
        recipientId: agentA1.id,
        payload: { body: 'Spoofed sender attempt' },
      });

      const responsePromise = receiveMessage(wsSender);
      wsSender.send(JSON.stringify(spoofedMsg));
      const res = await responsePromise;

      expect(res.type).toBe('error');
      const payload = res.payload as Record<string, unknown>;
      expect(payload.code).toBe('SENDER_ID_MISMATCH');
      expect(payload.message).toContain('does not match authenticated agent ID');

      wsSender.close();
    });

    it('3. should successfully route agent.message from authenticated sender to recipient', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      const wsRecipient = await connectWs(projectA.id, sessionA.id);

      await performHandshake(wsSender, projectA.id, agentA1.id);
      await performHandshake(wsRecipient, projectA.id, agentA2.id);

      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: agentA2.id,
        correlationId: 'corr-999',
        payload: { body: 'Hello Agent A2!', metadata: { topic: 'greeting' } },
      });

      const recipientPromise = receiveMessage(wsRecipient);
      wsSender.send(JSON.stringify(msg));
      const routedMsg = await recipientPromise;

      expect(routedMsg.type).toBe('agent.message');
      expect(routedMsg.id).toBe(msg.id);
      expect(routedMsg.projectId).toBe(projectA.id);
      expect(routedMsg.senderId).toBe(agentA1.id);
      expect(routedMsg.recipientId).toBe(agentA2.id);
      expect(routedMsg.correlationId).toBe('corr-999');
      expect((routedMsg.payload as Record<string, unknown>).body).toBe('Hello Agent A2!');

      wsSender.close();
      wsRecipient.close();
    });
  });

  describe('2. Project Isolation & Validation', () => {
    it('4. should return RECIPIENT_NOT_FOUND when recipient agent does not exist', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsSender, projectA.id, agentA1.id);

      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: 'nonexistent-agent-id',
        payload: { body: 'Hello nobody' },
      });

      const responsePromise = receiveMessage(wsSender);
      wsSender.send(JSON.stringify(msg));
      const res = await responsePromise;

      expect(res.type).toBe('error');
      expect((res.payload as Record<string, unknown>).code).toBe('RECIPIENT_NOT_FOUND');

      wsSender.close();
    });

    it('5 & 16. should reject message with RECIPIENT_PROJECT_MISMATCH when recipient belongs to another project', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsSender, projectA.id, agentA1.id);

      // Attempt to message Agent B1 (registered in Project B)
      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: agentB1.id,
        payload: { body: 'Cross-project attempt' },
      });

      const responsePromise = receiveMessage(wsSender);
      wsSender.send(JSON.stringify(msg));
      const res = await responsePromise;

      expect(res.type).toBe('error');
      expect((res.payload as Record<string, unknown>).code).toBe('RECIPIENT_PROJECT_MISMATCH');

      wsSender.close();
    });

    it('6 & 17. should reject message with PROJECT_MISMATCH when message projectId differs from connection projectId', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsSender, projectA.id, agentA1.id);

      // Manipulate message.projectId to projectB.id
      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectB.id, // Mismatched projectId
        senderId: agentA1.id,
        recipientId: agentA2.id,
        payload: { body: 'Project manipulation attempt' },
      });

      const responsePromise = receiveMessage(wsSender);
      wsSender.send(JSON.stringify(msg));
      const res = await responsePromise;

      expect(res.type).toBe('error');
      expect((res.payload as Record<string, unknown>).code).toBe('PROJECT_MISMATCH');

      wsSender.close();
    });
  });

  describe('3. Recipient Availability & Offline Handling', () => {
    it('7. should return RECIPIENT_OFFLINE error when recipient agent is not connected', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsSender, projectA.id, agentA1.id);

      // Agent A2 exists in DB but is not connected to WebSocket
      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: agentA2.id,
        payload: { body: 'Message to offline recipient' },
      });

      const responsePromise = receiveMessage(wsSender);
      wsSender.send(JSON.stringify(msg));
      const res = await responsePromise;

      expect(res.type).toBe('error');
      const payload = res.payload as Record<string, unknown>;
      expect(payload.code).toBe('RECIPIENT_OFFLINE');
      expect(payload.retryable).toBe(true);

      wsSender.close();
    });

    it('8. should deliver message successfully after offline recipient reconnects', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsSender, projectA.id, agentA1.id);

      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: agentA2.id,
        payload: { body: 'Retry message after reconnect' },
      });

      // 1. Initial attempt fails because recipient is offline
      const p1 = receiveMessage(wsSender);
      wsSender.send(JSON.stringify(msg));
      const res1 = await p1;
      expect((res1.payload as Record<string, unknown>).code).toBe('RECIPIENT_OFFLINE');

      // 2. Recipient connects and completes handshake
      const wsRecipient = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsRecipient, projectA.id, agentA2.id);

      // 3. Retry message succeeds
      const recipientPromise = receiveMessage(wsRecipient);
      wsSender.send(JSON.stringify(msg));
      const routedMsg = await recipientPromise;

      expect(routedMsg.type).toBe('agent.message');
      expect((routedMsg.payload as Record<string, unknown>).body).toBe('Retry message after reconnect');

      wsSender.close();
      wsRecipient.close();
    });
  });

  describe('4. Multi-Session Fan-Out', () => {
    it('9. should deliver message to ALL active authenticated connections for multi-session recipient', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsSender, projectA.id, agentA1.id);

      // Agent A2 establishes two simultaneous active connections
      const wsRecipientConn1 = await connectWs(projectA.id, sessionA.id);
      const wsRecipientConn2 = await connectWs(projectA.id, sessionA.id);

      await performHandshake(wsRecipientConn1, projectA.id, agentA2.id);
      await performHandshake(wsRecipientConn2, projectA.id, agentA2.id);

      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: agentA2.id,
        payload: { body: 'Fan-out broadcast message' },
      });

      const promiseConn1 = receiveMessage(wsRecipientConn1);
      const promiseConn2 = receiveMessage(wsRecipientConn2);

      wsSender.send(JSON.stringify(msg));

      const [res1, res2] = await Promise.all([promiseConn1, promiseConn2]);

      expect(res1.type).toBe('agent.message');
      expect((res1.payload as Record<string, unknown>).body).toBe('Fan-out broadcast message');

      expect(res2.type).toBe('agent.message');
      expect((res2.payload as Record<string, unknown>).body).toBe('Fan-out broadcast message');

      wsSender.close();
      wsRecipientConn1.close();
      wsRecipientConn2.close();
    });

    it('10. should continue delivering to remaining connection after one recipient connection disconnects', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsSender, projectA.id, agentA1.id);

      const wsRecipientConn1 = await connectWs(projectA.id, sessionA.id);
      const wsRecipientConn2 = await connectWs(projectA.id, sessionA.id);

      await performHandshake(wsRecipientConn1, projectA.id, agentA2.id);
      await performHandshake(wsRecipientConn2, projectA.id, agentA2.id);

      // Disconnect connection 1
      wsRecipientConn1.close();
      await new Promise((r) => setTimeout(r, 100));

      const msg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: agentA2.id,
        payload: { body: 'Message after single session disconnect' },
      });

      const promiseConn2 = receiveMessage(wsRecipientConn2);
      wsSender.send(JSON.stringify(msg));
      const res2 = await promiseConn2;

      expect(res2.type).toBe('agent.message');
      expect((res2.payload as Record<string, unknown>).body).toBe('Message after single session disconnect');

      wsSender.close();
      wsRecipientConn2.close();
    });
  });

  describe('5. Protocol Integrity & Payload Validation', () => {
    it('11, 12, 13, 14, 15. should preserve message ID, correlationId, senderId, recipientId, and protocolVersion', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      const wsRecipient = await connectWs(projectA.id, sessionA.id);

      await performHandshake(wsSender, projectA.id, agentA1.id);
      await performHandshake(wsRecipient, projectA.id, agentA2.id);

      const customMsgId = 'custom-msg-uuid-0001';
      const customCorrId = 'custom-corr-uuid-0002';

      const msg = createAgentMeshMessage({
        id: customMsgId,
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: agentA2.id,
        correlationId: customCorrId,
        payload: { body: 'Protocol integrity test' },
      });

      const recipientPromise = receiveMessage(wsRecipient);
      wsSender.send(JSON.stringify(msg));
      const routedMsg = await recipientPromise;

      expect(routedMsg.id).toBe(customMsgId);
      expect(routedMsg.protocolVersion).toBe(AGENTMESH_PROTOCOL_VERSION);
      expect(routedMsg.senderId).toBe(agentA1.id);
      expect(routedMsg.recipientId).toBe(agentA2.id);
      expect(routedMsg.correlationId).toBe(customCorrId);

      wsSender.close();
      wsRecipient.close();
    });

    it('18, 19, 20. should reject agent.message with empty or invalid payload', async () => {
      const wsSender = await connectWs(projectA.id, sessionA.id);
      await performHandshake(wsSender, projectA.id, agentA1.id);

      const invalidPayloadMsg = {
        id: 'msg-invalid-1',
        protocolVersion: AGENTMESH_PROTOCOL_VERSION,
        type: AgentMeshMessageType.AGENT_MESSAGE,
        projectId: projectA.id,
        senderId: agentA1.id,
        recipientId: agentA2.id,
        timestamp: new Date().toISOString(),
        payload: { body: '   ' }, // Empty whitespace body
      };

      const responsePromise = receiveMessage(wsSender);
      wsSender.send(JSON.stringify(invalidPayloadMsg));
      const res = await responsePromise;

      expect(res.type).toBe('error');
      expect((res.payload as Record<string, unknown>).code).toBe('INVALID_PAYLOAD');

      wsSender.close();
    });
  });
});
