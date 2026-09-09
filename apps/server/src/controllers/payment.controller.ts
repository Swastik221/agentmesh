import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { paymentService } from '../payments/payment.service.js';
import { createPaymentRequirementSchema } from '../schemas/payment.schema.js';
import { UnauthorizedError } from '../errors/app-error.js';

export async function createPaymentRequirementController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError();
    }

    const projectId = req.params.projectId as string;
    const body = createPaymentRequirementSchema.parse(req.body);

    const result = await paymentService.createPaymentRequirement({
      projectId,
      requesterUserId: actorUserId,
      agentId: body.agentId,
      action: body.action,
      amount: body.amount,
      asset: body.asset,
      network: body.network,
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function listProjectPaymentsController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError();
    }

    const projectId = req.params.projectId as string;
    const payments = await paymentService.listProjectPayments(projectId, actorUserId);

    res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (err) {
    next(err);
  }
}

export async function getPaymentController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actorUserId = req.auth?.userId;
    if (!actorUserId) {
      throw new UnauthorizedError();
    }

    const paymentId = req.params.paymentId as string;
    const payment = await paymentService.getPaymentById(paymentId, actorUserId);

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (err) {
    next(err);
  }
}
