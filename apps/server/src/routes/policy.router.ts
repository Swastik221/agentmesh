import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createPolicy,
  listPolicies,
  getPolicyById,
  updatePolicy,
  deletePolicy,
} from '../controllers/policy.controller.js';

const router: Router = Router();

router.post('/projects/:projectId/policies', requireAuth, createPolicy);
router.get('/projects/:projectId/policies', requireAuth, listPolicies);
router.get('/projects/:projectId/policies/:policyId', requireAuth, getPolicyById);
router.patch('/projects/:projectId/policies/:policyId', requireAuth, updatePolicy);
router.delete('/projects/:projectId/policies/:policyId', requireAuth, deletePolicy);

export default router;
