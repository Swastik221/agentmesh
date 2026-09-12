import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import type { WebSocket } from 'ws';
import { createAgentMeshMessage, AgentMeshMessageType } from '@agentmesh/agent-protocol';
import { connectionManager } from '../websocket/connection.manager.js';
import { connectorService } from '../connector/connector.service.js';
import { PAYMENT_CONFIG } from '../payments/payment.config.js';
import { x402Service } from '../payments/x402.service.js';
import { PolicyDecision, PaymentStatus } from '@prisma/client';

const app = createApp();
const request = supertest(app);

describe('PRD-36-C1 — Hedera x402 Agent Payment Corrective Tests', () => {
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
    it('should return HTTP 402 Payment Required with official x402 payment requirement header when no payment header is provided', async () => {
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

      // Verify header X-Payment-Requirement is present and encoded
      expect(res.headers['x-payment-requirement']).toBeDefined();
    });

    it('should enforce server-authoritative price and ignore client-supplied amount', async () => {
      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({ amount: '1' }); // Client attempting to pay $0.000001

      expect(res.status).toBe(402);
      const req = res.body.paymentRequirement;
      expect(req.amount).toBe('1000'); // Server-authoritative amount 1000
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
      const reqRes = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      const reqData = reqRes.body.paymentRequirement;

      const badPayment = {
        scheme: 'exact',
        network: 'ethereum:mainnet',
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
        asset: '0.0.999999',
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
        receiverAddress: '0.0.999999',
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

    it('should refuse real settlement when the resolved network is not hedera:testnet, before any facilitator call', async () => {
      const originalNetwork = process.env.HEDERA_NETWORK;
      process.env.HEDERA_NETWORK = 'hedera:mainnet';
      try {
        const reqRes = await request
          .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
          .set('Cookie', [`agentmesh_session=${user1Token}`])
          .send({});

        const reqData = reqRes.body.paymentRequirement;
        expect(reqData.network).toBe('hedera:mainnet');

        // A payload that matches the (misconfigured) requirement's own
        // network, so the earlier payload-vs-requirement consistency check
        // passes and the new network safety guard is the one that fires.
        const matchingButUnsafePayment = {
          scheme: 'exact',
          network: 'hedera:mainnet',
          asset: '0.0.429274',
          amount: '1000',
          paymentReference: reqData.paymentReference,
        };

        const res = await request
          .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
          .set('Cookie', [`agentmesh_session=${user1Token}`])
          .set('X-Payment', JSON.stringify(matchingButUnsafePayment))
          .set('X-Payment-Reference', reqData.paymentReference)
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Refusing to execute real settlement');
        expect(res.body.message).toContain('hedera:testnet');

        const dbRecord = await prisma.payment.findUnique({
          where: { x402PaymentReference: reqData.paymentReference },
        });
        expect(dbRecord?.status).not.toBe('SETTLED');
      } finally {
        if (originalNetwork === undefined) {
          delete process.env.HEDERA_NETWORK;
        } else {
          process.env.HEDERA_NETWORK = originalNetwork;
        }
      }
    });

    it('should throw rather than fall back to a baked-in receiver address when HEDERA_PAYMENT_RECEIVER is unset', () => {
      const originalReceiver = process.env.HEDERA_PAYMENT_RECEIVER;
      delete process.env.HEDERA_PAYMENT_RECEIVER;
      try {
        expect(() => PAYMENT_CONFIG.RECEIVER_ADDRESS).toThrow(
          'HEDERA_PAYMENT_RECEIVER is not configured',
        );
      } finally {
        if (originalReceiver !== undefined) {
          process.env.HEDERA_PAYMENT_RECEIVER = originalReceiver;
        }
      }
    });

    it('should reject unverified payment payloads without setting SETTLED status', async () => {
      const reqRes = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      const reqData = reqRes.body.paymentRequirement;

      const fakeUnverifiedPayment = {
        scheme: 'exact',
        network: 'hedera:testnet',
        asset: '0.0.429274',
        amount: '1000',
        receiverAddress: PAYMENT_CONFIG.RECEIVER_ADDRESS,
        paymentReference: reqData.paymentReference,
        signedTransaction: 'invalid_signature_payload',
      };

      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .set('X-Payment', JSON.stringify(fakeUnverifiedPayment))
        .set('X-Payment-Reference', reqData.paymentReference)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Facilitator settlement failed');

      const dbRecord = await prisma.payment.findUnique({
        where: { x402PaymentReference: reqData.paymentReference },
      });
      expect(dbRecord?.status).not.toBe('SETTLED');
    });
  });

  describe('3. Idempotency & Database Record Persistence', () => {
    it('should return existing settled payment when same payment reference is re-submitted', async () => {
      const paymentRef = `x402_idempotency_test_${Date.now()}`;
      const settled = await prisma.payment.create({
        data: {
          projectId: project1Id,
          requesterUserId: (await prisma.user.findFirstOrThrow()).id,
          agentId: agent1Id,
          action: 'capability.execute',
          amount: '1000',
          asset: '0.0.429274',
          network: 'hedera:testnet',
          receiverAddress: PAYMENT_CONFIG.RECEIVER_ADDRESS,
          status: PaymentStatus.SETTLED,
          x402PaymentReference: paymentRef,
          transactionReference: '0.0.500123@1700000000.000000000',
          settledAt: new Date(),
        },
      });

      const validPaymentHeader = {
        scheme: 'exact',
        network: 'hedera:testnet',
        asset: '0.0.429274',
        amount: '1000',
        receiverAddress: PAYMENT_CONFIG.RECEIVER_ADDRESS,
        paymentReference: paymentRef,
      };

      const res = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .set('X-Payment', JSON.stringify(validPaymentHeader))
        .set('X-Payment-Reference', paymentRef)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.payment.id).toBe(settled.id);
      expect(res.body.payment.status).toBe('SETTLED');
      expect(res.body.payment.transactionReference).toBe('0.0.500123@1700000000.000000000');
    }, 15000);
  });

  describe('4. PRD-35 Policy Integration', () => {
    it('should return 403 Forbidden without payment requirement when policy decision is DENY', async () => {
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

  describe('5. REST Payment Query Endpoints', () => {
    it('should list project payment records via GET /projects/:projectId/payments', async () => {
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

  describe('6. High-Concurrency Payment Settlement & Execution Idempotency Regression Tests', () => {
    it('should process 25 concurrent settlement requests for identical payment reference without duplicate records or double execution', async () => {
      // 1. Trigger HTTP 402 requirement
      const reqRes = await request
        .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
        .set('Cookie', [`agentmesh_session=${user1Token}`])
        .send({});

      expect(reqRes.status).toBe(402);
      const requirement = reqRes.body.paymentRequirement;
      expect(requirement).toBeDefined();
      expect(requirement.paymentReference).toBeDefined();

      const verifySpy = vi.spyOn(x402Service, 'verifyAndSettle').mockResolvedValue({
        valid: true,
        transactionReference: '0.0.9185802@1700000000.000000000',
        amount: '1000',
        asset: '0.0.429274',
        network: 'hedera:testnet',
        payerAddress: '0.0.12345',
        receiverAddress: PAYMENT_CONFIG.RECEIVER_ADDRESS,
      });

      const mockPayload = {
        scheme: 'exact',
        network: 'hedera:testnet',
        asset: '0.0.429274',
        amount: '1000',
        receiverAddress: PAYMENT_CONFIG.RECEIVER_ADDRESS,
        paymentReference: requirement.paymentReference,
        signedTransaction: 'signed_tx_bytes',
      };

      // Setup mock WebSocket agent connection
      const fakeSocket = {
        send: (data: string) => {
          try {
            const msg = JSON.parse(data);
            if (msg.type === AgentMeshMessageType.TASK_REQUEST) {
              const { taskId, executionId } = msg.payload;
              setTimeout(async () => {
                const completedMsg = createAgentMeshMessage({
                  type: AgentMeshMessageType.TASK_COMPLETED,
                  projectId: project1Id,
                  senderId: agent1Id,
                  payload: {
                    taskId,
                    executionId,
                    result: { summary: 'Real Paid Capability Executed' },
                  },
                });
                const connMeta = connectionManager.getAuthenticatedAgentConnections(agent1Id)[0];
                if (connMeta) {
                  await connectorService.processConnectorTaskMessage(connMeta, completedMsg);
                }
              }, 20);
            }
          } catch {
            // ignore error in fake socket
          }
        },
        readyState: 1,
        OPEN: 1,
        on: () => {},
      } as unknown as WebSocket;

      const connectionMetadata = connectionManager.addConnection(project1Id, fakeSocket);
      connectionMetadata.authenticated = true;
      connectionMetadata.agentId = agent1Id;

      try {
        // 2. Dispatch 25 simultaneous concurrent settlement requests
        const CONCURRENCY = 25;
        const promises = Array.from({ length: CONCURRENCY }).map(() =>
          request
            .post(`/agents/${agent1Id}/capabilities/artifact-analysis/execute`)
            .set('Cookie', [`agentmesh_session=${user1Token}`])
            .set('X-Payment', JSON.stringify(mockPayload))
            .set('X-Payment-Reference', requirement.paymentReference)
            .send({ action: 'capability.execute' }),
        );

        const responses = await Promise.all(promises);

        // 3. Verify all callers receive 200 OK and consistent settled status
        for (const res of responses) {
          expect(res.status).toBe(200);
          expect(res.body.payment).toBeDefined();
          expect(res.body.payment.status).toBe('SETTLED');
          expect(res.body.payment.transactionReference).toBe('0.0.9185802@1700000000.000000000');
        }

        // 4. Verify DB idempotency: EXACTLY 1 payment record created with status SETTLED
        const dbRecords = await prisma.payment.findMany({
          where: { x402PaymentReference: requirement.paymentReference },
        });

        expect(dbRecords.length).toBe(1);
        expect(dbRecords[0].status).toBe('SETTLED');
        expect(dbRecords[0].settledAt).not.toBeNull();
      } finally {
        if (connectionMetadata) {
          connectionManager.removeConnection(connectionMetadata.connectionId);
        }
        verifySpy.mockRestore();
      }
    }, 20000);
  });
});
