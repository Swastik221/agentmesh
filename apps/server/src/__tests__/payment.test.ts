import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { PAYMENT_CONFIG } from '../payments/payment.config.js';
import { PolicyDecision } from '@prisma/client';

const app = createApp();
const request = supertest(app);

describe('PRD-36 — Hedera x402 Agent Payment Integration Tests', () => {
  let user1Token: string;
  let user1Wallet: string;

  let user2Token: string;

  let project1Id: string;
  let agent1Id: string;

  beforeEach(async () => {
    // Clean tables
    await prisma.payment.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.policy.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();

    // Create User 1
    user1Wallet = '0x1111111111111111111111111111111111111111';
    const user1 = await prisma.user.create({
      data: {
        walletAddress: user1Wallet,
        displayName: 'User One',
      },
    });

    const session1 = await prisma.authSession.create({
      data: {
        userId: user1.id,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    user1Token = session1.id;

    // Create User 2 (unauthorized for project 1)
    const user2 = await prisma.user.create({
      data: {
        walletAddress: '0x2222222222222222222222222222222222222222',
        displayName: 'User Two',
      },
    });
    const session2 = await prisma.authSession.create({
      data: {
        userId: user2.id,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    user2Token = session2.id;

    // Create Project 1 (Owned by User 1)
    const project1 = await prisma.project.create({
      data: {
        name: 'Project Alpha',
        ownerId: user1.id,
        members: {
          create: {
            userId: user1.id,
            role: 'OWNER',
          },
        },
      },
    });
    project1Id = project1.id;

    // Create Project 2
    await prisma.project.create({
      data: {
        name: 'Project Beta',
        ownerId: user2.id,
        members: {
          create: {
            userId: user2.id,
            role: 'OWNER',
          },
        },
      },
    });

    // Create Agent 1 with ENS Identity
    const agent1 = await prisma.agent.create({
      data: {
        projectId: project1.id,
        ownerId: user1.id,
        name: 'AnalysisAgent',
        provider: 'custom',
        ensName: 'research-agent.eth',
        ensAddress: '0x1111111111111111111111111111111111111111',
        capabilities: {
          create: [{ capability: 'artifact-analysis' }],
        },
      },
    });
    agent1Id = agent1.id;
  });

  afterEach(async () => {
    await prisma.payment.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.policy.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('1. Payment Requirements Generation (HTTP 402)', () => {
    it('should return HTTP 402 Payment Required with x402 payment requirements when no payment header is provided', async () => {
      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({ input: { target: 'test-artifact' } });

      expect(res.status).toBe(402);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Payment Required');
      expect(res.body.paymentRequirement).toBeDefined();

      const req = res.body.paymentRequirement;
      expect(req.scheme).toBe('exact');
      expect(req.network).toBe('hedera:testnet');
      expect(req.asset).toBe('0.0.429274');
      expect(req.amount).toBe('1000');
      expect(req.receiver).toBe(PAYMENT_CONFIG.RECEIVER_ADDRESS);
      expect(req.paymentReference).toMatch(/^x402_/);

      // Verify header X-Payment-Requirement is present
      expect(res.headers['x-payment-requirement']).toBeDefined();
    });

    it('should create an initial payment record in DB with status REQUIRED', async () => {
      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      expect(res.status).toBe(402);
      const paymentId = res.body.paymentId;
      expect(paymentId).toBeDefined();

      const dbRecord = await prisma.payment.findUnique({
        where: { id: paymentId },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.status).toBe('REQUIRED');
      expect(dbRecord?.amount).toBe('1000');
      expect(dbRecord?.asset).toBe('0.0.429274');
      expect(dbRecord?.network).toBe('hedera:testnet');
    });
  });

  describe('2. Validation & Security', () => {
    it('should reject unauthenticated execution requests with 401', async () => {
      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .send({});

      expect(res.status).toBe(401);
    });

    it('should reject non-project members with 403 Forbidden', async () => {
      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user2Token}`])
        .send({});

      expect(res.status).toBe(403);
    });

    it('should reject payment with wrong network', async () => {
      // Get 402 requirement
      const reqRes = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      const reqData = reqRes.body.paymentRequirement;

      const badPayment = {
        scheme: 'exact',
        network: 'ethereum:mainnet', // Invalid network
        asset: '0.0.429274',
        amount: '1000',
        paymentReference: reqData.paymentReference,
      };

      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .set('X-Payment', JSON.stringify(badPayment))
        .set('X-Payment-Reference', reqData.paymentReference)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid network');
    });

    it('should reject payment with wrong asset', async () => {
      const reqRes = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      const reqData = reqRes.body.paymentRequirement;

      const badPayment = {
        scheme: 'exact',
        network: 'hedera:testnet',
        asset: '0.0.999999', // Wrong token
        amount: '1000',
        paymentReference: reqData.paymentReference,
      };

      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .set('X-Payment', JSON.stringify(badPayment))
        .set('X-Payment-Reference', reqData.paymentReference)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid payment asset');
    });

    it('should reject payment with spoofed receiver address', async () => {
      const reqRes = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      const reqData = reqRes.body.paymentRequirement;

      const spoofedPayment = {
        scheme: 'exact',
        network: 'hedera:testnet',
        asset: '0.0.429274',
        amount: '1000',
        receiverAddress: '0.0.999999', // Spoofed receiver
        paymentReference: reqData.paymentReference,
      };

      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .set('X-Payment', JSON.stringify(spoofedPayment))
        .set('X-Payment-Reference', reqData.paymentReference)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid payment receiver');
    });
  });

  describe('3. Successful Settlement & Capability Execution', () => {
    it('should verify & settle valid payment and execute capability', async () => {
      // 1. Trigger 402
      const reqRes = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      const reqData = reqRes.body.paymentRequirement;

      // 2. Submit valid signed payment payload
      const validPayment = {
        scheme: 'exact',
        network: 'hedera:testnet',
        asset: '0.0.429274',
        amount: '1000',
        receiverAddress: PAYMENT_CONFIG.RECEIVER_ADDRESS,
        payerAddress: '0.0.400100',
        paymentReference: reqData.paymentReference,
        signedTransaction: 'signed_tx_hex_bytes',
      };

      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .set('X-Payment', JSON.stringify(validPayment))
        .set('X-Payment-Reference', reqData.paymentReference)
        .send({ input: { query: 'Analyze dependency tree' } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify Capability Result
      expect(res.body.result).toBeDefined();
      expect(res.body.result.capability).toBe('artifact-analysis');
      expect(res.body.result.agentName).toBe('AnalysisAgent');
      expect(res.body.result.ensName).toBe('research-agent.eth');

      // Verify Payment Object
      expect(res.body.payment).toBeDefined();
      expect(res.body.payment.status).toBe('SETTLED');
      expect(res.body.payment.amount).toBe('1000');
      expect(res.body.payment.asset).toBe('0.0.429274');
      expect(res.body.payment.network).toBe('hedera:testnet');
      expect(res.body.payment.transactionReference).toBeDefined();
    });
  });

  describe('4. Idempotency & Duplicate Settlement Protection', () => {
    it('should return existing settled record when same payment reference is re-submitted', async () => {
      const reqRes = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      const reqData = reqRes.body.paymentRequirement;

      const validPayment = {
        scheme: 'exact',
        network: 'hedera:testnet',
        asset: '0.0.429274',
        amount: '1000',
        receiverAddress: PAYMENT_CONFIG.RECEIVER_ADDRESS,
        paymentReference: reqData.paymentReference,
        signedTransaction: 'signed_tx_hex_bytes',
      };

      // Execution 1
      const res1 = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .set('X-Payment', JSON.stringify(validPayment))
        .set('X-Payment-Reference', reqData.paymentReference)
        .send({});

      expect(res1.status).toBe(200);
      const payment1Id = res1.body.payment.id;

      // Duplicate Execution 2 with identical payment reference
      const res2 = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .set('X-Payment', JSON.stringify(validPayment))
        .set('X-Payment-Reference', reqData.paymentReference)
        .send({});

      expect(res2.status).toBe(200);
      expect(res2.body.payment.id).toBe(payment1Id);

      // Verify DB count remains 1 for this payment reference
      const count = await prisma.payment.count({
        where: { x402PaymentReference: reqData.paymentReference },
      });
      expect(count).toBe(1);
    });
  });

  describe('5. PRD-35 Policy Integration', () => {
    it('should return 403 Forbidden without payment requirement when policy decision is DENY', async () => {
      // Create DENY policy for capability.execute
      await prisma.policy.create({
        data: {
          projectId: project1Id,
          name: 'Block capability execution',
          action: 'capability.execute',
          decision: PolicyDecision.DENY,
          enabled: true,
        },
      });

      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden: Operation denied by project policy');
      expect(res.headers['x-payment-requirement']).toBeUndefined();
    });

    it('should return 202 APPROVAL_REQUIRED when policy decision is APPROVAL_REQUIRED', async () => {
      // Create APPROVAL_REQUIRED policy for capability.execute
      await prisma.policy.create({
        data: {
          projectId: project1Id,
          name: 'Require human approval for paid execution',
          action: 'capability.execute',
          decision: PolicyDecision.APPROVAL_REQUIRED,
          enabled: true,
        },
      });

      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('APPROVAL_REQUIRED');
      expect(res.headers['x-payment-requirement']).toBeUndefined();
    });
  });

  describe('6. REST Payment Query Endpoints', () => {
    it('should list project payment records via GET /projects/:projectId/payments', async () => {
      // Trigger requirement to create payment record
      await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      const listRes = await request
        .get(`/projects/${project1Id}/payments`)
        .set('Cookie', [`agentmesh_session=${user1Token}`]);

      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
