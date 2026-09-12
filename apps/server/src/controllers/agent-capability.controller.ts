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

    // STEP 1: Capability Authorization (Section 5)
    const hasCapability = agent.capabilities.some(
      (c) => c.capability.trim().toLowerCase() === capability.trim().toLowerCase(),
    );
    if (!hasCapability) {
      throw new ForbiddenError(
        `Capability '${capability}' is not assigned to agent '${agent.name}'`,
      );
    }

    // STEP 2: Verify project membership
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

    // STEP 3: Evaluate Policy (Section 6)
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

    // STEP 4: Payment Gate (Section 7)
    const authHeader = req.headers['authorization'];
    const paymentHeader = (
      req.headers['payment-signature'] ||
      req.headers['x-payment'] ||
      req.headers['x-payment-proof'] ||
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

    // STEP 5: Process & Settle Payment (Section 8)
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

    // STEP 6: Idempotency check for existing execution associated with this settled payment (Section 17)
    let executionId = settledPayment.executionId;
    if (!executionId) {
      for (let i = 0; i < 20; i++) {
        const reCheck = await prisma.payment.findUnique({
          where: { id: settledPayment.id },
          select: { executionId: true },
        });
        if (reCheck?.executionId) {
          executionId = reCheck.executionId;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    if (executionId) {
      let existingExec = await prisma.taskExecution.findUnique({
        where: { id: executionId },
      });
      let execAttempts = 0;
      while (
        execAttempts < 50 &&
        existingExec &&
        (existingExec.status === 'QUEUED' || existingExec.status === 'RUNNING')
      ) {
        await new Promise((r) => setTimeout(r, 100));
        existingExec = await prisma.taskExecution.findUnique({ where: { id: executionId } });
        execAttempts++;
      }

      if (existingExec) {
        const isSuccess = existingExec.status === 'COMPLETED';
        const isPending = existingExec.status === 'QUEUED' || existingExec.status === 'RUNNING';
        res.status(200).json({
          success: isSuccess || isPending,
          status: isSuccess ? 'COMPLETED' : isPending ? existingExec.status : 'EXECUTION_FAILED',
          message: existingExec.error || (isSuccess ? undefined : isPending ? 'Agent execution in progress' : 'Agent execution failed'),
          result: existingExec.output,
          execution: {
            id: existingExec.id,
            status: existingExec.status,
            output: existingExec.output,
            error: existingExec.error || undefined,
          },
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
        return;
      }
    }

    // STEP 7: Resolve or Create Task Context (Section 10)
    let taskId = (req.body?.taskId || req.headers['x-task-id']) as string | undefined;
    if (taskId) {
      const existingTask = await prisma.task.findUnique({ where: { id: taskId } });
      if (!existingTask || existingTask.projectId !== agent.projectId) {
        taskId = undefined;
      }
    }

    if (!taskId) {
      let capabilityTask = await prisma.task.findFirst({
        where: {
          projectId: agent.projectId,
          title: `Paid Capability: ${capability}`,
        },
      });

      if (!capabilityTask) {
        capabilityTask = await prisma.task.create({
          data: {
            projectId: agent.projectId,
            creatorId: actorUserId,
            title: `Paid Capability: ${capability}`,
            description: `Paid capability execution for '${capability}'`,
            status: 'TODO',
          },
        });
      }
      taskId = capabilityTask.id;
    }

    // Ensure TaskResponsibility exists for agent
    await prisma.taskResponsibility.upsert({
      where: {
        taskId_agentId: {
          taskId,
          agentId,
        },
      },
      create: {
        taskId,
        agentId,
        role: 'PRIMARY',
      },
      update: {},
    });

    // STEP 8: Connected Agent Check & Execution Dispatch (Section 12 & 13)
    const { connectorService } = await import('../connector/connector.service.js');
    const { executionService } = await import('../execution/execution.service.js');

    const isConnected = connectorService.isAgentConnected(agentId);
    const executionInput = {
      ...(req.body?.input && typeof req.body.input === 'object' ? req.body.input : {}),
      capability,
      requireRealAgent: true,
    };

    const execution = await executionService.createExecutionBypassingPolicy(
      agent.projectId,
      taskId,
      actorUserId,
      {
        agentId,
        input: executionInput,
      },
    );

    // Update payment record with executionId
    await prisma.payment.update({
      where: { id: settledPayment.id },
      data: { executionId: execution.id },
    });

    if (!isConnected) {
      // Disconnected agent: payment SETTLED, execution FAILED / AGENT_UNAVAILABLE (Section 13 & 14)
      res.status(200).json({
        success: false,
        status: 'EXECUTION_FAILED',
        message: 'Payment settled on Hedera Testnet, but requested agent is not connected via WebSocket.',
        execution: {
          id: execution.id,
          status: 'FAILED',
          error: 'Agent is not connected via WebSocket',
        },
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
      return;
    }

    // Await connected agent execution completion (up to 6 seconds) (Section 15 & 16)
    let attempts = 0;
    let updatedExec = await prisma.taskExecution.findUnique({ where: { id: execution.id } });

    while (attempts < 40 && updatedExec && (updatedExec.status === 'QUEUED' || updatedExec.status === 'RUNNING')) {
      await new Promise((r) => setTimeout(r, 150));
      updatedExec = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
      attempts++;
    }

    if (updatedExec && updatedExec.status === 'COMPLETED') {
      res.status(200).json({
        success: true,
        result: updatedExec.output,
        execution: {
          id: updatedExec.id,
          status: updatedExec.status,
          output: updatedExec.output,
        },
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
      return;
    }

    res.status(200).json({
      success: false,
      status: 'EXECUTION_FAILED',
      message: updatedExec?.error || 'Agent execution did not complete successfully',
      execution: {
        id: updatedExec?.id || execution.id,
        status: updatedExec?.status || 'FAILED',
        error: updatedExec?.error || 'Agent execution failed',
      },
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
