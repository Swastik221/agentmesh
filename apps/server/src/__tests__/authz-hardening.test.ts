import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { paymentService } from '../payments/payment.service.js';
import { assertManualStatusTransition } from '../tasks/task.service.js';
import { isAllowedWsOrigin } from '../websocket/websocket.server.js';
import { config } from '../config/index.js';
import { PAYMENT_CONFIG } from '../payments/payment.config.js';

const app = createApp();

/**
 * Regression tests for the authorization holes closed in fix/authz-hardening.
 * Each test is phrased as the attack it prevents.
 *
 * Fixture: `owner` created Project A. `member` is a MEMBER of A. `outsider`
 * owns Project B and has no access to A.
 */
describe('Authorization hardening', () => {
  let owner: { id: string };
  let member: { id: string };
  let outsider: { id: string };
  let ownerCookie: string[];
  let memberCookie: string[];
  let outsiderCookie: string[];
  let projectA: { id: string };
  let projectB: { id: string };
  let agentA: { id: string };
  let agentB: { id: string };

  const cookieFor = (sessionId: string) => [`agentmesh_session=${sessionId}`];

  beforeEach(async () => {
    await prisma.payment.deleteMany();
    await prisma.activityEvent.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.policy.deleteMany();
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

    owner = await prisma.user.create({
      data: { walletAddress: '0xa000000000000000000000000000000000000001', displayName: 'Owner' },
    });
    member = await prisma.user.create({
      data: { walletAddress: '0xa000000000000000000000000000000000000002', displayName: 'Member' },
    });
    outsider = await prisma.user.create({
      data: { walletAddress: '0xa000000000000000000000000000000000000003', displayName: 'Outsider' },
    });
    ownerCookie = cookieFor((await sessionService.createSession(owner.id)).id);
    memberCookie = cookieFor((await sessionService.createSession(member.id)).id);
    outsiderCookie = cookieFor((await sessionService.createSession(outsider.id)).id);

    projectA = await prisma.project.create({
      data: {
        name: 'Project A',
        ownerId: owner.id,
        members: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    });
    projectB = await prisma.project.create({
      data: {
        name: 'Project B',
        ownerId: outsider.id,
        members: { create: { userId: outsider.id, role: 'OWNER' } },
      },
    });

    agentA = await prisma.agent.create({
      data: { projectId: projectA.id, ownerId: owner.id, name: 'Agent A', provider: 'test', status: 'ONLINE' },
    });
    agentB = await prisma.agent.create({
      data: { projectId: projectB.id, ownerId: outsider.id, name: 'Agent B', provider: 'test', status: 'ONLINE' },
    });
  });

  describe('member management', () => {
    it('a MEMBER cannot promote themselves to OWNER', async () => {
      const res = await request(app)
        .patch(`/projects/${projectA.id}/members/${member.id}`)
        .set('Cookie', memberCookie)
        .send({ role: 'OWNER' });
      expect(res.status).toBe(403);
      const row = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: projectA.id, userId: member.id } },
      });
      expect(row?.role).toBe('MEMBER');
    });

    it('a MEMBER cannot remove the project creator', async () => {
      const res = await request(app)
        .delete(`/projects/${projectA.id}/members/${owner.id}`)
        .set('Cookie', memberCookie);
      expect(res.status).toBe(403);
    });

    it('a MEMBER cannot add someone else as a member', async () => {
      const res = await request(app)
        .post(`/projects/${projectA.id}/members`)
        .set('Cookie', memberCookie)
        .send({ userId: outsider.id, role: 'MEMBER' });
      expect(res.status).toBe(403);
    });

    it('an ADMIN can add MEMBERs but cannot grant OWNER', async () => {
      await prisma.projectMember.update({
        where: { projectId_userId: { projectId: projectA.id, userId: member.id } },
        data: { role: 'ADMIN' },
      });
      const grantOwner = await request(app)
        .post(`/projects/${projectA.id}/members`)
        .set('Cookie', memberCookie)
        .send({ userId: outsider.id, role: 'OWNER' });
      expect(grantOwner.status).toBe(403);

      const addMember = await request(app)
        .post(`/projects/${projectA.id}/members`)
        .set('Cookie', memberCookie)
        .send({ userId: outsider.id, role: 'MEMBER' });
      expect(addMember.status).toBe(201);
    });

    it('a co-OWNER cannot remove the project creator', async () => {
      await prisma.projectMember.update({
        where: { projectId_userId: { projectId: projectA.id, userId: member.id } },
        data: { role: 'OWNER' },
      });
      const res = await request(app)
        .delete(`/projects/${projectA.id}/members/${owner.id}`)
        .set('Cookie', memberCookie);
      expect(res.status).toBe(403);
    });

    it('a MEMBER can still leave the project', async () => {
      const res = await request(app)
        .delete(`/projects/${projectA.id}/members/${member.id}`)
        .set('Cookie', memberCookie);
      expect(res.status).toBe(200);
    });

    it('the OWNER can still change roles', async () => {
      const res = await request(app)
        .patch(`/projects/${projectA.id}/members/${member.id}`)
        .set('Cookie', ownerCookie)
        .send({ role: 'ADMIN' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
    });
  });

  describe('policies and approvals', () => {
    it('a MEMBER cannot create, edit or delete policies', async () => {
      const create = await request(app)
        .post(`/projects/${projectA.id}/policies`)
        .set('Cookie', memberCookie)
        .send({ name: 'Allow all', action: 'task.execute', decision: 'ALLOW' });
      expect(create.status).toBe(403);

      const policy = await prisma.policy.create({
        data: { projectId: projectA.id, name: 'Gate', action: 'task.execute', decision: 'APPROVAL_REQUIRED' },
      });
      const disable = await request(app)
        .patch(`/projects/${projectA.id}/policies/${policy.id}`)
        .set('Cookie', memberCookie)
        .send({ enabled: false });
      expect(disable.status).toBe(403);

      const remove = await request(app)
        .delete(`/projects/${projectA.id}/policies/${policy.id}`)
        .set('Cookie', memberCookie);
      expect(remove.status).toBe(403);
    });

    it('a MEMBER can still read policies', async () => {
      const res = await request(app).get(`/projects/${projectA.id}/policies`).set('Cookie', memberCookie);
      expect(res.status).toBe(200);
    });

    it('a MEMBER cannot approve their own request', async () => {
      const approval = await prisma.approvalRequest.create({
        data: { projectId: projectA.id, requestedByUserId: member.id, action: 'task.execute' },
      });
      const res = await request(app)
        .post(`/approvals/${approval.id}/approve`)
        .set('Cookie', memberCookie)
        .send({});
      expect(res.status).toBe(403);
      const row = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
      expect(row?.status).toBe('PENDING');
    });

    it("the OWNER can approve a MEMBER's request", async () => {
      const approval = await prisma.approvalRequest.create({
        data: { projectId: projectA.id, requestedByUserId: member.id, action: 'custom.action' },
      });
      const res = await request(app)
        .post(`/approvals/${approval.id}/approve`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it("a MEMBER can approve another member's request", async () => {
      const approval = await prisma.approvalRequest.create({
        data: { projectId: projectA.id, requestedByUserId: owner.id, action: 'custom.action' },
      });
      const res = await request(app)
        .post(`/approvals/${approval.id}/approve`)
        .set('Cookie', memberCookie)
        .send({});
      expect(res.status).toBe(200);
    });

    it('a VIEWER cannot approve anything', async () => {
      await prisma.projectMember.update({
        where: { projectId_userId: { projectId: projectA.id, userId: member.id } },
        data: { role: 'VIEWER' },
      });
      const approval = await prisma.approvalRequest.create({
        data: { projectId: projectA.id, requestedByUserId: owner.id, action: 'custom.action' },
      });
      const res = await request(app)
        .post(`/approvals/${approval.id}/approve`)
        .set('Cookie', memberCookie)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  describe('activity feed', () => {
    it("an outsider cannot read another project's activity", async () => {
      const res = await request(app).get(`/projects/${projectA.id}/activity`).set('Cookie', outsiderCookie);
      expect(res.status).toBe(403);
    });

    it('a member can read their project activity', async () => {
      const res = await request(app).get(`/projects/${projectA.id}/activity`).set('Cookie', memberCookie);
      expect(res.status).toBe(200);
    });
  });

  describe('agent capabilities', () => {
    it("an outsider cannot list, add or remove another project's agent capabilities", async () => {
      await prisma.agentCapability.create({ data: { agentId: agentA.id, capability: 'code-review' } });

      const list = await request(app).get(`/agents/${agentA.id}/capabilities`).set('Cookie', outsiderCookie);
      expect(list.status).toBe(403);

      const add = await request(app)
        .post(`/agents/${agentA.id}/capabilities`)
        .set('Cookie', outsiderCookie)
        .send({ capability: 'evil-cap' });
      expect(add.status).toBe(403);

      const remove = await request(app)
        .delete(`/agents/${agentA.id}/capabilities/code-review`)
        .set('Cookie', outsiderCookie);
      expect(remove.status).toBe(403);
      expect(await prisma.agentCapability.count({ where: { agentId: agentA.id } })).toBe(1);
    });

    it("a MEMBER can read but not change someone else's agent capabilities", async () => {
      const list = await request(app).get(`/agents/${agentA.id}/capabilities`).set('Cookie', memberCookie);
      expect(list.status).toBe(200);

      const add = await request(app)
        .post(`/agents/${agentA.id}/capabilities`)
        .set('Cookie', memberCookie)
        .send({ capability: 'code-review' });
      expect(add.status).toBe(403);
    });

    it("the agent's owner can change its capabilities", async () => {
      const add = await request(app)
        .post(`/agents/${agentA.id}/capabilities`)
        .set('Cookie', ownerCookie)
        .send({ capability: 'code-review' });
      expect(add.status).toBe(201);
    });
  });

  describe('payments', () => {
    const settledFor = (projectId: string, requesterUserId: string, agentId: string, ref: string) =>
      prisma.payment.create({
        data: {
          projectId,
          requesterUserId,
          agentId,
          action: 'capability.execute',
          amount: PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT,
          asset: PAYMENT_CONFIG.USDC_TOKEN_ID,
          network: PAYMENT_CONFIG.NETWORK,
          receiverAddress: 'receiver',
          status: 'SETTLED',
          x402PaymentReference: ref,
          settledAt: new Date(),
        },
      });

    const requirementFor = (ref: string) => ({
      paymentReference: ref,
      amount: PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT,
      asset: PAYMENT_CONFIG.USDC_TOKEN_ID,
      network: PAYMENT_CONFIG.NETWORK,
      receiver: 'receiver',
    });

    const header = JSON.stringify({ x402Version: 2, payload: {} });

    it("rejects another project's settled payment reference instead of returning it", async () => {
      const victim = await settledFor(projectB.id, outsider.id, agentB.id, 'ref-victim');
      await expect(
        paymentService.processPaymentHeader(
          projectA.id,
          owner.id,
          header,
          requirementFor(victim.x402PaymentReference!) as never,
          agentA.id,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("rejects another member's settled payment reference in the same project", async () => {
      const theirs = await settledFor(projectA.id, owner.id, agentA.id, 'ref-owner');
      await expect(
        paymentService.processPaymentHeader(
          projectA.id,
          member.id,
          header,
          requirementFor(theirs.x402PaymentReference!) as never,
          agentA.id,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('still returns the same settled payment to its own requester (idempotent retry)', async () => {
      const mine = await settledFor(projectA.id, owner.id, agentA.id, 'ref-mine');
      const result = await paymentService.processPaymentHeader(
        projectA.id,
        owner.id,
        header,
        requirementFor(mine.x402PaymentReference!) as never,
        agentA.id,
      );
      expect(result.id).toBe(mine.id);
    });
  });

  describe('task status', () => {
    it('rejects hand-set PENDING_APPROVAL and leaving it except to cancel', () => {
      expect(() => assertManualStatusTransition('TODO', 'PENDING_APPROVAL')).toThrow();
      expect(() => assertManualStatusTransition('PENDING_APPROVAL', 'COMPLETED')).toThrow();
      expect(() => assertManualStatusTransition('PENDING_APPROVAL', 'IN_PROGRESS')).toThrow();
      expect(() => assertManualStatusTransition('PENDING_APPROVAL', 'CANCELLED')).not.toThrow();
    });

    it('treats COMPLETED and CANCELLED as final', () => {
      expect(() => assertManualStatusTransition('COMPLETED', 'IN_PROGRESS')).toThrow();
      expect(() => assertManualStatusTransition('CANCELLED', 'TODO')).toThrow();
    });

    it('still allows normal board moves', () => {
      expect(() => assertManualStatusTransition('TODO', 'IN_PROGRESS')).not.toThrow();
      expect(() => assertManualStatusTransition('TODO', 'COMPLETED')).not.toThrow();
      expect(() => assertManualStatusTransition('FAILED', 'TODO')).not.toThrow();
    });

    it('a member cannot complete a task that is waiting for approval', async () => {
      const task = await prisma.task.create({
        data: {
          projectId: projectA.id,
          creatorId: owner.id,
          title: 'Gated',
          description: 'Needs approval',
          status: 'PENDING_APPROVAL',
        },
      });
      const res = await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task.id}`)
        .set('Cookie', memberCookie)
        .send({ status: 'COMPLETED' });
      expect(res.status).toBe(409);
    });

    it("rejects pointing a task at another project's agent", async () => {
      const task = await prisma.task.create({
        data: { projectId: projectA.id, creatorId: owner.id, title: 'T', description: 'D', status: 'TODO' },
      });
      const res = await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task.id}`)
        .set('Cookie', ownerCookie)
        .send({ preferredAgentId: agentB.id });
      expect(res.status).toBe(400);
    });
  });

  describe('websocket origin', () => {
    it('accepts only the configured web origin', () => {
      expect(isAllowedWsOrigin(config.webOrigin)).toBe(true);
      expect(isAllowedWsOrigin('https://evil.example')).toBe(false);
      expect(isAllowedWsOrigin('not a url')).toBe(false);
    });
  });
});
