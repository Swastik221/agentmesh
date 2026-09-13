import { Router } from 'express';
import {
  listProjects,
  createProject,
  getProjectById,
  updateProject,
  deleteProject,
  getJoinCode,
  rotateJoinCode,
  joinProjectByCode,
} from '../controllers/project.controller.js';
import {
  addMember,
  getProjectMembers,
  updateMemberRole,
  removeMember,
} from '../controllers/member.controller.js';
import { requireAuth } from '../auth/auth.middleware.js';

const router: Router = Router();

// Project Endpoints
router.get('/projects', requireAuth, listProjects);
router.post('/projects', requireAuth, createProject);

// Shareable join code: the owner hands the code out, anyone signed in redeems
// it to become a MEMBER of that exact workspace.
router.post('/projects/join', requireAuth, joinProjectByCode);
router.get('/projects/:projectId/join-code', requireAuth, getJoinCode);
router.post('/projects/:projectId/join-code/rotate', requireAuth, rotateJoinCode);

router.get('/projects/:projectId', requireAuth, getProjectById);
router.patch('/projects/:projectId', requireAuth, updateProject);
router.delete('/projects/:projectId', requireAuth, deleteProject);

// Project Membership Endpoints
router.post('/projects/:projectId/members', requireAuth, addMember);
router.get('/projects/:projectId/members', requireAuth, getProjectMembers);
router.patch('/projects/:projectId/members/:userId', requireAuth, updateMemberRole);
router.delete('/projects/:projectId/members/:userId', requireAuth, removeMember);

export default router;
