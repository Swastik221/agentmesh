import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { terminalVisibilitySchema } from '@agentmesh/agent-protocol';
import { requireAuth } from '../auth/auth.middleware.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { UnauthorizedError } from '../errors/app-error.js';
import { terminalService } from './terminal.service.js';
import { workspaceContextService } from '../context/workspace-context.service.js';

const router: Router = Router();

const updateSchema = z.object({ visibility: terminalVisibilitySchema }).strict();
const tailQuerySchema = z.object({ maxBytes: z.coerce.number().int().min(1).max(64 * 1024).optional() });
const contextQuerySchema = z.object({
  taskId: z.string().trim().min(1).optional(),
  filePaths: z.string().optional(),
});

const userOf = (req: AuthenticatedRequest): string => {
  const userId = req.auth?.userId;
  if (!userId) throw new UnauthorizedError('Authentication required');
  return userId;
};

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<void>;
const wrap =
  (fn: Handler) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/** Sessions the caller may see: their own, and everyone's shared ones. */
router.get(
  '/projects/:projectId/terminals',
  requireAuth,
  wrap(async (req, res) => {
    const includeClosed = req.query.includeClosed === 'true';
    const sessions = await terminalService.listVisible(req.params.projectId as string, userOf(req), includeClosed);
    res.status(200).json({ sessions });
  }),
);

/** Recent redacted output of a session the caller may view. */
router.get(
  '/projects/:projectId/terminals/:terminalId/output',
  requireAuth,
  wrap(async (req, res) => {
    const { maxBytes } = tailQuerySchema.parse(req.query);
    const tail = await terminalService.tail(
      req.params.projectId as string,
      req.params.terminalId as string,
      userOf(req),
      maxBytes,
    );
    res.status(200).json({ terminalId: req.params.terminalId, ...tail });
  }),
);

/** Owner only: share read-only, or make private again (revokes viewers). */
router.patch(
  '/projects/:projectId/terminals/:terminalId',
  requireAuth,
  wrap(async (req, res) => {
    const { visibility } = updateSchema.parse(req.body);
    const session = await terminalService.update(
      req.params.projectId as string,
      req.params.terminalId as string,
      userOf(req),
      { visibility },
    );
    res.status(200).json({ terminalId: session.id, visibility: session.visibility, status: session.status });
  }),
);

/** Owner only: disconnect the session from the workspace. The local terminal keeps running. */
router.delete(
  '/projects/:projectId/terminals/:terminalId',
  requireAuth,
  wrap(async (req, res) => {
    await terminalService.close(req.params.projectId as string, req.params.terminalId as string, userOf(req));
    res.status(204).send();
  }),
);

/**
 * The structured context an agent receives, as the calling member sees it.
 * Lets a human check what their agent will know before it starts.
 */
router.get(
  '/projects/:projectId/agents/:agentId/context',
  requireAuth,
  wrap(async (req, res) => {
    const query = contextQuerySchema.parse(req.query);
    const filePaths = query.filePaths
      ?.split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 100);
    const context = await workspaceContextService.buildForAgent(
      req.params.projectId as string,
      req.params.agentId as string,
      userOf(req),
      { taskId: query.taskId, filePaths },
    );
    res.status(200).json({ context });
  }),
);

export default router;
