import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

import { demoOrchestrator } from '../demo/demo-orchestrator.js';

const app = createApp();
const request = supertest(app);

describe('PRD-40 Demo REST API Tests', () => {
  let userToken: string;
  let userWallet: string;

  beforeEach(async () => {
    // Clean database
    await prisma.taskDependency.deleteMany().catch(() => {});
    await prisma.artifact.deleteMany().catch(() => {});
    await prisma.payment.deleteMany().catch(() => {});
    await prisma.approvalRequest.deleteMany().catch(() => {});
    await prisma.policy.deleteMany().catch(() => {});
    await prisma.task.deleteMany().catch(() => {});
    await prisma.agentCapability.deleteMany().catch(() => {});
    await prisma.agent.deleteMany().catch(() => {});
    await prisma.projectWorkspace.deleteMany().catch(() => {});
    await prisma.projectMember.deleteMany().catch(() => {});
    await prisma.project.deleteMany().catch(() => {});
    await prisma.authSession.deleteMany().catch(() => {});
    await prisma.user.deleteMany().catch(() => {});

    userWallet = '0x1111111111111111111111111111111111111111';
    const user = await prisma.user.create({
      data: {
        walletAddress: userWallet,
        displayName: 'Demo Judge',
      },
    });

    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    userToken = session.id;
  });

  afterEach(async () => {
    await prisma.taskDependency.deleteMany().catch(() => {});
    await prisma.artifact.deleteMany().catch(() => {});
    await prisma.payment.deleteMany().catch(() => {});
    await prisma.approvalRequest.deleteMany().catch(() => {});
    await prisma.policy.deleteMany().catch(() => {});
    await prisma.task.deleteMany().catch(() => {});
    await prisma.agentCapability.deleteMany().catch(() => {});
    await prisma.agent.deleteMany().catch(() => {});
    await prisma.projectWorkspace.deleteMany().catch(() => {});
    await prisma.projectMember.deleteMany().catch(() => {});
    await prisma.project.deleteMany().catch(() => {});
    await prisma.authSession.deleteMany().catch(() => {});
    await prisma.user.deleteMany().catch(() => {});
  });

  it('1. Rejects unauthenticated POST /demo/run with 401 Unauthorized', async () => {
    const res = await request.post('/demo/run').send({});
    expect(res.status).toBe(401);
    expect(res.body.message).toContain('Authentication required');
  });

  it('2. Executes deterministic 15-stage workflow for authenticated user via POST /demo/run', async () => {
    const res = await request
      .post('/demo/run')
      .set('Cookie', [`agentmesh_session=${userToken}`])
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.mode).toBe('AUTOMATED_DETERMINISTIC_DEMO');
    expect(res.body.isLive).toBe(false);

    const result = res.body.result;
    expect(result).toBeDefined();
    expect(result.stages.length).toBe(15);
    expect(result.stages[0]).toBe('IDENTITY_VERIFIED');
    expect(result.stages[14]).toBe('DEMO_COMPLETE');
    expect(result.transactionReference).toBe('MOCK-HEDERA-SETTLEMENT');
  });

  it('3. User identity is server-authoritative derived from authenticated session', async () => {
    const session = await prisma.authSession.findUnique({ where: { id: userToken } });

    const res = await request
      .post('/demo/run')
      .set('Cookie', [`agentmesh_session=${userToken}`])
      .send({ userId: 'spoofed_user_id_attempt', walletAddress: '0x9999999999999999999999999999999999999999' });

    expect(res.status).toBe(200);
    expect(res.body.result.userId).toBe(session?.userId);
    expect(res.body.result.userId).not.toBe('spoofed_user_id_attempt');
  });

  it('4. Missing authenticated user in database produces controlled error and does not fallback', async () => {
    const ghostUser = await prisma.user.create({
      data: {
        walletAddress: '0x8888888888888888888888888888888888888888',
        displayName: 'Ghost User',
      },
    });
    const ghostSession = await prisma.authSession.create({
      data: {
        userId: ghostUser.id,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    // Delete user record directly
    await prisma.user.delete({ where: { id: ghostUser.id } });

    const res = await request
      .post('/demo/run')
      .set('Cookie', [`agentmesh_session=${ghostSession.id}`])
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).not.toBe(true);

    // Verify no secondary fallback user was created
    const ghostCheck = await prisma.user.findUnique({
      where: { walletAddress: '0x8888888888888888888888888888888888888888' },
    });
    expect(ghostCheck).toBeNull();
  });

  it('5. Standalone CLI demo path without userId executes deterministic demo correctly', async () => {
    const result = await demoOrchestrator.runDemo({ mockHederaSettlement: true });
    expect(result).toBeDefined();
    expect(result.stages.length).toBe(15);
    expect(result.userId).toBeDefined();
  });
});
