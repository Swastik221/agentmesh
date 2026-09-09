import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { agentCapabilityService } from '../services/agent-capability.service.js';
import { addCapabilitySchema } from '../schemas/agent-capability.schema.js';
import { prisma } from '../lib/prisma.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../errors/app-error.js';
import { policyService } from '../services/policy.service.js';
import { PolicyDecision } from '@prisma/client';
import { paymentService } from '../payments/payment.service.js';
import { x402Service } from '../payments/x402.service.js';
import { PAYMENT_CONFIG } from '../payments/payment.config.js';

export const addCapability = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const input = addCapabilitySchema.parse(req.body);
    const capabilityRecord = await agentCapabilityService.addCapability(agentId, input.capability);
    res.status(201).json(capabilityRecord);
  } catch (error) {
    next(error);
  }
};

export const listCapabilities = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const result = await agentCapabilityService.listCapabilities(agentId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const removeCapability = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const agentId = req.params.agentId as string;
    const capability = req.params.capability as string;
    await agentCapabilityService.removeCapability(agentId, capability);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const executePaidCapability = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError();
    }

    const agentId = req.params.agentId as string;
    const capability = req.params.capability as string;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { capabilities: true },
    });

    if (!agent) {
      throw new NotFoundError(`Agent with ID '${agentId}' not found`);
    }

    // Verify project membership
    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: agent.projectId,
          userId: actorUserId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenError('User is not a member of this project');
    }

    // STEP 4 & 5: Evaluate Policy
    const policyResult = await policyService.evaluateAction(agent.projectId, 'capability.execute');

    if (policyResult.decision === PolicyDecision.DENY) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: Operation denied by project policy',
        matchedPolicies: policyResult.matchedPolicies,
      });
      return;
    }

    if (policyResult.decision === PolicyDecision.APPROVAL_REQUIRED) {
      res.status(202).json({
        success: false,
        status: 'APPROVAL_REQUIRED',
        message: 'Capability execution requires human approval before proceeding to payment',
      });
      return;
    }

    // STEP 7-10: Payment Gate
    const authHeader = req.headers['authorization'];
    const paymentHeader = (
      req.headers['payment-signature'] ||
      req.headers['x-payment'] ||
      (authHeader && authHeader.toLowerCase().startsWith('x402 ') ? authHeader : undefined)
    ) as string | undefined;

    const reqHeaderPaymentRef = req.headers['x-payment-reference'] as string | undefined;

    if (!paymentHeader) {
      // Server-authoritative pricing (ignores client-provided amount)
      const { requirement, payment } = await paymentService.createPaymentRequirement({
        projectId: agent.projectId,
        requesterUserId: actorUserId,
        agentId,
        action: 'capability.execute',
        amount: PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT,
        asset: PAYMENT_CONFIG.USDC_TOKEN_ID,
        network: PAYMENT_CONFIG.NETWORK,
      });

      const encodedHeader = x402Service.encodeRequirementHeader(requirement);
      res.setHeader('X-Payment-Requirement', encodedHeader);
      res.status(402).json({
        success: false,
        error: 'Payment Required',
        statusCode: 402,
        paymentRequirement: requirement,
        paymentId: payment.id,
      });
      return;
    }

    // Process & Settle Payment
    const requirement = x402Service.generateRequirement({
      paymentReference: reqHeaderPaymentRef,
      amount: PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT,
      asset: PAYMENT_CONFIG.USDC_TOKEN_ID,
      network: PAYMENT_CONFIG.NETWORK,
      receiver: PAYMENT_CONFIG.RECEIVER_ADDRESS,
    });

    const settledPayment = await paymentService.processPaymentHeader(
      agent.projectId,
      actorUserId,
      paymentHeader,
      requirement,
      agentId,
    );

    // Capability Execution
    const executionResult = {
      capability,
      agentId,
      agentName: agent.name,
      ensName: agent.ensName,
      executedAt: new Date().toISOString(),
      output: {
        summary: `Successfully executed paid capability '${capability}'`,
        analysis: `Premium analysis result from ${agent.ensName || agent.name}`,
        data: req.body?.input || {},
      },
    };

    res.status(200).json({
      success: true,
      result: executionResult,
      payment: {
        id: settledPayment.id,
        status: settledPayment.status,
        amount: settledPayment.amount,
        asset: settledPayment.asset,
        network: settledPayment.network,
        transactionReference: settledPayment.transactionReference,
        payerAddress: settledPayment.payerAddress,
        receiverAddress: settledPayment.receiverAddress,
        settledAt: settledPayment.settledAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
