import { Router } from 'express';
import {
  addCapability,
  listCapabilities,
  removeCapability,
} from '../controllers/agent-capability.controller.js';

const router: Router = Router();

// Agent Capability Endpoints
router.post('/agents/:agentId/capabilities', addCapability);
router.get('/agents/:agentId/capabilities', listCapabilities);
router.delete('/agents/:agentId/capabilities/:capability', removeCapability);

export default router;
