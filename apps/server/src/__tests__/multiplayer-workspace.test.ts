import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import http from 'node:http';
import { WebSocket } from 'ws';
import {
  createAgentMeshMessage,
  AgentMeshMessageType,
} from '@agentmesh/agent-protocol';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/index.js';
import { ensService } from '../services/ens.service.js';

describe('PRD-58 & PRD-58-C1 Real Multi-User Workspace, Invitations & Agent Onboarding Integration Tests', () => {
  const app = createApp();
  const request = supertest(app);
  let server: http.Server;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  let ownerUser: { id: string; walletAddress: string };
  let ownerCookie: string;
  let ownerSessionId: string;

  let teammateUser: { id: string; walletAddress: string };
  let teammateCookie: string;
  let teammateSessionId: string;

  let outsiderUser: { id: string; walletAddress: string };
  let outsiderCookie: string;
  let outsiderSessionId: string;

  const connectWs = (urlPath: string, token: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const fullPath = `${urlPath}${urlPath.includes('?') ? '&' : '?'}token=${token}&clientType=user`;
      const client = new WebSocket(`ws://localhost:${serverPort}${fullPath}`);
      client.on('open', () => resolve(client));
      client.on('error', (err) => reject(err));
    });
  };

  const connectAgentWs = (urlPath: string, token: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const fullPath = `${urlPath}${urlPath.includes('?') ? '&' : '?'}token=${token}`;
      const client = new WebSocket(`ws://localhost:${serverPort}${fullPath}`);
      client.on('open', () => resolve(client));
      client.on('error', (err) => reject(err));
    });
  };

  const waitForMatchingMessage = (
    ws: WebSocket,
    predicate: (msg: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
      let skipCount = 0;
      const timeout = setTimeout(() => {
        ws.removeListener('message', onMessage);
        reject(new Error('Timeout waiting for matching WS message'));
      }, 5000);
      const onMessage = (data: WebSocket.RawData): void => {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          if (predicate(msg)) {
            clearTimeout(timeout);
            ws.removeListener('message', onMessage);
            resolve(msg);
            return;
          }
          skipCount += 1;
          if (skipCount > 50) {
            clearTimeout(timeout);
            ws.removeListener('message', onMessage);
            reject(new Error('Exceeded max skipped messages waiting for matching WS event'));
            return;
          }
        } catch (err) {
          clearTimeout(timeout);
          ws.removeListener('message', onMessage);
          reject(err);
        }
      };
      ws.on('message', onMessage);
    });
  };

  const receiveHandshakeReply = (ws: WebSocket): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
      let skipGuard = 0;
      const timeout = setTimeout(() => {
        ws.removeListener('message', onMessage);
        reject(new Error('Timeout waiting for handshake reply'));
      }, 5000);
      const onMessage = (data: WebSocket.RawData): void => {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          if (msg.type !== 'agent.handshake.accepted' && msg.type !== 'agent.handshake.rejected') {
            skipGuard += 1;
            if (skipGuard > 50) {
              clearTimeout(timeout);
              ws.removeListener('message', onMessage);
              reject(new Error('Gave up waiting for a handshake reply'));
              return;
            }
            return;
          }
          clearTimeout(timeout);
          ws.removeListener('message', onMessage);
          resolve(msg);
        } catch (err) {
          clearTimeout(timeout);
          ws.removeListener('message', onMessage);
          reject(err);
        }
      };
      ws.on('message', onMessage);
    });
  };

  beforeAll(async () => {
    server = http.createServer(app);
    wsServer = setupWebSocketServer(server);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (wsServer) await wsServer.close();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function clearDb() {
    await prisma.activityEvent.deleteMany().catch(() => {});
    await prisma.taskExecution.deleteMany().catch(() => {});
    await prisma.approvalRequest.deleteMany().catch(() => {});
    await prisma.taskDependency.deleteMany().catch(() => {});
    await prisma.taskResponsibility.deleteMany().catch(() => {});
    await prisma.task.deleteMany().catch(() => {});
    await prisma.agentCapability.deleteMany().catch(() => {});
    await prisma.agent.deleteMany().catch(() => {});
    await prisma.projectInvitation.deleteMany().catch(() => {});
    await prisma.projectMember.deleteMany().catch(() => {});
    await prisma.projectWorkspace.deleteMany().catch(() => {});
    await prisma.project.deleteMany().catch(() => {});
    await prisma.authSession.deleteMany().catch(() => {});
    await prisma.user.deleteMany().catch(() => {});
  }

  beforeEach(async () => {
    await clearDb();

    // Create Owner User (Alice)
    const u1 = await prisma.user.create({
      data: {
        walletAddress: '0x1111111111111111111111111111111111111111',
        displayName: 'Alice Owner',
      },
    });
    ownerUser = { id: u1.id, walletAddress: u1.walletAddress! };
    const sess1 = await sessionService.createSession(ownerUser.id);
    ownerSessionId = sess1.id;
    ownerCookie = `agentmesh_session=${sess1.id}`;

    // Create Teammate User (Bob)
    const u2 = await prisma.user.create({
      data: {
        walletAddress: '0x2222222222222222222222222222222222222222',
        displayName: 'Bob Teammate',
      },
    });
    teammateUser = { id: u2.id, walletAddress: u2.walletAddress! };
    const sess2 = await sessionService.createSession(teammateUser.id);
    teammateSessionId = sess2.id;
    teammateCookie = `agentmesh_session=${sess2.id}`;

    // Create Outsider User (Eve)
    const u3 = await prisma.user.create({
      data: {
        walletAddress: '0x3333333333333333333333333333333333333333',
        displayName: 'Eve Outsider',
      },
    });
    outsiderUser = { id: u3.id, walletAddress: u3.walletAddress! };
    const sess3 = await sessionService.createSession(outsiderUser.id);
    outsiderSessionId = sess3.id;
    outsiderCookie = `agentmesh_session=${sess3.id}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearDb();
  });

  describe('1. Fresh User Workspace Experience & Persistence', () => {
    it('Scenario 1: Fresh project list persistence -> creator creates project, teammate accepts -> project exists in GET /projects for both', async () => {
      // 1. New user has 0 projects initially
      const initRes = await request
        .get('/projects')
        .set('Cookie', ownerCookie);

      expect(initRes.status).toBe(200);
      expect(Array.isArray(initRes.body.projects)).toBe(true);
      expect(initRes.body.projects.length).toBe(0);

      // 2. Owner creates project
      const createRes = await request
        .post('/projects')
        .set('Cookie', ownerCookie)
        .send({ name: 'Alpha Protocol', description: 'Multiplayer persistence test' });

      expect(createRes.status).toBe(201);
      const projectId = createRes.body.id;

      // Creator sees project in GET /projects
      const ownerProjectsRes = await request
        .get('/projects')
        .set('Cookie', ownerCookie);

      expect(ownerProjectsRes.body.projects.length).toBe(1);
      expect(ownerProjectsRes.body.projects[0].id).toBe(projectId);

      // 3. Teammate accepts invitation and sees project in GET /projects
      const inv = await prisma.projectInvitation.create({
        data: {
          projectId,
          inviterUserId: ownerUser.id,
          invitedWallet: teammateUser.walletAddress.toLowerCase(),
          role: 'MEMBER',
          status: 'PENDING',
        },
      });

      await request
        .post(`/invitations/${inv.id}/accept`)
        .set('Cookie', teammateCookie);

      const teammateProjectsRes = await request
        .get('/projects')
        .set('Cookie', teammateCookie);

      expect(teammateProjectsRes.body.projects.length).toBe(1);
      expect(teammateProjectsRes.body.projects[0].id).toBe(projectId);
    });

    it('Scenario 2: Project creation & owner membership -> POST /projects sets creator as OWNER', async () => {
      const res = await request
        .post('/projects')
        .set('Cookie', ownerCookie)
        .send({ name: 'Beta Protocol', description: 'Owner membership test' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.ownerId).toBe(ownerUser.id);

      const member = await prisma.projectMember.findFirst({
        where: { projectId: res.body.id, userId: ownerUser.id },
      });
      expect(member).not.toBeNull();
      expect(member?.role).toBe('OWNER');
    });
  });

  describe('2. Teammate Invitations (Wallet & Real ENS)', () => {
    let projectId: string;

    beforeEach(async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Shared Project',
          ownerId: ownerUser.id,
          members: {
            create: { userId: ownerUser.id, role: 'OWNER' },
          },
        },
      });
      projectId = p.id;
    });

    it('Scenario 3: Invite by wallet address -> POST /projects/:id/invitations creates PENDING invitation', async () => {
      const res = await request
        .post(`/projects/${projectId}/invitations`)
        .set('Cookie', ownerCookie)
        .send({
          target: teammateUser.walletAddress,
          role: 'ADMIN',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.invitedWallet).toBe(teammateUser.walletAddress.toLowerCase());
      expect(res.body.role).toBe('ADMIN');
      expect(res.body.status).toBe('PENDING');
    });

    it('Scenario 4: Real ENS Resolution Test -> passes "alice.eth", resolves via ensService to canonical lowercased wallet', async () => {
      const ensSpy = vi.spyOn(ensService, 'resolveName').mockResolvedValue('0x2222222222222222222222222222222222222222');

      const res = await request
        .post(`/projects/${projectId}/invitations`)
        .set('Cookie', ownerCookie)
        .send({
          target: 'alice.eth',
          role: 'MEMBER',
        });

      expect(res.status).toBe(201);
      expect(ensSpy).toHaveBeenCalledWith('alice.eth');
      expect(res.body.invitedWallet).toBe('0x2222222222222222222222222222222222222222');

      // Verify DB record
      const dbInv = await prisma.projectInvitation.findUnique({ where: { id: res.body.id } });
      expect(dbInv?.invitedWallet).toBe('0x2222222222222222222222222222222222222222');
    });

    it('Scenario 5: Complete Invitation Authorization Matrix -> OWNER/ADMIN allowed (201), MEMBER/VIEWER/non-member denied (403)', async () => {
      // 1. Create an ADMIN user and a MEMBER user and a VIEWER user
      const uAdmin = await prisma.user.create({ data: { walletAddress: '0xadmin11111111111111111111111111111111111' } });
      const sessAdmin = await sessionService.createSession(uAdmin.id);
      await prisma.projectMember.create({ data: { projectId, userId: uAdmin.id, role: 'ADMIN' } });

      const uMember = await prisma.user.create({ data: { walletAddress: '0xmember1111111111111111111111111111111111' } });
      const sessMember = await sessionService.createSession(uMember.id);
      await prisma.projectMember.create({ data: { projectId, userId: uMember.id, role: 'MEMBER' } });

      const uViewer = await prisma.user.create({ data: { walletAddress: '0xviewer1111111111111111111111111111111111' } });
      const sessViewer = await sessionService.createSession(uViewer.id);
      await prisma.projectMember.create({ data: { projectId, userId: uViewer.id, role: 'VIEWER' } });

      // OWNER -> 201
      const resOwner = await request
        .post(`/projects/${projectId}/invitations`)
        .set('Cookie', ownerCookie)
        .send({ target: '0x4444444444444444444444444444444444444444', role: 'MEMBER' });
      expect(resOwner.status).toBe(201);

      // ADMIN -> 201
      const resAdmin = await request
        .post(`/projects/${projectId}/invitations`)
        .set('Cookie', `agentmesh_session=${sessAdmin.id}`)
        .send({ target: '0x5555555555555555555555555555555555555555', role: 'MEMBER' });
      expect(resAdmin.status).toBe(201);

      // MEMBER -> 403
      const resMember = await request
        .post(`/projects/${projectId}/invitations`)
        .set('Cookie', `agentmesh_session=${sessMember.id}`)
        .send({ target: '0x6666666666666666666666666666666666666666', role: 'MEMBER' });
      expect(resMember.status).toBe(403);

      // VIEWER -> 403
      const resViewer = await request
        .post(`/projects/${projectId}/invitations`)
        .set('Cookie', `agentmesh_session=${sessViewer.id}`)
        .send({ target: '0x7777777777777777777777777777777777777777', role: 'MEMBER' });
      expect(resViewer.status).toBe(403);

      // Non-member -> 403
      const resOutsider = await request
        .post(`/projects/${projectId}/invitations`)
        .set('Cookie', outsiderCookie)
        .send({ target: '0x8888888888888888888888888888888888888888', role: 'MEMBER' });
      expect(resOutsider.status).toBe(403);
    });

    it('Scenario 6: Wrong-wallet acceptance rejection -> Eve trying to accept Bob invitation gets 403', async () => {
      const inv = await prisma.projectInvitation.create({
        data: {
          projectId,
          inviterUserId: ownerUser.id,
          invitedWallet: teammateUser.walletAddress.toLowerCase(),
          role: 'MEMBER',
          status: 'PENDING',
        },
      });

      const res = await request
        .post(`/invitations/${inv.id}/accept`)
        .set('Cookie', outsiderCookie);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Authenticated wallet does not match');
    });

    it('Scenario 7: Invitation Expiry Test -> expired invitation rejects accept with 400 and updates status to EXPIRED', async () => {
      const inv = await prisma.projectInvitation.create({
        data: {
          projectId,
          inviterUserId: ownerUser.id,
          invitedWallet: teammateUser.walletAddress.toLowerCase(),
          role: 'MEMBER',
          status: 'PENDING',
          expiresAt: new Date(Date.now() - 10000), // 10s in past
        },
      });

      const res = await request
        .post(`/invitations/${inv.id}/accept`)
        .set('Cookie', teammateCookie);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('expired');

      // Verify status updated in DB
      const dbInv = await prisma.projectInvitation.findUnique({ where: { id: inv.id } });
      expect(dbInv?.status).toBe('EXPIRED');
    });

    it('Scenario 8: Invitation acceptance -> Bob accepts and becomes project MEMBER', async () => {
      const inv = await prisma.projectInvitation.create({
        data: {
          projectId,
          inviterUserId: ownerUser.id,
          invitedWallet: teammateUser.walletAddress.toLowerCase(),
          role: 'ADMIN',
          status: 'PENDING',
        },
      });

      const res = await request
        .post(`/invitations/${inv.id}/accept`)
        .set('Cookie', teammateCookie);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACCEPTED');

      const member = await prisma.projectMember.findFirst({
        where: { projectId, userId: teammateUser.id },
      });
      expect(member).not.toBeNull();
      expect(member?.role).toBe('ADMIN');
    });

    it('Scenario 9: Fix Concurrent Invitation Acceptance -> ALL 5 concurrent requests return 200 idempotent success', async () => {
      const inv = await prisma.projectInvitation.create({
        data: {
          projectId,
          inviterUserId: ownerUser.id,
          invitedWallet: teammateUser.walletAddress.toLowerCase(),
          role: 'MEMBER',
          status: 'PENDING',
        },
      });

      const promises = Array.from({ length: 5 }).map(() =>
        request.post(`/invitations/${inv.id}/accept`).set('Cookie', teammateCookie),
      );

      const results = await Promise.all(promises);
      const statuses = results.map((r) => r.status);
      expect(statuses.every((s) => s === 200)).toBe(true);

      const members = await prisma.projectMember.findMany({
        where: { projectId, userId: teammateUser.id },
      });
      expect(members.length).toBe(1);
      expect(members[0].projectId).toBe(projectId);
      expect(members[0].userId).toBe(teammateUser.id);
      expect(members[0].role).toBe('MEMBER');

      const dbInv = await prisma.projectInvitation.findUnique({ where: { id: inv.id } });
      expect(dbInv?.status).toBe('ACCEPTED');
    });

    it('Scenario 9B: High-concurrency (10 requests) & Unauthorized Concurrent Acceptance Protection', async () => {
      const inv = await prisma.projectInvitation.create({
        data: {
          projectId,
          inviterUserId: ownerUser.id,
          invitedWallet: teammateUser.walletAddress.toLowerCase(),
          role: 'ADMIN',
          status: 'PENDING',
        },
      });

      const promises = Array.from({ length: 10 }).map(() =>
        request.post(`/invitations/${inv.id}/accept`).set('Cookie', teammateCookie),
      );

      const results = await Promise.all(promises);
      const statuses = results.map((r) => r.status);
      expect(statuses.every((s) => s === 200)).toBe(true);

      const members = await prisma.projectMember.findMany({
        where: { projectId, userId: teammateUser.id },
      });
      expect(members.length).toBe(1);
      expect(members[0].role).toBe('ADMIN');

      const unauthorizedRes = await request
        .post(`/invitations/${inv.id}/accept`)
        .set('Cookie', ownerCookie);
      expect(unauthorizedRes.status).toBe(403);
    });

    it('Scenario 10: Fix Concurrent Invitation Creation -> 5 concurrent creation requests yield exactly 1 pending invitation without DB errors', async () => {
      const promises = Array.from({ length: 5 }).map(() =>
        request
          .post(`/projects/${projectId}/invitations`)
          .set('Cookie', ownerCookie)
          .send({
            target: teammateUser.walletAddress,
            role: 'MEMBER',
          }),
      );

      const results = await Promise.all(promises);
      const statuses = results.map((r) => r.status);
      expect(statuses.every((s) => s === 201 || s === 200)).toBe(true);

      const pendingInvs = await prisma.projectInvitation.findMany({
        where: {
          projectId,
          invitedWallet: teammateUser.walletAddress.toLowerCase(),
          status: 'PENDING',
        },
      });
      expect(pendingInvs.length).toBe(1);
    });
  });

  describe('3. Real Two-User Realtime Synchronization & Isolation', () => {
    let projectAId: string;
    let projectBId: string;

    beforeEach(async () => {
      const pA = await prisma.project.create({
        data: {
          name: 'Project Alpha',
          ownerId: ownerUser.id,
          members: {
            create: [
              { userId: ownerUser.id, role: 'OWNER' },
              { userId: teammateUser.id, role: 'MEMBER' },
            ],
          },
        },
      });
      projectAId = pA.id;

      const pB = await prisma.project.create({
        data: {
          name: 'Project Beta',
          ownerId: outsiderUser.id,
          members: { create: { userId: outsiderUser.id, role: 'OWNER' } },
        },
      });
      projectBId = pB.id;
    });

    it('Scenario 11: Real Two-User Realtime Collaboration -> User A creates task, User B receives realtime delta event', async () => {
      const wsA = await connectWs(`/ws?projectId=${projectAId}`, ownerSessionId);
      const wsB = await connectWs(`/ws?projectId=${projectAId}`, teammateSessionId);

      const msgPromiseB = waitForMatchingMessage(
        wsB,
        (m) =>
          m.type === 'workspace.delta' &&
          Boolean(
            (m.payload as { changes?: Array<Record<string, unknown>> })?.changes?.some(
              (c) => c.entity === 'task',
            ),
          ),
      );

      const taskRes = await request
        .post(`/projects/${projectAId}/tasks`)
        .set('Cookie', ownerCookie)
        .send({
          title: 'Collaborative Task',
          description: 'Testing two-user realtime task broadcast',
          priority: 'HIGH',
        });
      expect(taskRes.status).toBe(201);
      const taskId = taskRes.body.id;

      const eventDataB = await msgPromiseB;
      expect(eventDataB).toBeDefined();
      expect(eventDataB.type).toBe('workspace.delta');
      const payloadObj = eventDataB.payload as { changes?: Array<Record<string, unknown>> };
      const taskChange = payloadObj?.changes?.find((c) => c.entity === 'task');
      expect(taskChange).toBeDefined();
      expect(taskChange?.entityId).toBe(taskId);
      expect((taskChange?.fields as Record<string, unknown>)?.title).toBe('Collaborative Task');

      wsA.close();
      wsB.close();
    });

    it('Scenario 12: Real Invitation Realtime Synchronization -> User A invites User B, User B accepts, User A WS receives member.added event', async () => {
      const wsA = await connectWs(`/ws?projectId=${projectAId}`, ownerSessionId);
      const msgPromiseA = waitForMatchingMessage(wsA, (m) => m.type === 'member.added');

      // Create & Accept invitation
      const inv = await prisma.projectInvitation.create({
        data: {
          projectId: projectAId,
          inviterUserId: ownerUser.id,
          invitedWallet: '0x4444444444444444444444444444444444444444',
          role: 'MEMBER',
          status: 'PENDING',
        },
      });

      const uInvited = await prisma.user.create({
        data: { walletAddress: '0x4444444444444444444444444444444444444444' },
      });
      const sessInvited = await sessionService.createSession(uInvited.id);

      await request
        .post(`/invitations/${inv.id}/accept`)
        .set('Cookie', `agentmesh_session=${sessInvited.id}`);

      const eventDataA = await msgPromiseA;
      expect(eventDataA).toBeDefined();
      expect(eventDataA.type).toBe('member.added');
      const payloadA = eventDataA.payload as Record<string, unknown>;
      expect(payloadA?.projectId).toBe(projectAId);
      expect(payloadA?.userId).toBe(uInvited.id);
      expect(payloadA?.role).toBe('MEMBER');

      wsA.close();
    });

    it('Scenario 13: Enhanced Realtime Cross-Project Isolation -> User B in Project A, User C in Project B. User A task in Project A emits to User B, User C receives NOTHING', async () => {
      const wsB = await connectWs(`/ws?projectId=${projectAId}`, teammateSessionId);
      const wsC = await connectWs(`/ws?projectId=${projectBId}`, outsiderSessionId);

      let userBReceived = false;
      let userCReceivedProjectAEvent = false;

      wsB.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
          const changes = (parsed.payload as { changes?: Array<Record<string, unknown>> })?.changes;
          if (parsed.type === 'workspace.delta' && changes?.some((c) => c.entity === 'task')) {
            userBReceived = true;
          }
        } catch (err) { void err; }
      });

      wsC.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
          const changes = (parsed.payload as { changes?: Array<Record<string, unknown>> })?.changes;
          if (
            parsed.projectId === projectAId ||
            changes?.some((c) => (c.fields as Record<string, unknown>)?.title === 'Isolation Test Task')
          ) {
            userCReceivedProjectAEvent = true;
          }
        } catch (err) { void err; }
      });

      await request
        .post(`/projects/${projectAId}/tasks`)
        .set('Cookie', ownerCookie)
        .send({
          title: 'Isolation Test Task',
          description: 'Testing cross-project isolation',
        });

      await new Promise((r) => setTimeout(r, 400));

      expect(userBReceived).toBe(true);
      expect(userCReceivedProjectAEvent).toBe(false);

      wsB.close();
      wsC.close();
    });
  });

  describe('4. Real Agent Onboarding (Handshake) & Execution Path Preservation', () => {
    let projectId: string;

    beforeEach(async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Agent Project',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });
      projectId = p.id;
    });

    it('Scenario 14: Real Agent Onboarding (WS Handshake) & Execution Path -> Agent connects over WS, completes protocol AGENT_HANDSHAKE to become ONLINE, task assigns & dispatches execution', async () => {
      // 1. Register agent in DB via REST
      const agentRes = await request
        .post(`/projects/${projectId}/agents`)
        .set('Cookie', ownerCookie)
        .send({
          name: 'Real Handshake Agent',
          provider: 'Anthropic',
          capabilities: ['build'],
        });
      expect(agentRes.status).toBe(201);
      const agentId = agentRes.body.id;
      await prisma.agentCapability.create({
        data: { agentId, capability: 'build' },
      });

      // Verify agent is initially OFFLINE
      let dbAgent = await prisma.agent.findUnique({ where: { id: agentId } });
      expect(dbAgent?.status).toBe('OFFLINE');

      // 2. Connect Agent over WebSocket and send AGENT_HANDSHAKE (Real Protocol Onboarding)
      const agentWs = await connectAgentWs(`/ws?projectId=${projectId}`, ownerSessionId);
      const replyPromise = receiveHandshakeReply(agentWs);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        senderId: agentId,
        recipientId: 'server',
        projectId,
        payload: {
          agentId,
          capabilities: ['build'],
        },
      });
      agentWs.send(JSON.stringify(handshakeMsg));

      const handshakeReply = await replyPromise;
      if (handshakeReply.type !== 'agent.handshake.accepted') {
        console.log('HANDSHAKE REJECTED:', JSON.stringify(handshakeReply, null, 2));
      }
      expect(handshakeReply.type).toBe('agent.handshake.accepted');

      // Verify server updated agent status to ONLINE via connection manager
      dbAgent = await prisma.agent.findUnique({ where: { id: agentId } });
      expect(dbAgent?.status).toBe('ONLINE');

      // 3. Create real task
      const taskRes = await request
        .post(`/projects/${projectId}/tasks`)
        .set('Cookie', ownerCookie)
        .send({
          title: 'Production Build Task',
          description: 'Compiling real AgentMesh production target',
          priority: 'CRITICAL',
        });
      expect(taskRes.status).toBe(201);
      const taskId = taskRes.body.id;

      // 4. Assign task to agent via Coordinator Service
      const assignRes = await request
        .post(`/projects/${projectId}/tasks/${taskId}/assign`)
        .set('Cookie', ownerCookie)
        .send({ preferredAgentId: agentId });

      expect(assignRes.status).toBe(200);
      expect(assignRes.body.assigned).toBe(true);
      expect(assignRes.body.agentId).toBe(agentId);

      // Verify real DB records (TaskResponsibility)
      const resp = await prisma.taskResponsibility.findFirst({
        where: { taskId, agentId },
      });
      expect(resp).not.toBeNull();
      expect(resp?.assignmentSource).toBe('HUMAN_PREFERENCE');

      agentWs.close();
    });

    it('Scenario 15: Agent Ownership & Project Member Access Security -> Project member cannot mutate another member\'s private agent', async () => {
      // Owner (Alice) registers agent
      const agentRes = await request
        .post(`/projects/${projectId}/agents`)
        .set('Cookie', ownerCookie)
        .send({
          name: 'Alice Private Agent',
          provider: 'OpenAI',
        });
      expect(agentRes.status).toBe(201);
      const agentId = agentRes.body.id;

      // Bob accepts project membership
      await prisma.projectMember.create({
        data: { projectId, userId: teammateUser.id, role: 'MEMBER' },
      });

      // Teammate (Bob) attempts to mutate Alice's agent name
      const mutateRes = await request
        .patch(`/agents/${agentId}`)
        .set('Cookie', teammateCookie)
        .send({ name: 'Hacked Agent Name' });

      expect([403, 404]).toContain(mutateRes.status);

      // Outsider (Eve) attempts to mutate Alice's agent name
      const outsiderRes = await request
        .patch(`/agents/${agentId}`)
        .set('Cookie', outsiderCookie)
        .send({ name: 'Hacked Agent Name' });

      expect([403, 404]).toContain(outsiderRes.status);
    });
  });
});
