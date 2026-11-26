import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService, hashSessionToken } from '../auth/session.service.js';
import { approvalService } from '../services/approval.service.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { config } from '../config/index.js';
import { clearDatabase, makeUser } from './helpers/ws-harness.js';

const app = createApp();

describe('Security hardening: sessions, cleanup, rate limits, approval resume', () => {
  let alice: { id: string; cookie: string; sessionId: string };
  let bob: { id: string; cookie: string; sessionId: string };
  let projectId: string;
  let agentId: string;

  beforeEach(async () => {
    await clearDatabase();
    await prisma.siweNonce.deleteMany();
    resetRateLimits();
    alice = await makeUser('0xe100000000000000000000000000000000000001', 'Alice');
    bob = await makeUser('0xe100000000000000000000000000000000000002', 'Bob');
    projectId = (
      await prisma.project.create({
        data: { name: 'P', ownerId: alice.id, members: { create: [{ userId: alice.id, role: 'OWNER' }, { userId: bob.id, role: 'MEMBER' }] } },
      })
    ).id;
    agentId = (await prisma.agent.create({ data: { projectId, ownerId: alice.id, name: 'Claude', provider: 'claude-code' } })).id;
  });

  describe('session tokens', () => {
    it('stores only a hash of the cookie token, and the token still signs you in', async () => {
      const session = await sessionService.createSession(alice.id);
      const rows = await prisma.authSession.findMany({ where: { userId: alice.id } });
      expect(rows.some((r) => r.id === session.id)).toBe(false);
      expect(rows.some((r) => r.tokenHash === hashSessionToken(session.id))).toBe(true);
      expect(session.id.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url

      await request(app).get('/auth/me').set('Cookie', `agentmesh_session=${session.id}`).expect(200);
      // The stored hash is not itself a credential.
      const hash = hashSessionToken(session.id);
      await request(app).get('/auth/me').set('Cookie', `agentmesh_session=${hash}`).expect(401);
    });

    it('expired sessions, nonces and agent tokens are purged', async () => {
      await prisma.authSession.create({ data: { userId: alice.id, expiresAt: new Date(Date.now() - 1000), tokenHash: 'old' } });
      await prisma.authSession.create({ data: { userId: alice.id, expiresAt: new Date(Date.now() + 60_000) } }); // pre-hashing row
      await prisma.siweNonce.create({ data: { nonce: 'stale-nonce-1', expiresAt: new Date(Date.now() - 1000) } });
      await prisma.agentConnectToken.create({
        data: { tokenHash: 'expired-token', agentId, projectId, issuedByUserId: alice.id, expiresAt: new Date(Date.now() - 1000) },
      });
      const purged = await sessionService.purgeExpired();
      expect(purged).toEqual({ sessions: 2, nonces: 1, tokens: 1 });
      // Live sessions survive.
      await request(app).get('/auth/me').set('Cookie', alice.cookie).expect(200);
    });
  });

  describe('rate limits', () => {
    it('caps sign-in nonce requests per client', async () => {
      for (let i = 0; i < config.rateLimits.nonce; i++) {
        await request(app).get('/auth/nonce').expect(200);
      }
      const limited = await request(app).get('/auth/nonce').expect(429);
      expect(limited.body.error).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('approval resume', () => {
    const pendingExecution = async (taskId: string) =>
      prisma.approvalRequest.create({
        data: { projectId, requestedByUserId: alice.id, action: 'task.execute', agentId, metadata: { taskId, agentId } },
      });

    it('a failed resume leaves the approval FAILED and retryable, never silently APPROVED', async () => {
      const approval = await pendingExecution('task-that-does-not-exist');
      const res = await request(app).post(`/approvals/${approval.id}/approve`).set('Cookie', bob.cookie).send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
      const row = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
      expect(row).toMatchObject({ status: 'APPROVED', resumeStatus: 'FAILED', resumeAttempts: 1 });
      expect(row?.resumeError).toBeTruthy();

      // Fix the cause, then retry explicitly.
      const task = await prisma.task.create({ data: { projectId, creatorId: alice.id, title: 'T', description: 'd' } });
      await prisma.taskResponsibility.create({ data: { taskId: task.id, agentId } });
      await prisma.approvalRequest.update({ where: { id: approval.id }, data: { metadata: { taskId: task.id, agentId } } });

      // Another member retries it explicitly (the requester, a plain member, could not).
      const retried = await request(app).post(`/approvals/${approval.id}/retry`).set('Cookie', bob.cookie).send({});
      expect(retried.status).toBe(200);
      expect(retried.body).toMatchObject({ resumeStatus: 'DONE', resumeAttempts: 2 });
      const execution = await prisma.taskExecution.findUnique({ where: { id: retried.body.resumeResultId } });
      expect(execution?.taskId).toBe(task.id);

      // Nothing left to retry.
      await request(app).post(`/approvals/${approval.id}/retry`).set('Cookie', bob.cookie).send({}).expect(409);
    });

    it('two concurrent retries cannot both run the action', async () => {
      const task = await prisma.task.create({ data: { projectId, creatorId: alice.id, title: 'T', description: 'd' } });
      await prisma.taskResponsibility.create({ data: { taskId: task.id, agentId } });
      const approval = await pendingExecution(task.id);
      await prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { status: 'APPROVED', resumeStatus: 'FAILED', resumeError: 'simulated', resumeAttempts: 1 },
      });
      const results = await Promise.all([
        request(app).post(`/approvals/${approval.id}/retry`).set('Cookie', bob.cookie).send({}),
        request(app).post(`/approvals/${approval.id}/retry`).set('Cookie', bob.cookie).send({}),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.taskExecution.count({ where: { taskId: task.id } })).toBe(1);
    });

    it('a resume interrupted by a restart becomes FAILED, not re-run', async () => {
      const approval = await pendingExecution('t');
      await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: 'APPROVED', resumeStatus: 'PENDING' } });
      expect(await approvalService.reconcileOnStartup()).toBe(1);
      const row = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
      expect(row).toMatchObject({ resumeStatus: 'FAILED' });
      expect(row?.resumeError).toMatch(/restart/);
    });

    it('a viewer cannot retry', async () => {
      await prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: bob.id } }, data: { role: 'VIEWER' } });
      const approval = await pendingExecution('t');
      await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: 'APPROVED', resumeStatus: 'FAILED' } });
      await request(app).post(`/approvals/${approval.id}/retry`).set('Cookie', bob.cookie).send({}).expect(403);
    });
  });
});
