import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { policyService } from '../services/policy.service.js';

const app = createApp();

describe('PRD-35 Policy Enforcement Layer', () => {
  let userA: { id: string };
  let userB: { id: string };
  let sessionA: { id: string };
  let sessionB: { id: string };
  let projectA: { id: string };
  let projectB: { id: string };

  beforeEach(async () => {
    await prisma.approvalRequest.deleteMany();
    await prisma.policy.deleteMany();
    await prisma.gitWorktree.deleteMany();
    await prisma.taskExecution.deleteMany();
    await prisma.taskResponsibility.deleteMany();
    await prisma.taskDependency.deleteMany();
    await prisma.artifact.deleteMany();
    await prisma.task.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectBrainEntry.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.projectWorkspace.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();

    userA = await prisma.user.create({
      data: { walletAddress: '0x1111111111111111111111111111111111111111', displayName: 'User A' },
    });
    sessionA = await sessionService.createSession(userA.id);

    userB = await prisma.user.create({
      data: { walletAddress: '0x2222222222222222222222222222222222222222', displayName: 'User B' },
    });
    sessionB = await sessionService.createSession(userB.id);

    projectA = await prisma.project.create({
      data: {
        name: 'Project A',
        ownerId: userA.id,
        members: { create: { userId: userA.id, role: 'OWNER' } },
      },
    });

    projectB = await prisma.project.create({
      data: {
        name: 'Project B',
        ownerId: userB.id,
        members: { create: { userId: userB.id, role: 'OWNER' } },
      },
    });
  });

  describe('Basic Evaluation & Precedence', () => {
    it('returns ALLOW when no policy matches', async () => {
      const res = await policyService.evaluateAction(projectA.id, 'task.execute');
      expect(res.decision).toBe('ALLOW');
      expect(res.matchedPolicies.length).toBe(0);
    });

    it('evaluates ALLOW policy -> ALLOW', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Allow Policy',
          action: 'task.execute',
          decision: 'ALLOW',
          enabled: true,
        },
      });

      const res = await policyService.evaluateAction(projectA.id, 'task.execute');
      expect(res.decision).toBe('ALLOW');
    });

    it('evaluates APPROVAL_REQUIRED policy -> APPROVAL_REQUIRED', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Require Approval Policy',
          action: 'task.execute',
          decision: 'APPROVAL_REQUIRED',
          enabled: true,
        },
      });

      const res = await policyService.evaluateAction(projectA.id, 'task.execute');
      expect(res.decision).toBe('APPROVAL_REQUIRED');
    });

    it('evaluates DENY policy -> DENY', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Deny Policy',
          action: 'task.execute',
          decision: 'DENY',
          enabled: true,
        },
      });

      const res = await policyService.evaluateAction(projectA.id, 'task.execute');
      expect(res.decision).toBe('DENY');
    });

    it('enforces precedence ALLOW + APPROVAL_REQUIRED -> APPROVAL_REQUIRED', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Allow Policy',
          action: 'task.execute',
          decision: 'ALLOW',
          enabled: true,
        },
      });
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Approval Policy',
          action: 'task.execute',
          decision: 'APPROVAL_REQUIRED',
          enabled: true,
        },
      });

      const res = await policyService.evaluateAction(projectA.id, 'task.execute');
      expect(res.decision).toBe('APPROVAL_REQUIRED');
    });

    it('enforces precedence ALLOW + DENY -> DENY', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Allow Policy',
          action: 'task.execute',
          decision: 'ALLOW',
          enabled: true,
        },
      });
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Deny Policy',
          action: 'task.execute',
          decision: 'DENY',
          enabled: true,
        },
      });

      const res = await policyService.evaluateAction(projectA.id, 'task.execute');
      expect(res.decision).toBe('DENY');
    });

    it('enforces precedence APPROVAL_REQUIRED + DENY -> DENY', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Approval Policy',
          action: 'task.execute',
          decision: 'APPROVAL_REQUIRED',
          enabled: true,
        },
      });
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Deny Policy',
          action: 'task.execute',
          decision: 'DENY',
          enabled: true,
        },
      });

      const res = await policyService.evaluateAction(projectA.id, 'task.execute');
      expect(res.decision).toBe('DENY');
    });

    it('ignores disabled policy', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Disabled Deny Policy',
          action: 'task.execute',
          decision: 'DENY',
          enabled: false,
        },
      });

      const res = await policyService.evaluateAction(projectA.id, 'task.execute');
      expect(res.decision).toBe('ALLOW');
    });

    it('enforces cross-project isolation in policy evaluation', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Project A Deny',
          action: 'task.execute',
          decision: 'DENY',
          enabled: true,
        },
      });

      const resB = await policyService.evaluateAction(projectB.id, 'task.execute');
      expect(resB.decision).toBe('ALLOW');
    });
  });

  describe('Policy Management REST APIs', () => {
    it('creates, lists, gets, updates, and deletes policies', async () => {
      // 1. Create Policy
      const createRes = await request(app)
        .post(`/projects/${projectA.id}/policies`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          name: 'Auto Approve Reads',
          description: 'Allow all artifact read actions',
          action: 'artifact.read',
          decision: 'ALLOW',
          enabled: true,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.name).toBe('Auto Approve Reads');
      const policyId = createRes.body.id;

      // 2. List Policies
      const listRes = await request(app)
        .get(`/projects/${projectA.id}/policies`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);

      expect(listRes.status).toBe(200);
      expect(listRes.body.policies.length).toBe(1);

      // 3. Get Policy
      const getRes = await request(app)
        .get(`/projects/${projectA.id}/policies/${policyId}`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(policyId);

      // 4. Update Policy
      const updateRes = await request(app)
        .patch(`/projects/${projectA.id}/policies/${policyId}`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          decision: 'APPROVAL_REQUIRED',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.decision).toBe('APPROVAL_REQUIRED');

      // 5. Delete Policy
      const delRes = await request(app)
        .delete(`/projects/${projectA.id}/policies/${policyId}`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);

      expect(delRes.status).toBe(200);
    });

    it('returns 401 for unauthenticated policy requests', async () => {
      const res = await request(app).get(`/projects/${projectA.id}/policies`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for unauthorized non-member project access', async () => {
      const res = await request(app)
        .get(`/projects/${projectA.id}/policies`)
        .set('Cookie', [`agentmesh_session=${sessionB.id}`]);

      expect(res.status).toBe(403);
    });
  });
});
