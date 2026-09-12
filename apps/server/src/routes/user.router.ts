import { Router } from 'express';
import {
  createUser,
  getUserById,
  getUserByWallet,
  updateUser,
  getUserProjects,
} from '../controllers/user.controller.js';

import { requireAuth } from '../auth/auth.middleware.js';

const router: Router = Router();

router.use(requireAuth);

router.post('/users', createUser);
router.get('/users/wallet/:walletAddress', getUserByWallet);
router.get('/users/:userId', getUserById);
router.patch('/users/:userId', updateUser);
router.get('/users/:userId/projects', getUserProjects);

export default router;
