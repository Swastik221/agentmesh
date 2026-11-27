import { Router } from 'express';
import { getNonce, verify, getMe, logout } from './auth.controller.js';
import { requireAuth } from './auth.middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { config } from '../config/index.js';

const router: Router = Router();

// Unauthenticated and cheap to call: limit per client IP.
router.get('/auth/nonce', rateLimit({ name: 'sign-in nonce', windowMs: 60_000, max: config.rateLimits.nonce }), getNonce);
router.post('/auth/verify', rateLimit({ name: 'sign-in', windowMs: 60_000, max: config.rateLimits.verify }), verify);
router.get('/auth/me', requireAuth, getMe);
router.post('/auth/logout', logout);

export default router;
