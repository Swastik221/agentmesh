import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createPaymentRequirementController,
  listProjectPaymentsController,
  getPaymentController,
} from '../controllers/payment.controller.js';

export const paymentRouter: Router = Router();
export const projectPaymentRouter: Router = Router({ mergeParams: true });

projectPaymentRouter.use(requireAuth);
projectPaymentRouter.post('/payments/requirement', createPaymentRequirementController);
projectPaymentRouter.get('/payments', listProjectPaymentsController);

paymentRouter.use(requireAuth);
paymentRouter.get('/payments/:paymentId', getPaymentController);
