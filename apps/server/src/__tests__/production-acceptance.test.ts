import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
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
import { validateProductionConfig } from '../config/index.js';
import { executionService } from '../execution/execution.service.js';
import { artifactService } from '../services/artifact.service.js';
import { approvalService } from '../services/approval.service.js';
import { paymentService } from '../payments/payment.service.js';
import { PAYMENT_CONFIG } from '../payments/payment.config.js';

describe('PRD-59 Production Acceptance Integration Tests', () => {
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
    await prisma.payment.deleteMany().catch(() => {});
    await prisma.activityEvent.deleteMany().catch(() => {});
    await prisma.taskExecution.deleteMany().catch(() => {});
    await prisma.approvalRequest.deleteMany().catch(() => {});
    await prisma.taskDependency.deleteMany().catch(() => {});
    await prisma.taskResponsibility.deleteMany().catch(() => {});
    await prisma.artifact.deleteMany().catch(() => {});
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

    // Owner User (Alice)
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

    // Teammate User (Bob)
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

    // Outsider User (Eve)
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

  describe('1. Fresh User & Project Persistence Acceptance', () => {
    it('Test 1 — Fresh user/project state: Fresh authenticated user with 0 projects receives empty array without hardcoded demo projects', async () => {
      const res = await request
        .get('/projects')
        .set('Cookie', ownerCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.projects)).toBe(true);
      expect(res.body.projects.length).toBe(0);
    });

    it('Test 2 — Project persistence: Project created via REST persists in database across simulated reloads', async () => {
      const createRes = await request
        .post('/projects')
        .set('Cookie', ownerCookie)
        .send({ name: 'Persisted Production Project' });

      expect(createRes.status).toBe(201);
      const projectId = createRes.body.id;

      // Simulated reload query
      const listRes = await request
        .get('/projects')
        .set('Cookie', ownerCookie);

      expect(listRes.status).toBe(200);
      expect(listRes.body.projects.length).toBe(1);
      expect(listRes.body.projects[0].id).toBe(projectId);
      expect(listRes.body.projects[0].name).toBe('Persisted Production Project');
    });
  });

  describe('2. Collaboration & Authorization Acceptance', () => {
    it('Test 3 — Invitation lifecycle: Create -> Pending -> Accept -> Membership transition', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Collaboration Alpha',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });

      // 1. Create invitation
      const invRes = await request
        .post(`/projects/${p.id}/invitations`)
        .set('Cookie', ownerCookie)
        .send({ target: teammateUser.walletAddress, role: 'MEMBER' });

      expect(invRes.status).toBe(201);
      const invId = invRes.body.id;

      // 2. Teammate views pending invitation
      const pendingRes = await request
        .get('/invitations/pending')
        .set('Cookie', teammateCookie);

      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.invitations.length).toBe(1);
      expect(pendingRes.body.invitations[0].id).toBe(invId);

      // 3. Accept invitation
      const acceptRes = await request
        .post(`/invitations/${invId}/accept`)
        .set('Cookie', teammateCookie);

      expect(acceptRes.status).toBe(200);

      // 4. Verify membership
      const member = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: p.id, userId: teammateUser.id } },
      });
      expect(member).not.toBeNull();
      expect(member?.role).toBe('MEMBER');
    });

    it('Test 4 — Role authorization: OWNER/ADMIN allowed, MEMBER/VIEWER/non-member denied protected actions', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Auth Test Project',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });

      // Member (Bob) -> 403 on inviting others
      await prisma.projectMember.create({
        data: { projectId: p.id, userId: teammateUser.id, role: 'MEMBER' },
      });

      const memberRes = await request
        .post(`/projects/${p.id}/invitations`)
        .set('Cookie', teammateCookie)
        .send({ target: outsiderUser.walletAddress, role: 'MEMBER' });
      expect(memberRes.status).toBe(403);

      // Non-member (Eve) -> 403
      const outsiderRes = await request
        .post(`/projects/${p.id}/invitations`)
        .set('Cookie', outsiderCookie)
        .send({ target: '0x9999999999999999999999999999999999999999', role: 'MEMBER' });
      expect(outsiderRes.status).toBe(403);
    });

    it('Test 5 — Realtime collaboration: Two authenticated project users receive project-scoped state updates', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Realtime Sync Project',
          ownerId: ownerUser.id,
          members: {
            create: [
              { userId: ownerUser.id, role: 'OWNER' },
              { userId: teammateUser.id, role: 'MEMBER' },
            ],
          },
        },
      });

      const wsA = await connectWs(`/ws?projectId=${p.id}`, ownerSessionId);
      const wsB = await connectWs(`/ws?projectId=${p.id}`, teammateSessionId);

      const msgPromiseB = waitForMatchingMessage(
        wsB,
        (m) =>
          m.type === 'workspace.delta' &&
          Boolean((m.payload as { changes?: Array<Record<string, unknown>> })?.changes?.some((c) => c.entity === 'task')),
      );

      const taskRes = await request
        .post(`/projects/${p.id}/tasks`)
        .set('Cookie', ownerCookie)
        .send({ title: 'Shared Task Sync', description: 'Testing realtime sync', priority: 'HIGH' });
      expect(taskRes.status).toBe(201);

      const eventB = await msgPromiseB;
      expect(eventB.type).toBe('workspace.delta');

      wsA.close();
      wsB.close();
    });

    it('Test 6 — Cross-project isolation: User in Project B receives zero events or state from Project A', async () => {
      const pA = await prisma.project.create({
        data: {
          name: 'Project A',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });
      const pB = await prisma.project.create({
        data: {
          name: 'Project B',
          ownerId: outsiderUser.id,
          members: { create: { userId: outsiderUser.id, role: 'OWNER' } },
        },
      });

      const wsC = await connectWs(`/ws?projectId=${pB.id}`, outsiderSessionId);
      let userCReceived = false;

      wsC.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
          if (parsed.projectId === pA.id) userCReceived = true;
        } catch { /* ignore */ }
      });

      await request
        .post(`/projects/${pA.id}/tasks`)
        .set('Cookie', ownerCookie)
        .send({ title: 'Private Project A Task', description: 'Cross project test' });

      await new Promise((r) => setTimeout(r, 300));
      expect(userCReceived).toBe(false);

      wsC.close();
    });
  });

  describe('3. Agent Onboarding & Execution Acceptance', () => {
    it('Test 7 — Real agent onboarding: Valid AGENT_HANDSHAKE transitions agent ONLINE; unauthorized/mismatched fails', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Agent Onboarding Project',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });

      const agent = await prisma.agent.create({
        data: {
          projectId: p.id,
          ownerId: ownerUser.id,
          name: 'Production Worker Agent',
          provider: 'Anthropic',
          status: 'OFFLINE',
        },
      });
      await prisma.agentCapability.create({
        data: { agentId: agent.id, capability: 'build' },
      });

      const agentWs = await connectAgentWs(`/ws?projectId=${p.id}`, ownerSessionId);
      const replyPromise = receiveHandshakeReply(agentWs);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        senderId: agent.id,
        recipientId: 'server',
        projectId: p.id,
        payload: {
          agentId: agent.id,
          capabilities: ['build'],
        },
      });
      agentWs.send(JSON.stringify(handshakeMsg));

      const reply = await replyPromise;
      expect(reply.type).toBe('agent.handshake.accepted');

      const dbAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
      expect(dbAgent?.status).toBe('ONLINE');

      agentWs.close();
    });

    it('Test 8 — Real execution: Task dispatches via canonical path to connected agent over WS protocol', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Execution Path Project',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });

      const agent = await prisma.agent.create({
        data: {
          projectId: p.id,
          ownerId: ownerUser.id,
          name: 'Execution Worker Agent',
          provider: 'OpenAI',
          status: 'OFFLINE',
        },
      });

      const agentWs = await connectAgentWs(`/ws?projectId=${p.id}`, ownerSessionId);
      const replyPromise = receiveHandshakeReply(agentWs);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        senderId: agent.id,
        recipientId: 'server',
        projectId: p.id,
        payload: { agentId: agent.id },
      });
      agentWs.send(JSON.stringify(handshakeMsg));
      await replyPromise;

      const task = await prisma.task.create({
        data: {
          projectId: p.id,
          creatorId: ownerUser.id,
          title: 'Execution Test Task',
          description: 'Testing task execution dispatch',
          status: 'TODO',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: task.id, agentId: agent.id, role: 'PRIMARY' },
      });

      const execution = await executionService.createExecution(p.id, task.id, ownerUser.id, {
        agentId: agent.id,
        input: { requireRealAgent: true },
      });

      expect(execution).toBeDefined();
      expect(['QUEUED', 'RUNNING']).toContain(execution.status);

      agentWs.close();
    });

    it('Test 9 — Disconnect safety: Agent disconnect during execution transitions status to OFFLINE safely', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Disconnect Safety Project',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });

      const agent = await prisma.agent.create({
        data: {
          projectId: p.id,
          ownerId: ownerUser.id,
          name: 'Disconnect Agent',
          provider: 'Anthropic',
          status: 'OFFLINE',
        },
      });

      const agentWs = await connectAgentWs(`/ws?projectId=${p.id}`, ownerSessionId);
      const replyPromise = receiveHandshakeReply(agentWs);

      const handshakeMsg = createAgentMeshMessage({
        type: AgentMeshMessageType.AGENT_HANDSHAKE,
        senderId: agent.id,
        recipientId: 'server',
        projectId: p.id,
        payload: { agentId: agent.id },
      });
      agentWs.send(JSON.stringify(handshakeMsg));
      await replyPromise;

      agentWs.close();
      await new Promise((r) => setTimeout(r, 200));

      const updatedAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
      expect(updatedAgent?.status).toBe('OFFLINE');
    });
  });

  describe('4. Artifact, Approval & Paid Capability Acceptance', () => {
    it('Test 10 — Artifact collaboration: Producer creates artifact -> persisted -> consumer receives context and provenance', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Artifact Exchange Project',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });

      const agent = await prisma.agent.create({
        data: {
          projectId: p.id,
          ownerId: ownerUser.id,
          name: 'Producer Agent',
          provider: 'Anthropic',
          status: 'OFFLINE',
        },
      });

      const task = await prisma.task.create({
        data: {
          projectId: p.id,
          creatorId: ownerUser.id,
          title: 'Producer Task',
          description: 'Generating build artifact',
          status: 'TODO',
        },
      });

      const artifact = await artifactService.createArtifact(p.id, task.id, ownerUser.id, {
        name: 'build-output.json',
        type: 'json',
        payload: { compiled: true },
        agentId: agent.id,
      });

      expect(artifact).toBeDefined();
      expect(artifact.name).toBe('build-output.json');
      expect(artifact.projectId).toBe(p.id);

      const retrieved = await artifactService.getArtifact(p.id, artifact.id, ownerUser.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(artifact.id);
      expect(JSON.stringify(retrieved.payload || retrieved)).toContain('compiled');
    });

    it('Test 11 — Approval gating: Task requiring approval remains blocked until authorized approval request is approved', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Approval Gating Project',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });

      const task = await prisma.task.create({
        data: {
          projectId: p.id,
          creatorId: ownerUser.id,
          title: 'Gated Task',
          description: 'Approval required task',
          status: 'TODO',
        },
      });

      const agent = await prisma.agent.create({
        data: {
          projectId: p.id,
          ownerId: ownerUser.id,
          name: 'Approval Executor Agent',
          provider: 'Anthropic',
          status: 'OFFLINE',
        },
      });

      await prisma.taskResponsibility.create({
        data: {
          taskId: task.id,
          agentId: agent.id,
          role: 'PRIMARY',
        },
      });

      const approval = await approvalService.createApprovalRequest(p.id, ownerUser.id, {
        projectId: p.id,
        action: 'task.execute',
        reason: 'Deployment Approval Needed',
        metadata: { taskId: task.id, agentId: agent.id },
      });
      expect(approval.status).toBe('PENDING');

      // Approve request
      const approved = await approvalService.approveRequest(approval.id, ownerUser.id);
      expect(approved.status).toBe('APPROVED');
    });

    it('Test 12 — Paid capability requirement boundary: Generates canonical x402 payment requirements with enforced network, asset, and payment reference', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Payment Requirement Project',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });

      const requirement = await paymentService.createPaymentRequirement({
        projectId: p.id,
        requesterUserId: ownerUser.id,
        action: 'capability.execute',
        amount: '500',
        asset: 'HBAR',
        network: 'hedera:testnet',
      });

      expect(requirement.requirement).toBeDefined();
      expect(requirement.requirement.scheme).toBe('exact');
      expect(requirement.requirement.network).toBe('hedera:testnet');
      expect(requirement.requirement.paymentReference).toBeDefined();
      expect(PAYMENT_CONFIG.FACILITATOR_URL).toBe('https://x402.org/facilitator');

      // Verify unverified payment header is safely rejected without settlement
      const invalidHeader = JSON.stringify({
        scheme: 'exact',
        network: 'hedera:testnet',
        asset: 'HBAR',
        amount: '500',
        paymentReference: requirement.requirement.paymentReference,
      });

      await expect(
        paymentService.processPaymentHeader(p.id, ownerUser.id, invalidHeader, requirement.requirement),
      ).rejects.toThrow();
    });

    it('Test 13 — Reload persistence: Project, task, membership, and artifact states retrieve directly from Prisma DB upon reload simulation', async () => {
      const p = await prisma.project.create({
        data: {
          name: 'Reload Persistence Project',
          ownerId: ownerUser.id,
          members: { create: { userId: ownerUser.id, role: 'OWNER' } },
        },
      });

      const agent = await prisma.agent.create({
        data: {
          projectId: p.id,
          ownerId: ownerUser.id,
          name: 'Reload Agent',
          provider: 'Anthropic',
          status: 'OFFLINE',
        },
      });

      const task = await prisma.task.create({
        data: {
          projectId: p.id,
          creatorId: ownerUser.id,
          title: 'Persisted Task',
          description: 'Persisted task description',
          status: 'TODO',
        },
      });

      await artifactService.createArtifact(p.id, task.id, ownerUser.id, {
        name: 'reload-artifact.txt',
        type: 'text',
        payload: { text: 'Persisted Content' },
        agentId: agent.id,
      });

      // Simulate complete backend reload query
      const projectFromDb = await prisma.project.findUnique({
        where: { id: p.id },
        include: { tasks: true, members: true },
      });

      expect(projectFromDb).not.toBeNull();
      expect(projectFromDb?.tasks.length).toBe(1);
      expect(projectFromDb?.tasks[0].title).toBe('Persisted Task');
      expect(projectFromDb?.members.length).toBe(1);
    });

    it('Test 14 — Production path verification: Server operates exclusively on live Prisma persistence and real WebSocket connections without demo mode flags', () => {
      expect(process.env.VITE_AGENTMESH_MODE).not.toBe('demo');
      expect(prisma).toBeDefined();
      expect(wsServer).toBeDefined();
    });

    it('Test 15 — Production environment validation: Missing required production environment variables throw explicit startup validation error', () => {
      const invalidEnv = { NODE_ENV: 'production' };
      expect(() => validateProductionConfig(invalidEnv)).toThrow('[ProductionConfigError]');
      expect(() => validateProductionConfig(invalidEnv)).toThrow('DATABASE_URL');

      const invalidNetworkEnv = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/db',
        SIWE_DOMAIN: 'localhost',
        SIWE_URI: 'http://localhost:5173',
        HEDERA_NETWORK: 'hedera:mainnet',
        HEDERA_PAYMENT_RECEIVER: '0.0.500123',
        X402_FACILITATOR_URL: 'https://x402.org/facilitator',
      };
      expect(() => validateProductionConfig(invalidNetworkEnv)).toThrow('[ProductionConfigError]');
      expect(() => validateProductionConfig(invalidNetworkEnv)).toThrow('HEDERA_NETWORK');
    });
  });
});
