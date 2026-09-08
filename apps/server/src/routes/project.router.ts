import { Router } from 'express';
import {
  listProjects,
  createProject,
  getProjectById,
  updateProject,
  deleteProject,
} from '../controllers/project.controller.js';
import {
  addMember,
  getProjectMembers,
  updateMemberRole,
  removeMember,
} from '../controllers/member.controller.js';
import { optionalAuth, requireAuth } from '../auth/auth.middleware.js';

const router: Router = Router();

// Project Endpoints
router.get('/projects', requireAuth, listProjects);
router.post('/projects', optionalAuth, createProject);

router.get('/projects/:projectId', getProjectById);
router.patch('/projects/:projectId', updateProject);
router.delete('/projects/:projectId', deleteProject);

// Project Membership Endpoints
router.post('/projects/:projectId/members', addMember);
router.get('/projects/:projectId/members', getProjectMembers);
router.patch('/projects/:projectId/members/:userId', updateMemberRole);
router.delete('/projects/:projectId/members/:userId', removeMember);

export default router;
