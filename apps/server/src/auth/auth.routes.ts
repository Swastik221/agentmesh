import { Router } from 'express';
import { getNonce, verify, getMe, logout } from './auth.controller.js';
import { requireAuth } from './auth.middleware.js';

const router: Router = Router();

router.get('/auth/nonce', getNonce);
router.post('/auth/verify', verify);
router.get('/auth/me', requireAuth, getMe);
router.post('/auth/logout', logout);

export default router;
