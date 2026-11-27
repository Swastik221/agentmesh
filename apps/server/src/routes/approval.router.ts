import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createApproval,
  listApprovals,
  getApprovalById,
  approveApproval,
  rejectApproval,
  retryApprovalResume,
} from '../controllers/approval.controller.js';

const router: Router = Router();

router.post('/approvals', requireAuth, createApproval);
router.get('/approvals', requireAuth, listApprovals);
router.get('/approvals/:approvalId', requireAuth, getApprovalById);
router.post('/approvals/:approvalId/approve', requireAuth, approveApproval);
router.post('/approvals/:approvalId/reject', requireAuth, rejectApproval);
router.post('/approvals/:approvalId/retry', requireAuth, retryApprovalResume);

export default router;
