import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { ExactHederaScheme as HederaFacilitatorScheme } from '@x402/hedera/exact/facilitator';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { x402Service } from '../payments/x402.service.js';
import { paymentService } from '../payments/payment.service.js';
import { PAYMENT_CONFIG } from '../payments/payment.config.js';
import { connectorService } from '../connector/connector.service.js';
import { config } from '../config/index.js';
import { clearDatabase, makeUser } from './helpers/ws-harness.js';
import { TEST_FACILITATOR_FEE_PAYER } from '../test-support/payments.js';

/**
 * x402 on Hedera, checked against the installed official facilitator code
 * rather than our own assumptions. No network calls and no keys: the
 * facilitator's requirement validation is pure, and settlement itself is
 * mocked where it would need a signed testnet transaction.
 */

const app = createApp();

/** The real facilitator mechanism from @x402/hedera, managing one fee payer. */
const facilitator = new HederaFacilitatorScheme({
  getAddresses: () => [TEST_FACILITATOR_FEE_PAYER],
} as unknown as ConstructorParameters<typeof HederaFacilitatorScheme>[0]);
const validate = (accepted: unknown, requirements: unknown) =>
  (facilitator as unknown as { validateRequirements(p: unknown, r: unknown): { invalidReason: string } | null }).validateRequirements(
    { x402Version: 2, accepted, payload: {} },
    requirements,
  );

