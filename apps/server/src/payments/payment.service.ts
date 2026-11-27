import { Prisma, Payment, PaymentStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { PAYMENT_CONFIG } from './payment.config.js';
import { x402Service } from './x402.service.js';
import {
  CreatePaymentRequirementParams,
  X402PaymentRequirement,
} from './payment.types.js';
import { connectionManager } from '../websocket/connection.manager.js';
import type { WebSocketMessage } from '../websocket/websocket.types.js';
import { activityService } from '../services/activity.service.js';

export class PaymentService {
  async verifyProjectMembership(projectId: string, userId: string): Promise<void> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('User is not a member of this project');
    }
  }

  /**
   * Generates a payment requirement and persists an initial REQUIRED payment record.
   */
  async createPaymentRequirement(
    params: CreatePaymentRequirementParams,
  ): Promise<{ requirement: X402PaymentRequirement; payment: Payment }> {
    await this.verifyProjectMembership(params.projectId, params.requesterUserId);

    if (params.agentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: params.agentId },
      });
      if (!agent || agent.projectId !== params.projectId) {
        throw new NotFoundError(
          `Agent with ID '${params.agentId}' not found in project '${params.projectId}'`,
        );
      }
    }

    // Price, asset, network and receiver are always the server's own; a
    // client-supplied amount or network is ignored rather than recorded.
    const network = PAYMENT_CONFIG.NETWORK;
    const feePayer = await x402Service.getFacilitatorFeePayer(network);
    const requirement = x402Service.generateRequirement({
      amount: PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT,
      asset: PAYMENT_CONFIG.USDC_TOKEN_ID,
      network,
      receiver: PAYMENT_CONFIG.RECEIVER_ADDRESS,
      feePayer,
    });

    const payment = await prisma.payment.create({
      data: {
        projectId: params.projectId,
        requesterUserId: params.requesterUserId,
        agentId: params.agentId || null,
        action: params.action,
        amount: requirement.amount,
        asset: requirement.asset,
        network: requirement.network,
        receiverAddress: requirement.receiver,
        status: PaymentStatus.REQUIRED,
        x402PaymentReference: requirement.paymentReference,
        metadata: {
          scheme: requirement.scheme,
          facilitatorUrl: PAYMENT_CONFIG.FACILITATOR_URL,
          feePayer: requirement.feePayer,
          maxTimeoutSeconds: requirement.maxTimeoutSeconds,
        } as Prisma.InputJsonValue,
      },
    });

    try {
      connectionManager.broadcastToProject(params.projectId, {
        type: 'payment.required',
        payload: {
          paymentId: payment.id,
          action: payment.action,
          requirement,
        },
      } as unknown as WebSocketMessage);
    } catch {
      // WS log is best effort
    }

    return { requirement, payment };
  }

  /**
   * Processes, verifies, and settles an x402 payment header against a payment requirement.
   * Atomic state transitions prevent double settlement or duplicate processing.
   */
  /**
   * The requirement a payment record was issued with, rebuilt exactly (the
   * facilitator compares it field for field with what the client signed).
   */
  requirementFor(payment: Payment): X402PaymentRequirement {
    const meta = (payment.metadata ?? {}) as { feePayer?: string; maxTimeoutSeconds?: number };
    return x402Service.generateRequirement({
      paymentReference: payment.x402PaymentReference ?? undefined,
      amount: payment.amount,
      asset: payment.asset,
      network: payment.network,
      receiver: payment.receiverAddress,
      feePayer: meta.feePayer,
      maxTimeoutSeconds: meta.maxTimeoutSeconds,
    });
  }

  /**
   * Verifies and settles a signed x402 payment against a requirement this
   * server issued. The reference must be one we created (for this project,
   * requester and agent), still unpaid and unexpired; a client cannot invent
   * a reference or reuse one from elsewhere. Settling the same reference again
   * returns the settled record (idempotent), and a Hedera transaction can
   * settle at most one payment.
   */
  async processPaymentHeader(
    projectId: string,
    requesterUserId: string,
    paymentHeader: string,
    paymentReference: string | undefined,
    agentId?: string,
  ): Promise<Payment> {
    await this.verifyProjectMembership(projectId, requesterUserId);

    const payload = x402Service.parsePaymentHeader(paymentHeader);
    if (!payload) {
      throw new BadRequestError('Invalid or unparseable x402 payment header');
    }

    if (!paymentReference) {
      throw new BadRequestError('X-Payment-Reference is required: use the reference from the 402 payment requirement');
    }
    const existing = await prisma.payment.findUnique({ where: { x402PaymentReference: paymentReference } });
    if (!existing) {
      throw new BadRequestError('Unknown payment reference. Request the capability without a payment first to get one.');
    }
    this.assertPaymentBelongsTo(existing, projectId, requesterUserId, agentId);

    if (existing.status === PaymentStatus.SETTLED) {
      return existing;
    }
    if (existing.status !== PaymentStatus.REQUIRED) {
      throw new BadRequestError(`This payment request is ${existing.status.toLowerCase()}; request a new one`);
    }

    const requirement = this.requirementFor(existing);
    const expiresAt = existing.createdAt.getTime() + (requirement.maxTimeoutSeconds + 60) * 1000;
    if (Date.now() > expiresAt) {
      await prisma.payment.update({
        where: { id: existing.id },
        data: { status: PaymentStatus.FAILED, metadata: { ...((existing.metadata as object) ?? {}), failure: 'expired' } as Prisma.InputJsonValue },
      });
      throw new BadRequestError('This payment request has expired. Request a new one; you were not charged.');
    }

    // Verify & settle through the facilitator.
    const verification = await x402Service.verifyAndSettle(payload, requirement);

    if (!verification.valid) {
      await prisma.payment.updateMany({
        where: { id: existing.id, status: PaymentStatus.REQUIRED },
        data: { status: PaymentStatus.FAILED },
      });
      throw new BadRequestError(verification.error || 'Payment verification failed');
    }

    let settledPayment: Payment;
    try {
      // Conditional on REQUIRED, so two concurrent settlements of one
      // reference record it once.
      const claimed = await prisma.payment.updateMany({
        where: { id: existing.id, status: PaymentStatus.REQUIRED },
        data: {
          status: PaymentStatus.SETTLED,
          payerAddress: verification.payerAddress || null,
          transactionReference: verification.transactionReference || null,
          settledAt: new Date(),
          metadata: {
            ...((existing.metadata as object) ?? {}),
            settlement: {
              network: verification.network,
              transaction: verification.transactionReference,
              amount: verification.amount,
              receiver: verification.receiverAddress,
              facilitatorUrl: PAYMENT_CONFIG.FACILITATOR_URL,
              settledAt: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      });
      settledPayment = (await prisma.payment.findUnique({ where: { id: existing.id } }))!;
      if (claimed.count === 0 && settledPayment.status !== PaymentStatus.SETTLED) {
        throw new BadRequestError('Payment could not be recorded; request a new one');
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await prisma.payment.updateMany({ where: { id: existing.id, status: PaymentStatus.REQUIRED }, data: { status: PaymentStatus.FAILED } });
        throw new BadRequestError('That Hedera transaction has already been used to pay for another request');
      }
      throw err;
    }

    try {
      await activityService.recordActivity(projectId, {
        type: 'payment.settled',
        actorType: 'human',
        actorId: requesterUserId,
        payload: {
          paymentId: settledPayment.id,
          amount: settledPayment.amount,
          asset: settledPayment.asset,
          network: settledPayment.network,
          transactionReference: settledPayment.transactionReference,
        },
      });
      connectionManager.broadcastToProject(projectId, {
        type: 'payment.settled',
        payload: settledPayment,
      } as unknown as WebSocketMessage);
    } catch {
      // WS is best effort
    }

    return settledPayment;
  }

  private assertPaymentBelongsTo(
    payment: Payment,
    projectId: string,
    requesterUserId: string,
    agentId?: string,
  ): void {
    const agentMismatch = Boolean(agentId && payment.agentId && payment.agentId !== agentId);
    if (
      payment.projectId !== projectId ||
      payment.requesterUserId !== requesterUserId ||
      agentMismatch
    ) {
      throw new ForbiddenError('This payment reference belongs to a different payment request');
    }
  }

  async getPaymentById(paymentId: string, userId: string): Promise<Payment> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundError(`Payment record with ID '${paymentId}' not found`);
    }

    await this.verifyProjectMembership(payment.projectId, userId);

    return payment;
  }

  async listProjectPayments(projectId: string, userId: string): Promise<Payment[]> {
    await this.verifyProjectMembership(projectId, userId);

    return await prisma.payment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const paymentService = new PaymentService();
