import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';

const app = createApp();

describe('PRD-35 Human Approval Layer & Execution Gate', () => {
  let userA: { id: string };
  let userB: { id: string };
  let sessionA: { id: string };
  let sessionB: { id: string };
  let projectA: { id: string };
  let agentA: { id: string };
  let taskA: { id: string };

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

    agentA = await prisma.agent.create({
      data: {
        projectId: projectA.id,
        ownerId: userA.id,
        name: 'Agent A',
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
  });

  describe('Approval Lifecycle & Transitions', () => {
    it('creates, retrieves, and approves a pending request (PENDING -> APPROVED)', async () => {
      const createRes = await request(app)
        .post('/approvals')
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          projectId: projectA.id,
          action: 'task.execute',
          agentId: agentA.id,
          reason: 'Manual execution test',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe('PENDING');
      const approvalId = createRes.body.id;

      // Retrieve Approval
      const getRes = await request(app)
        .get(`/approvals/${approvalId}`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(approvalId);

      // Approve Request
      const approveRes = await request(app)
        .post(`/approvals/${approvalId}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({ reason: 'Approved by project owner' });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');
      expect(approveRes.body.resolvedByUserId).toBe(userA.id);
      expect(approveRes.body.resolvedAt).toBeDefined();
    });

    it('rejects a pending request (PENDING -> REJECTED)', async () => {
      const createRes = await request(app)
        .post('/approvals')
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          projectId: projectA.id,
          action: 'payment.request',
          reason: 'Large payment request',
        });

      const approvalId = createRes.body.id;

      const rejectRes = await request(app)
        .post(`/approvals/${approvalId}/reject`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({ reason: 'Budget limit exceeded' });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe('REJECTED');
      expect(rejectRes.body.resolvedByUserId).toBe(userA.id);
    });
  });

  describe('Invalid State Transitions & Concurrent Approval', () => {
    it('fails invalid transition APPROVED -> REJECTED with 409 Conflict', async () => {
      const reqRecord = await prisma.approvalRequest.create({
        data: {
          projectId: projectA.id,
          requestedByUserId: userA.id,
          action: 'task.execute',
          status: 'APPROVED',
          resolvedByUserId: userA.id,
          resolvedAt: new Date(),
        },
      });

      const res = await request(app)
        .post(`/approvals/${reqRecord.id}/reject`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);

      expect(res.status).toBe(409);
    });

    it('fails invalid transition REJECTED -> APPROVED with 409 Conflict', async () => {
      const reqRecord = await prisma.approvalRequest.create({
        data: {
          projectId: projectA.id,
          requestedByUserId: userA.id,
          action: 'task.execute',
          status: 'REJECTED',
          resolvedByUserId: userA.id,
          resolvedAt: new Date(),
        },
      });

      const res = await request(app)
        .post(`/approvals/${reqRecord.id}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);

      expect(res.status).toBe(409);
    });

    it('prevents race condition: two concurrent approvals result in exactly 1 success and 1 conflict', async () => {
      const reqRecord = await prisma.approvalRequest.create({
        data: {
          projectId: projectA.id,
          requestedByUserId: userA.id,
          action: 'task.execute',
          status: 'PENDING',
        },
      });

      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/approvals/${reqRecord.id}/approve`)
          .set('Cookie', [`agentmesh_session=${sessionA.id}`]),
        request(app)
          .post(`/approvals/${reqRecord.id}/approve`)
          .set('Cookie', [`agentmesh_session=${sessionA.id}`]),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });

  describe('Security & Authorization', () => {
    it('returns 401 for unauthenticated approval calls', async () => {
      const res = await request(app).get('/approvals');
      expect(res.status).toBe(401);
    });

    it('returns 403 for user trying to approve request in another project', async () => {
      const reqRecord = await prisma.approvalRequest.create({
        data: {
          projectId: projectA.id,
          requestedByUserId: userA.id,
          action: 'task.execute',
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post(`/approvals/${reqRecord.id}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionB.id}`]);

      expect(res.status).toBe(403);
    });

    it('ignores client identity spoofing attempts (requestedByUserId, resolvedByUserId, status)', async () => {
      const createRes = await request(app)
        .post('/approvals')
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          projectId: projectA.id,
          action: 'task.execute',
          requestedByUserId: userB.id, // spoof attempt
          status: 'APPROVED', // spoof attempt
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.requestedByUserId).toBe(userA.id); // server-derived!
      expect(createRes.body.status).toBe('PENDING'); // server-enforced!

      const approvalId = createRes.body.id;

      const approveRes = await request(app)
        .post(`/approvals/${approvalId}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          resolvedByUserId: userB.id, // spoof attempt
        });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.resolvedByUserId).toBe(userA.id); // server-derived!
    });
  });

  describe('Execution Gate & Resume Integration', () => {
    it('blocks task execution when APPROVAL_REQUIRED policy exists, creates PENDING request, and resumes execution upon approval', async () => {
      // 1. Create APPROVAL_REQUIRED policy for task.execute
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Require Approval for Task Execution',
          action: 'task.execute',
          decision: 'APPROVAL_REQUIRED',
          enabled: true,
        },
      });

      // 2. Attempt task execution
      const execRes = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/executions`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          agentId: agentA.id,
        });

      expect(execRes.status).toBe(202); // ApprovalRequiredError
      expect(execRes.body.error).toBe('APPROVAL_REQUIRED');
      const approvalRequestId = execRes.body.approvalRequestId;
      expect(approvalRequestId).toBeDefined();

      // Verify execution was NOT created yet
      const execsCount = await prisma.taskExecution.count({ where: { taskId: taskA.id } });
      expect(execsCount).toBe(0);

      // 3. Human Approves the Request
      const approveRes = await request(app)
        .post(`/approvals/${approvalRequestId}/approve`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`]);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');

      // 4. Verify execution was automatically resumed and created!
      const postExecs = await prisma.taskExecution.findMany({ where: { taskId: taskA.id } });
      expect(postExecs.length).toBe(1);
      expect(postExecs[0].agentId).toBe(agentA.id);
    });

    it('rejects task execution immediately when DENY policy exists', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Deny Task Execution',
          action: 'task.execute',
          decision: 'DENY',
          enabled: true,
        },
      });

      const execRes = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/executions`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({
          agentId: agentA.id,
        });

      expect(execRes.status).toBe(403);
      const execsCount = await prisma.taskExecution.count({ where: { taskId: taskA.id } });
      expect(execsCount).toBe(0);
    });

    it('avoids duplicate uncontrolled pending approval creation when retrying blocked execution', async () => {
      await prisma.policy.create({
        data: {
          projectId: projectA.id,
          name: 'Require Approval',
          action: 'task.execute',
          decision: 'APPROVAL_REQUIRED',
          enabled: true,
        },
      });

      const res1 = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/executions`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({ agentId: agentA.id });

      const res2 = await request(app)
        .post(`/projects/${projectA.id}/tasks/${taskA.id}/executions`)
        .set('Cookie', [`agentmesh_session=${sessionA.id}`])
        .send({ agentId: agentA.id });

      expect(res1.body.approvalRequestId).toBe(res2.body.approvalRequestId);

      const totalApprovals = await prisma.approvalRequest.count({
        where: { projectId: projectA.id, action: 'task.execute' },
      });
      expect(totalApprovals).toBe(1);
    });
  });
});
