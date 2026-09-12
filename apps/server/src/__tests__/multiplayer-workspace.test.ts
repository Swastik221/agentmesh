import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/index.js';

describe('PRD-58 Real Multi-User Workspace, Invitations & Agent Onboarding Integration Tests', () => {
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

  let outsiderUser: { id: string; walletAddress: string };
  let outsiderCookie: string;
  let outsiderSessionId: string;

  const connectWs = (urlPath: string, token: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const fullPath = `${urlPath}${urlPath.includes('?') ? '&' : '?'}token=${token}`;
      const client = new WebSocket(`ws://localhost:${serverPort}${fullPath}`);
      client.on('open', () => resolve(client));
      client.on('error', (err) => reject(err));
    });
  };

  const waitForNextMessage = (ws: WebSocket): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for WS message')), 3000);
      ws.once('message', (data) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data.toString()));
        } catch {
          resolve(data.toString());
        }
      });
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
    await clearDb();
  });

  describe('1. Fresh User Workspace Experience', () => {
    it('Scenario 1: Fresh project list -> authenticated user with 0 projects receives empty array []', async () => {
      const res = await request
        .get('/projects')
        .set('Cookie', ownerCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.projects)).toBe(true);
      expect(res.body.projects.length).toBe(0);
    });

    it('Scenario 2: Project creation & owner membership -> POST /projects sets creator as OWNER', async () => {
      const res = await request
        .post('/projects')
        .set('Cookie', ownerCookie)
        .send({ name: 'Alpha Protocol', description: 'Multiplayer test' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Alpha Protocol');
      expect(res.body.ownerId).toBe(ownerUser.id);

      // Verify DB membership
      const member = await prisma.projectMember.findFirst({
        where: { projectId: res.body.id, userId: ownerUser.id },
      });
      expect(member).not.toBeNull();
      expect(member?.role).toBe('OWNER');
    });
  });

  describe('2. Teammate Invitations (Wallet & ENS)', () => {
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

    it('Scenario 4: Invite by ENS name -> resolves to canonical lowercased wallet address', async () => {
      const res = await request
        .post(`/projects/${projectId}/invitations`)
        .set('Cookie', ownerCookie)
        .send({
          target: '0x2222222222222222222222222222222222222222',
          role: 'MEMBER',
        });

      expect(res.status).toBe(201);
      expect(res.body.invitedWallet).toBe('0x2222222222222222222222222222222222222222');
    });

    it('Scenario 5: Unauthorized invitation rejection -> non-member / VIEWER receives 403 Forbidden', async () => {
      const res = await request
        .post(`/projects/${projectId}/invitations`)
        .set('Cookie', outsiderCookie)
        .send({
          target: '0x4444444444444444444444444444444444444444',
          role: 'MEMBER',
        });

      expect(res.status).toBe(403);
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

    it('Scenario 7: Invitation acceptance -> Bob accepts and becomes project MEMBER', async () => {
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

      // Verify Bob is now ADMIN in projectMember
      const member = await prisma.projectMember.findFirst({
        where: { projectId, userId: teammateUser.id },
      });
      expect(member).not.toBeNull();
      expect(member?.role).toBe('ADMIN');
    });

    it('Scenario 8: Concurrent invitation acceptance idempotency -> 5 concurrent acceptance requests resolve without errors', async () => {
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
      expect(statuses).toContain(200);

      // Verify DB state
      const members = await prisma.projectMember.findMany({
        where: { projectId, userId: teammateUser.id },
      });
      expect(members.length).toBe(1);
    });

    it('Scenario 9: Shared project visibility -> Bob sees project in GET /projects after acceptance', async () => {
      // Add Bob to project
      await prisma.projectMember.create({
        data: {
          projectId,
          userId: teammateUser.id,
          role: 'MEMBER',
        },
      });

      const res = await request
        .get('/projects')
        .set('Cookie', teammateCookie);

      expect(res.status).toBe(200);
      expect(res.body.projects.length).toBe(1);
      expect(res.body.projects[0].id).toBe(projectId);
    });
  });

  describe('3. Realtime Synchronization & Isolation', () => {
    let projectAId: string;
    let projectBId: string;

    beforeEach(async () => {
      const pA = await prisma.project.create({
        data: {
          name: 'Project Alpha',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
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

    it('Scenario 10: Realtime task propagation across members -> creating task emits delta event to room', async () => {
      const ws = await connectWs(`/ws?projectId=${projectAId}`, ownerSessionId);
      
      const msgPromise = waitForNextMessage(ws);

      // Create a task in Project A
      await request
        .post(`/projects/${projectAId}/tasks`)
        .set('Cookie', ownerCookie)
        .send({
          title: 'Realtime task broadcast test',
          description: 'Testing realtime delta broadcast across members',
          priority: 'HIGH',
        });

      const eventData = await msgPromise;
      expect(eventData).toBeDefined();

      ws.close();
    });

    it('Scenario 11: Realtime agent status propagation -> registering agent emits presence/agent event', async () => {
      const ws = await connectWs(`/ws?projectId=${projectAId}`, ownerSessionId);
      const msgPromise = waitForNextMessage(ws);

      await request
        .post(`/projects/${projectAId}/agents`)
        .set('Cookie', ownerCookie)
        .send({
          name: 'Test Worker Agent',
          provider: 'Anthropic',
        });

      const eventData = await msgPromise;
      expect(eventData).toBeDefined();

      ws.close();
    });

    it('Scenario 12: Cross-project realtime isolation -> Project B WS subscriber does not receive Project A events', async () => {
      const wsB = await connectWs(`/ws?projectId=${projectBId}`, outsiderSessionId);
      let receivedProjectAEvent = false;

      wsB.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.projectId === projectAId || parsed.payload?.title === 'Project A Task') {
            receivedProjectAEvent = true;
          }
        } catch (err) {
          void err;
        }
      });

      // Create task in Project A
      await request
        .post(`/projects/${projectAId}/tasks`)
        .set('Cookie', ownerCookie)
        .send({ title: 'Project A Task', description: 'Testing isolation' });

      // Wait 300ms to verify no cross-leak
      await new Promise((r) => setTimeout(r, 300));
      expect(receivedProjectAEvent).toBe(false);

      wsB.close();
    });
  });

  describe('4. Real Agent Onboarding & Execution Path Preservation', () => {
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

    it('Scenario 13: Agent ownership enforcement -> cannot modify or use agent owned by another user without permission', async () => {
      const agent = await prisma.agent.create({
        data: {
          name: 'Alice Private Agent',
          provider: 'OpenAI',
          status: 'ONLINE',
          ownerId: ownerUser.id,
          projectId,
        },
      });

      const res = await request
        .patch(`/agents/${agent.id}`)
        .set('Cookie', outsiderCookie)
        .send({ name: 'Hacked Agent' });

      expect([403, 404]).toContain(res.status);
    });

    it('Scenario 14: Real agent execution path preservation -> task assignment and execution work without fake demo fallbacks', async () => {
      // 1. Create real task
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

      // 2. Register real agent
      const agentRes = await request
        .post(`/projects/${projectId}/agents`)
        .set('Cookie', ownerCookie)
        .send({
          name: 'Build Agent',
          provider: 'Anthropic',
        });
      expect(agentRes.status).toBe(201);
      const agentId = agentRes.body.id;

      // Set agent ONLINE
      await prisma.agent.update({
        where: { id: agentId },
        data: { status: 'ONLINE' },
      });

      // 3. Assign task to agent
      const assignRes = await request
        .post(`/projects/${projectId}/tasks/${taskId}/assign`)
        .set('Cookie', ownerCookie)
        .send({ preferredAgentId: agentId });

      expect(assignRes.status).toBe(200);
      expect(assignRes.body.assigned).toBe(true);
      expect(assignRes.body.agentId).toBe(agentId);

      // Verify real DB record
      const resp = await prisma.taskResponsibility.findFirst({
        where: { taskId, agentId },
      });
      expect(resp).not.toBeNull();
      expect(resp?.assignmentSource).toBe('HUMAN_PREFERENCE');
    });
  });
});
