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

    const requirement = x402Service.generateRequirement({
      amount: params.amount || PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT,
      asset: params.asset || PAYMENT_CONFIG.USDC_TOKEN_ID,
      network: params.network || PAYMENT_CONFIG.NETWORK,
      receiver: PAYMENT_CONFIG.RECEIVER_ADDRESS,
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
  async processPaymentHeader(
    projectId: string,
    requesterUserId: string,
    paymentHeader: string,
    expectedRequirement: X402PaymentRequirement,
    agentId?: string,
  ): Promise<Payment> {
    await this.verifyProjectMembership(projectId, requesterUserId);

    const payload = x402Service.parsePaymentHeader(paymentHeader);
    if (!payload) {
      throw new BadRequestError('Invalid or unparseable x402 payment header');
    }

    // Check for existing settled record for idempotency
    const existingSettled = await prisma.payment.findUnique({
      where: { x402PaymentReference: expectedRequirement.paymentReference },
    });

    if (existingSettled && existingSettled.status === PaymentStatus.SETTLED) {
      return existingSettled;
    }

    // Verify & Settle
    const verification = await x402Service.verifyAndSettle(payload, expectedRequirement);

    if (!verification.valid) {
      if (existingSettled) {
        await prisma.payment.update({
          where: { id: existingSettled.id },
          data: { status: PaymentStatus.FAILED },
        });
      }
      throw new BadRequestError(verification.error || 'Payment verification failed');
    }

    // Atomic update to SETTLED status
    try {
      const settledPayment = await prisma.payment.upsert({
        where: {
          x402PaymentReference: expectedRequirement.paymentReference,
        },
        create: {
          projectId,
          requesterUserId,
          agentId: agentId || null,
          action: 'capability.execute',
          amount: verification.amount || expectedRequirement.amount,
          asset: verification.asset || expectedRequirement.asset,
          network: verification.network || expectedRequirement.network,
          payerAddress: verification.payerAddress || null,
          receiverAddress: verification.receiverAddress || expectedRequirement.receiver,
          status: PaymentStatus.SETTLED,
          x402PaymentReference: expectedRequirement.paymentReference,
          transactionReference: verification.transactionReference || null,
          settledAt: new Date(),
        },
        update: {
          status: PaymentStatus.SETTLED,
          payerAddress: verification.payerAddress || null,
          transactionReference: verification.transactionReference || null,
          settledAt: new Date(),
        },
      });

      // WS notification & activity log
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
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const recheck = await prisma.payment.findUnique({
          where: { x402PaymentReference: expectedRequirement.paymentReference },
        });
        if (recheck && recheck.status === PaymentStatus.SETTLED) {
          return recheck;
        }
      }
      throw err;
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
