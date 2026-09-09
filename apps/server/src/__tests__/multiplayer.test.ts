/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, Server as HTTPServer } from 'node:http';
import WebSocket from 'ws';
import {
  createAgentMeshMessage,
  AgentMeshMessageType,
} from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/websocket.server.js';

describe('PRD-13 Multiplayer Workspace Foundation Integration Tests', () => {
  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  // Test Users & Sessions
  let userA: { id: string; walletAddress: string | null; displayName: string | null };
  let userB: { id: string; walletAddress: string | null; displayName: string | null };
  let userC: { id: string; walletAddress: string | null; displayName: string | null }; // Non-member
  let sessionA: { id: string };
  let sessionB: { id: string };
  let sessionC: { id: string };

  // Test Projects
  let projectA: { id: string; name: string };
  let projectB: { id: string; name: string };

  // Test Agent
  let agentA1: { id: string; name: string; ownerId: string; provider: string };

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

    const walletA = '0x1300000000000000000000000000000000000001';
    const walletB = '0x1300000000000000000000000000000000000002';
    const walletC = '0x1300000000000000000000000000000000000003';

    // Clean up stale test data if present
    const existingUsers = await prisma.user.findMany({
      where: { walletAddress: { in: [walletA, walletB, walletC] } },
    });
    for (const u of existingUsers) {
      await prisma.agentCapability.deleteMany({ where: { agent: { ownerId: u.id } } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { ownerId: u.id } }).catch(() => {});
      await prisma.projectMember.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.project.deleteMany({ where: { ownerId: u.id } }).catch(() => {});
      await prisma.authSession.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    }

    userA = await prisma.user.create({
      data: { walletAddress: walletA, displayName: 'User A' },
    });
    userB = await prisma.user.create({
      data: { walletAddress: walletB, displayName: 'User B' },
    });
    userC = await prisma.user.create({
      data: { walletAddress: walletC, displayName: 'User C (Non-member)' },
    });

    sessionA = await sessionService.createSession(userA.id);
    sessionB = await sessionService.createSession(userB.id);
    sessionC = await sessionService.createSession(userC.id);

    // Project A owned by User A, with User B as MEMBER
    projectA = await prisma.project.create({
      data: {
        name: 'Project Alpha',
        ownerId: userA.id,
      },
    });

    await prisma.projectMember.create({
      data: {
        projectId: projectA.id,
        userId: userB.id,
        role: 'MEMBER',
      },
    });

    // Project B owned by User C
    projectB = await prisma.project.create({
      data: {
        name: 'Project Beta',
        ownerId: userC.id,
      },
    });

    // Agent owned by User A in Project A
    agentA1 = await prisma.agent.create({
      data: {
        projectId: projectA.id,
        ownerId: userA.id,
        name: 'Agent Alpha 1',
        provider: 'CLAUDE',
        status: 'OFFLINE',
      },
    });
  });

  afterAll(async () => {
    wsServer.stopHeartbeat();
    connectionManager.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // Clean up test data
    if (projectA) {
      await prisma.agent.deleteMany({ where: { projectId: projectA.id } }).catch(() => {});
      await prisma.projectMember.deleteMany({ where: { projectId: projectA.id } }).catch(() => {});
      await prisma.project.delete({ where: { id: projectA.id } }).catch(() => {});
    }
    if (projectB) {
      await prisma.projectMember.deleteMany({ where: { projectId: projectB.id } }).catch(() => {});
      await prisma.project.delete({ where: { id: projectB.id } }).catch(() => {});
    }
    for (const u of [userA, userB, userC]) {
      if (u?.id) {
        await prisma.authSession.deleteMany({ where: { userId: u.id } }).catch(() => {});
        await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
      }
    }
  });

  beforeEach(() => {
    connectionManager.clear();
  });

  it('1. User A connects to Project A and receives workspace.snapshot', async () => {
    const url = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionA.id}`;
    const ws = new WebSocket(url);

    const snapshotPromise = new Promise<any>((resolve) => {
      ws.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT) {
          resolve(parsed);
        }
      });
    });

    const snapshot = await snapshotPromise;
    expect(snapshot.type).toBe(AgentMeshMessageType.WORKSPACE_SNAPSHOT);
    expect(snapshot.projectId).toBe(projectA.id);
    expect(snapshot.payload.workspace.id).toBe(projectA.id);
    expect(snapshot.payload.members.length).toBe(2); // User A (OWNER) & User B (MEMBER)

    ws.close();
  });

  it('2. User A and User B connect to same workspace -> User A receives B online presence', async () => {
    const urlA = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionA.id}`;
    const wsA = new WebSocket(urlA);

    await new Promise<void>((resolve) => {
      wsA.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT) resolve();
      });
    });

    const presencePromise = new Promise<any>((resolve) => {
      wsA.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED) {
          resolve(parsed);
        }
      });
    });

    const urlB = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionB.id}`;
    const wsB = new WebSocket(urlB);

    const presenceChanged = await presencePromise;
    expect(presenceChanged.type).toBe(AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED);
    expect(presenceChanged.payload.entityType).toBe('user');
    expect(presenceChanged.payload.entityId).toBe(userB.id);
    expect(presenceChanged.payload.status).toBe('ONLINE');

    wsA.close();
    wsB.close();
  });

  it('3. User B disconnects -> User A receives offline presence notification', async () => {
    const urlA = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionA.id}`;
    const wsA = new WebSocket(urlA);
    await new Promise<void>((resolve) => wsA.once('message', () => resolve()));

    const urlB = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionB.id}`;
    const wsB = new WebSocket(urlB);
    await new Promise<void>((resolve) => wsB.once('message', () => resolve()));

    const offlinePromise = new Promise<any>((resolve) => {
      wsA.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (
          parsed.type === AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED &&
          parsed.payload.entityId === userB.id &&
          parsed.payload.status === 'OFFLINE'
        ) {
          resolve(parsed);
        }
      });
    });

    wsB.close();

    const offlineNotice = await offlinePromise;
    expect(offlineNotice.payload.status).toBe('OFFLINE');

    wsA.close();
  });

  it('4 & 5. Agent connects and handshakes -> workspace receives ONLINE agent presence; Agent disconnects -> receives OFFLINE', async () => {
    const urlUser = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionA.id}`;
    const wsUser = new WebSocket(urlUser);
    await new Promise<void>((resolve) => wsUser.once('message', () => resolve()));

    const agentOnlinePromise = new Promise<any>((resolve) => {
      wsUser.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (
          parsed.type === AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED &&
          parsed.payload.entityType === 'agent' &&
          parsed.payload.entityId === agentA1.id &&
          parsed.payload.status === 'ONLINE'
        ) {
          resolve(parsed);
        }
      });
    });

    // Agent connects with session cookie of owner User A
    const urlAgent = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}`;
    const wsAgent = new WebSocket(urlAgent, {
      headers: { cookie: `agentmesh_session=${sessionA.id}` },
    });

    await new Promise<void>((resolve) => wsAgent.on('open', resolve));

    // Send handshake request
    const handshakeReq = createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_HANDSHAKE,
      projectId: projectA.id,
      senderId: agentA1.id,
      payload: {
        agentId: agentA1.id,
        capabilities: [],
      },
    });

    wsAgent.send(JSON.stringify(handshakeReq));

    const agentOnlineNotice = await agentOnlinePromise;
    expect(agentOnlineNotice.payload.entityId).toBe(agentA1.id);
    expect(agentOnlineNotice.payload.status).toBe('ONLINE');

    // Test agent disconnect -> User receives OFFLINE
    const agentOfflinePromise = new Promise<any>((resolve) => {
      wsUser.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (
          parsed.type === AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED &&
          parsed.payload.entityType === 'agent' &&
          parsed.payload.entityId === agentA1.id &&
          parsed.payload.status === 'OFFLINE'
        ) {
          resolve(parsed);
        }
      });
    });

    wsAgent.close();

    const agentOfflineNotice = await agentOfflinePromise;
    expect(agentOfflineNotice.payload.status).toBe('OFFLINE');

    wsUser.close();
  });

  it('6. Reconnect restores presence cleanly', async () => {
    const urlA = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionA.id}`;
    const wsA = new WebSocket(urlA);
    await new Promise<void>((resolve) => wsA.once('message', () => resolve()));

    const onlinePromise = new Promise<any>((resolve) => {
      wsA.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (
          parsed.type === AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED &&
          parsed.payload.entityId === userB.id &&
          parsed.payload.status === 'ONLINE'
        ) {
          resolve(parsed);
        }
      });
    });

    // User B connects, disconnects, then reconnects
    const urlB = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionB.id}`;
    let wsB = new WebSocket(urlB);
    await new Promise<void>((resolve) => wsB.on('message', () => resolve()));
    wsB.close();

    // Reconnect wsB
    wsB = new WebSocket(urlB);
    await new Promise<void>((resolve) => wsB.on('open', resolve));

    const notice = await onlinePromise;
    expect(notice.payload.status).toBe('ONLINE');

    wsA.close();
    wsB.close();
  });

  it('7. Non-member user WebSocket connection rejected with HTTP 403 / close', async () => {
    // User C is NOT a member of Project A
    const url = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionC.id}`;
    const ws = new WebSocket(url);
    ws.on('error', () => {});

    let resCode: number | null = null;
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        resCode = res.statusCode ?? null;
        resolve();
      });
      ws.on('close', (code) => {
        resCode = code;
        resolve();
      });
    });

    expect([403, 4003]).toContain(resCode);
  });

  it('8. Cross-project isolation: User in Project B does NOT receive events for Project A', async () => {
    // User C connects to Project B
    const urlC = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectB.id}&token=${sessionC.id}`;
    const wsC = new WebSocket(urlC);
    await new Promise<void>((resolve) => wsC.on('message', () => resolve()));

    let receivedProjectAEvent = false;
    wsC.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString());
      if (parsed.projectId === projectA.id || parsed.payload?.entityId === userA.id) {
        receivedProjectAEvent = true;
      }
    });

    // User A connects to Project A
    const urlA = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionA.id}`;
    const wsA = new WebSocket(urlA);
    await new Promise<void>((resolve) => wsA.once('message', () => resolve()));

    // Wait short delay to ensure no cross-project broadcast occurred
    await new Promise((r) => setTimeout(r, 100));
    expect(receivedProjectAEvent).toBe(false);

    wsA.close();
    wsC.close();
  });

  it('9. Malformed protocol message rejected', async () => {
    const urlA = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionA.id}`;
    const wsA = new WebSocket(urlA);
    await new Promise<void>((resolve) => wsA.once('message', () => resolve()));

    const errorPromise = new Promise<any>((resolve) => {
      wsA.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'error') {
          resolve(parsed);
        }
      });
    });

    wsA.send('not json');

    const errObj = await errorPromise;
    expect(errObj.type).toBe('error');
    expect(errObj.payload.code).toBe('INVALID_MESSAGE');

    wsA.close();
  });

  it('10. Multiple simultaneous connections for same user: only 1 offline notice when last closes', async () => {
    const urlObserver = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionA.id}`;
    const wsObserver = new WebSocket(urlObserver);
    await new Promise<void>((resolve) => wsObserver.on('message', () => resolve()));

    const urlB = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionB.id}`;
    const wsB1 = new WebSocket(urlB);
    await new Promise<void>((resolve) => wsB1.on('message', () => resolve()));

    const wsB2 = new WebSocket(urlB);
    await new Promise<void>((resolve) => wsB2.on('message', () => resolve()));

    let offlineCount = 0;
    wsObserver.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString());
      if (
        parsed.type === AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED &&
        parsed.payload.entityId === userB.id &&
        parsed.payload.status === 'OFFLINE'
      ) {
        offlineCount++;
      }
    });

    // Close first socket for User B
    wsB1.close();
    await new Promise((r) => setTimeout(r, 100));

    // Still 1 connection remaining for User B, so 0 OFFLINE broadcasts sent
    expect(offlineCount).toBe(0);

    // Close second socket for User B
    wsB2.close();
    await new Promise((r) => setTimeout(r, 100));

    // Now 0 connections remain for User B, so 1 OFFLINE broadcast sent
    expect(offlineCount).toBe(1);

    wsObserver.close();
  });
});
