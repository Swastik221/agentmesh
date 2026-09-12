import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createInvitation,
  listPendingInvitations,
  listProjectInvitations,
  acceptInvitation,
  declineInvitation,
} from '../controllers/invitation.controller.js';

const router: Router = Router();

router.get('/invitations/pending', requireAuth, listPendingInvitations);
router.post('/invitations/:invitationId/accept', requireAuth, acceptInvitation);
router.post('/invitations/:invitationId/decline', requireAuth, declineInvitation);

router.post('/projects/:projectId/invitations', requireAuth, createInvitation);
router.get('/projects/:projectId/invitations', requireAuth, listProjectInvitations);

export default router;
