import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { approvalService } from '../services/approval.service.js';

const app = createApp();

describe('PRD-35-C1 Human Approval Layer & Execution Gate Corrective Tests', () => {
  let userA: { id: string };
  let userB: { id: string };
  let sessionA: { id: string };
  let sessionB: { id: string };
  let projectA: { id: string };
  let projectB: { id: string };
  let agentA: { id: string };
  let agentB: { id: string };
  let taskA: { id: string };
  let policyA: { id: string };
  let policyB: { id: string };

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
        members: {
          create: [
            { userId: userA.id, role: 'OWNER' },
            { userId: userB.id, role: 'MEMBER' },
          ],
        },
      },
    });

    projectB = await prisma.project.create({
      data: {
        name: 'Project B',
        ownerId: userB.id,
        members: { create: { userId: userB.id, role: 'OWNER' } },
      },
    });

    agentA = await prisma.agent.create({
      data: {
        projectId: projectA.id,
        ownerId: userA.id,
        name: 'Agent A',
        provider: 'test-provider',
        status: 'ONLINE',
      },
    });

    agentB = await prisma.agent.create({
      data: {
        projectId: projectB.id,
        ownerId: userB.id,
        name: 'Agent B',
        provider: 'test-provider',
        status: 'ONLINE',
      },
    });

    taskA = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Task A',
        description: 'Task for approval testing',
        status: 'TODO',
        responsibilities: {
          create: {
            agentId: agentA.id,
          },
        },
      },
    });

    policyA = await prisma.policy.create({
      data: {
        projectId: projectA.id,
        name: 'Policy A',
        action: 'task.execute',
        decision: 'APPROVAL_REQUIRED',
        enabled: true,
      },
    });

    policyB = await prisma.policy.create({
      data: {
        projectId: projectB.id,
        name: 'Policy B',
        action: 'task.execute',
        decision: 'APPROVAL_REQUIRED',
        enabled: true,
      },
    });
  });

  describe('1. Cross-Project Referential Integrity', () => {
    it('rejects creation of approval request referencing policy from another project', async () => {
      const res = await request(app)
        .post('/approvals')
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          projectId: projectA.id,
          action: 'task.execute',
          policyId: policyB.id, // Policy belonging to Project B!
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Policy with ID');
    });

    it('rejects creation of approval request referencing agent from another project', async () => {
      const res = await request(app)
        .post('/approvals')
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          projectId: projectA.id,
          action: 'task.execute',
          agentId: agentB.id, // Agent belonging to Project B!
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Agent with ID');
    });

    it('succeeds when referencing valid same-project policy and agent', async () => {
      const res = await request(app)
        .post('/approvals')
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          projectId: projectA.id,
          action: 'task.execute',
          policyId: policyA.id,
          agentId: agentA.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.policyId).toBe(policyA.id);
      expect(res.body.agentId).toBe(agentA.id);
    });
  });

  describe('2. Race-Safe Approval Idempotency', () => {
    it('genuinely concurrent approval requests produce exactly 1 PENDING approval record and return same record', async () => {
      const idempotencyKey = 'task.execute:concurrent-test-key';

      const [res1, res2] = await Promise.all([
        approvalService.createApprovalRequest(projectA.id, userA.id, {
          projectId: projectA.id,
          action: 'task.execute',
          idempotencyKey,
          metadata: { taskId: taskA.id },
        }),
        approvalService.createApprovalRequest(projectA.id, userA.id, {
          projectId: projectA.id,
          action: 'task.execute',
          idempotencyKey,
          metadata: { taskId: taskA.id },
        }),
      ]);

      expect(res1.id).toBe(res2.id);

      const count = await prisma.approvalRequest.count({
        where: { projectId: projectA.id, idempotencyKey },
      });
      expect(count).toBe(1);
    });
  });

  describe('3. Requester vs Approver Identity Semantics', () => {
    it('preserves User A as original requester when User B approves request', async () => {
      // User A requests blocked task execution
      const execRes = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/executions`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({ agentId: agentA.id });

      expect(execRes.status).toBe(202);
      const approvalId = execRes.body.approvalRequestId;

      // User B (project member) approves request
      const approveRes = await request(app)
        .post(`/approvals/${approvalId}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionB.id}`]);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.requestedByUserId).toBe(userA.id); // User A requester!
      expect(approveRes.body.resolvedByUserId).toBe(userB.id); // User B approver!

      // Resumed execution belongs to User A's task context
      const executions = await prisma.taskExecution.findMany({ where: { taskId: taskA.id } });
      expect(executions.length).toBe(1);
    });
  });

  describe('4. Invalid State Transitions', () => {
    it('rejects invalid state transitions with 409 Conflict', async () => {
      const approvedReq = await prisma.approvalRequest.create({
        data: {
          projectId: projectA.id,
          requestedByUserId: userA.id,
          action: 'task.execute',
          status: 'APPROVED',
          resolvedByUserId: userA.id,
          resolvedAt: new Date(),
        },
      });

      const res1 = await request(app)
        .post(`/approvals/${approvedReq.id}/reject`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);
      expect(res1.status).toBe(409);

      const res2 = await request(app)
        .post(`/approvals/${approvedReq.id}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);
      expect(res2.status).toBe(409);

      const rejectedReq = await prisma.approvalRequest.create({
        data: {
          projectId: projectA.id,
          requestedByUserId: userA.id,
          action: 'task.execute',
          status: 'REJECTED',
          resolvedByUserId: userA.id,
          resolvedAt: new Date(),
        },
      });

      const res3 = await request(app)
        .post(`/approvals/${rejectedReq.id}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);
      expect(res3.status).toBe(409);

      const expiredReq = await prisma.approvalRequest.create({
        data: {
          projectId: projectA.id,
          requestedByUserId: userA.id,
          action: 'task.execute',
          status: 'EXPIRED',
        },
      });

      const res4 = await request(app)
        .post(`/approvals/${expiredReq.id}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);
      expect(res4.status).toBe(409);
    });
  });

  describe('5. End-to-End Artifact Write Policy Gating & Resumption', () => {
    it('ALLOW policy creates artifact directly', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Allow Artifact Write',
          action: 'artifact.write',
          decision: 'ALLOW',
          enabled: true,
        },
      });

      const res = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/artifacts`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          type: 'code',
          name: 'allow-artifact.ts',
          payload: { code: 'console.log("hello")' },
          agentId: agentA.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('allow-artifact.ts');
    });

    it('DENY policy blocks artifact creation with 403 Forbidden', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Deny Artifact Write',
          action: 'artifact.write',
          decision: 'DENY',
          enabled: true,
        },
      });

      const res = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/artifacts`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          type: 'code',
          name: 'deny-artifact.ts',
          payload: { code: 'console.log("hello")' },
          agentId: agentA.id,
        });

      expect(res.status).toBe(403);

      const artifactsCount = await prisma.artifact.count({
        where: { taskId: taskA.id, name: 'deny-artifact.ts' },
      });
      expect(artifactsCount).toBe(0);
    });

    it('APPROVAL_REQUIRED policy gates artifact creation, returning 202 and creating artifact upon approval', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Require Approval for Artifact Write',
          action: 'artifact.write',
          decision: 'APPROVAL_REQUIRED',
          enabled: true,
        },
      });

      const res = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/artifacts`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          type: 'code',
          name: 'gated-artifact.ts',
          payload: { code: 'console.log("gated")' },
          agentId: agentA.id,
        });

      expect(res.status).toBe(202);
      expect(res.body.error).toBe('APPROVAL_REQUIRED');
      const approvalId = res.body.approvalRequestId;
      expect(approvalId).toBeDefined();

      // Verify artifact not created yet
      let count = await prisma.artifact.count({
        where: { taskId: taskA.id, name: 'gated-artifact.ts' },
      });
      expect(count).toBe(0);

      // Approve request
      const approveRes = await request(app)
        .post(`/approvals/${approvalId}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);

      expect(approveRes.status).toBe(200);

      // Verify artifact created exactly once
      count = await prisma.artifact.count({
        where: { taskId: taskA.id, name: 'gated-artifact.ts' },
      });
      expect(count).toBe(1);
    });
  });

  describe('6. Bypass Methods Public Route Isolation', () => {
    it('verifies bypass endpoints are not directly exposed as public routes', async () => {
      const res1 = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/executions/bypass`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);
      expect(res1.status).toBe(404);

      const res2 = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/artifacts/bypass`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);
      expect(res2.status).toBe(404);
    });
  });
});