describe('x402 Hedera: facilitator contract and payment lifecycle', () => {
  let alice: { id: string; cookie: string };
  let projectId: string;
  let agentId: string;

  beforeEach(async () => {
    await clearDatabase();
    await prisma.payment.deleteMany();
    alice = await makeUser('0xf100000000000000000000000000000000000001', 'Alice');
    projectId = (await prisma.project.create({ data: { name: 'P', ownerId: alice.id, members: { create: { userId: alice.id, role: 'OWNER' } } } })).id;
    agentId = (
      await prisma.agent.create({
        data: { projectId, ownerId: alice.id, name: 'Paid', provider: 'x', capabilities: { create: { capability: 'audit' } } },
      })
    ).id;
  });

  describe('requirement shape', () => {
    it("is accepted by the official Hedera facilitator's requirement validation", () => {
      const requirement = x402Service.generateRequirement({ feePayer: TEST_FACILITATOR_FEE_PAYER });
      const wire = x402Service.toWireRequirement(requirement);
      expect(validate(wire, wire)).toBeNull();
    });

    it('the old shape (receiver as fee payer) is what the facilitator rejected', () => {
      const requirement = x402Service.generateRequirement({ feePayer: PAYMENT_CONFIG.RECEIVER_ADDRESS });
      const wire = x402Service.toWireRequirement(requirement);
      expect(validate(wire, wire)?.invalidReason).toBe('fee_payer_not_managed_by_facilitator');
    });

    it('a client that drops maxTimeoutSeconds or changes the amount is rejected', () => {
      const wire = x402Service.toWireRequirement(x402Service.generateRequirement({ feePayer: TEST_FACILITATOR_FEE_PAYER }));
      expect(validate({ ...wire, maxTimeoutSeconds: undefined }, wire)?.invalidReason).toBe('accepted_payment_requirements_mismatch');
      expect(validate({ ...wire, amount: '999' }, wire)?.invalidReason).toBe('accepted_payment_requirements_mismatch');
    });
  });

  describe('fee payer lookup', () => {
    it("takes the fee payer from the facilitator's /supported, and fails clearly when it cannot", async () => {
      vi.mocked(x402Service.getFacilitatorFeePayer).mockRestore();
      const client = { getSupported: vi.fn() };
      vi.spyOn(x402Service as unknown as { getFacilitatorClient(): unknown }, 'getFacilitatorClient').mockReturnValue(client);

      client.getSupported.mockResolvedValueOnce({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'hedera:mainnet', extra: { feePayer: '0.0.1' } }] });
      await expect(x402Service.getFacilitatorFeePayer('hedera:testnet')).rejects.toMatchObject({ code: 'FACILITATOR_UNSUPPORTED', statusCode: 503 });

      client.getSupported.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(x402Service.getFacilitatorFeePayer('hedera:testnet')).rejects.toMatchObject({ code: 'FACILITATOR_UNAVAILABLE' });

      client.getSupported.mockResolvedValueOnce({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'hedera:testnet', extra: { feePayer: '0.0.4242' } }] });
      expect(await x402Service.getFacilitatorFeePayer('hedera:testnet')).toBe('0.0.4242');
      // Cached: no second call.
      expect(await x402Service.getFacilitatorFeePayer('hedera:testnet')).toBe('0.0.4242');
      expect(client.getSupported).toHaveBeenCalledTimes(3);
    });
  });

  describe('paid capability lifecycle', () => {
    const execute = () =>
      request(app).post(`/agents/${agentId}/capabilities/audit/execute`).set('Cookie', alice.cookie).set('Origin', config.webOrigin).send({});

    it('does not quote, or charge, for an agent that is not connected', async () => {
      vi.spyOn(connectorService, 'isAgentConnected').mockReturnValue(false);
      const res = await execute().expect(409);
      expect(res.body).toMatchObject({ error: 'AGENT_UNAVAILABLE' });
      expect(res.body.message).toContain('not been charged');
      expect(await prisma.payment.count()).toBe(0);
    });

    it('returns a standard PAYMENT-REQUIRED header the browser can read', async () => {
      vi.spyOn(connectorService, 'isAgentConnected').mockReturnValue(true);
      const res = await execute().expect(402);
      expect(res.headers['access-control-expose-headers']).toMatch(/PAYMENT-REQUIRED/i);
      const decoded = decodePaymentRequiredHeader(res.headers['payment-required']);
      const accepts = decoded.accepts[0] as unknown as Record<string, unknown>;
      expect(accepts).toMatchObject({
        scheme: 'exact',
        network: 'hedera:testnet',
        payTo: PAYMENT_CONFIG.RECEIVER_ADDRESS,
        maxTimeoutSeconds: PAYMENT_CONFIG.MAX_TIMEOUT_SECONDS,
        amount: PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT,
        extra: { feePayer: TEST_FACILITATOR_FEE_PAYER },
      });
      expect(validate(accepts, accepts)).toBeNull();
    });

    it('refuses references it did not issue, and expired ones', async () => {
      const header = JSON.stringify({ x402Version: 2, accepted: {}, payload: {} });
      await expect(paymentService.processPaymentHeader(projectId, alice.id, header, 'x402_made_up', agentId)).rejects.toThrow(/Unknown payment reference/);
      await expect(paymentService.processPaymentHeader(projectId, alice.id, header, undefined, agentId)).rejects.toThrow(/X-Payment-Reference is required/);

      const { payment } = await paymentService.createPaymentRequirement({ projectId, requesterUserId: alice.id, agentId, action: 'capability.execute' });
      await prisma.payment.update({ where: { id: payment.id }, data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
      await expect(paymentService.processPaymentHeader(projectId, alice.id, header, payment.x402PaymentReference!, agentId)).rejects.toThrow(/expired/);
      expect((await prisma.payment.findUnique({ where: { id: payment.id } }))?.status).toBe('FAILED');
    });

    it('records settlement evidence, and one Hedera transaction cannot pay twice', async () => {
      const settle = vi.spyOn(x402Service, 'verifyAndSettle').mockResolvedValue({
        valid: true,
        transactionReference: '0.0.1234@1700000000.000000001',
        payerAddress: '0.0.1234',
        receiverAddress: PAYMENT_CONFIG.RECEIVER_ADDRESS,
        amount: PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT,
        asset: PAYMENT_CONFIG.USDC_TOKEN_ID,
        network: 'hedera:testnet',
      });
      const header = JSON.stringify({ x402Version: 2, accepted: {}, payload: {} });
      const first = await paymentService.createPaymentRequirement({ projectId, requesterUserId: alice.id, agentId, action: 'capability.execute' });
      const settled = await paymentService.processPaymentHeader(projectId, alice.id, header, first.payment.x402PaymentReference!, agentId);
      expect(settled).toMatchObject({ status: 'SETTLED', transactionReference: '0.0.1234@1700000000.000000001' });
      expect((settled.metadata as { settlement: Record<string, unknown> }).settlement).toMatchObject({
        network: 'hedera:testnet',
        receiver: PAYMENT_CONFIG.RECEIVER_ADDRESS,
      });
      // The facilitator was asked to check exactly the requirement it was issued with.
      expect(settle.mock.calls[0][1]).toMatchObject({ feePayer: TEST_FACILITATOR_FEE_PAYER, maxTimeoutSeconds: PAYMENT_CONFIG.MAX_TIMEOUT_SECONDS });

      // Same reference again: the settled record, no second settlement.
      const again = await paymentService.processPaymentHeader(projectId, alice.id, header, first.payment.x402PaymentReference!, agentId);
      expect(again.id).toBe(settled.id);
      expect(settle).toHaveBeenCalledTimes(1);

      // A second request "paid" with the same transaction is refused.
      const second = await paymentService.createPaymentRequirement({ projectId, requesterUserId: alice.id, agentId, action: 'capability.execute' });
      await expect(
        paymentService.processPaymentHeader(projectId, alice.id, header, second.payment.x402PaymentReference!, agentId),
      ).rejects.toThrow(/already been used/);
      expect((await prisma.payment.findUnique({ where: { id: second.payment.id } }))?.status).toBe('FAILED');
    });
  });
});
