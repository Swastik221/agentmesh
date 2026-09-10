import { Router, Response, NextFunction } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { AuthenticatedRequest } from '../auth/auth.types.js';
import { demoOrchestrator } from '../demo/demo-orchestrator.js';

export const demoRouter: Router = Router();

/**
 * POST /demo/run
 * Requires SIWE authentication.
 * Triggers deterministic / mock mode of DemoOrchestrator for browser demonstration.
 * Never executes live Hedera settlement or accepts client-controlled payment parameters.
 */
demoRouter.post(['/demo/run', '/api/demo/run'], requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }

    const result = await demoOrchestrator.runDemo({
      mockHederaSettlement: true,
      userId,
    });

    res.json({
      success: true,
      mode: 'AUTOMATED_DETERMINISTIC_DEMO',
      isLive: false,
      result,
    });
  } catch (err) {
    next(err);
  }
});
