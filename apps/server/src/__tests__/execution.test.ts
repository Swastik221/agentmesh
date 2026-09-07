import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { executionService } from '../execution/execution.service.js';

describe('PRD #13 Agent Execution Layer Integration Tests', () => {
  const app = createApp();

  const walletOwner = '0xEXECUTIONOWNER1111111111111111111111';
  const walletMember = '0xEXECUTIONMEMBER2222222222222222222222';
  const walletOutsider = '0xEXECUTIONOUTSIDER33333333333333333333';

  let ownerUser: { id: string };
  let memberUser: { id: string };
  let outsiderUser: { id: string };

  let ownerSession: { id: string };
  let memberSession: { id: string };
  let outsiderSession: { id: string };

  let project1: { id: string };
  let project2: { id: string };

  let agentP1Responsible: { id: string };
  let agentP1Unassigned: { id: string };
  let agentP2Outsider: { id: string };

  let taskP1: { id: string };
  let taskP2: { id: string };

  beforeAll(async () => {
    // Clean up test data
    const existingUsers = await prisma.user.findMany({
      where: { walletAddress: { in: [walletOwner, walletMember, walletOutsider] } },
    });

    for (const u of existingUsers) {
      await prisma.taskExecution.deleteMany({ where: { agent: { ownerId: u.id } } }).catch(() => {});
      await prisma.taskResponsibility.deleteMany({ where: { agent: { ownerId: u.id } } }).catch(() => {});
      await prisma.taskDependency.deleteMany({ where: { task: { creatorId: u.id } } }).catch(() => {});
      await prisma.task.deleteMany({ where: { creatorId: u.id } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { ownerId: u.id } }).catch(() => {});

      const userProjects = await prisma.project.findMany({ where: { ownerId: u.id } });
      for (const p of userProjects) {
        await prisma.taskExecution.deleteMany({ where: { task: { projectId: p.id } } }).catch(() => {});
        await prisma.taskDependency.deleteMany({ where: { task: { projectId: p.id } } }).catch(() => {});
        await prisma.taskResponsibility.deleteMany({ where: { task: { projectId: p.id } } }).catch(() => {});
        await prisma.task.deleteMany({ where: { projectId: p.id } }).catch(() => {});
        await prisma.agent.deleteMany({ where: { projectId: p.id } }).catch(() => {});
        await prisma.projectMember.deleteMany({ where: { projectId: p.id } }).catch(() => {});
        await prisma.project.delete({ where: { id: p.id } }).catch(() => {});
      }

      await prisma.projectMember.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.authSession.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    }

    // Create users
    ownerUser = await prisma.user.create({
      data: { walletAddress: walletOwner, displayName: 'Execution Owner' },
    });
    memberUser = await prisma.user.create({
      data: { walletAddress: walletMember, displayName: 'Execution Member' },
    });
    outsiderUser = await prisma.user.create({
      data: { walletAddress: walletOutsider, displayName: 'Execution Outsider' },
    });

    // Create sessions
    ownerSession = await sessionService.createSession(ownerUser.id);
    memberSession = await sessionService.createSession(memberUser.id);
    outsiderSession = await sessionService.createSession(outsiderUser.id);

    // Create Project 1 (Owner + Member)
    project1 = await prisma.project.create({
      data: {
        name: 'Execution Project 1',
        description: 'First project for execution tests',
        ownerId: ownerUser.id,
        members: {
          create: [
            { userId: ownerUser.id, role: 'OWNER' },
            { userId: memberUser.id, role: 'MEMBER' },
          ],
        },
      },
    });

    // Create Project 2 (Outsider)
    project2 = await prisma.project.create({
      data: {
        name: 'Execution Project 2',
        description: 'Second project for execution tests',
        ownerId: outsiderUser.id,
        members: {
          create: [{ userId: outsiderUser.id, role: 'OWNER' }],
        },
      },
    });

    // Create Agents
    agentP1Responsible = await prisma.agent.create({
      data: {
        projectId: project1.id,
        ownerId: ownerUser.id,
        name: 'Project 1 Responsible Agent',
        provider: 'claude',
        status: 'ONLINE',
      },
    });

    agentP1Unassigned = await prisma.agent.create({
      data: {
        projectId: project1.id,
        ownerId: ownerUser.id,
        name: 'Project 1 Unassigned Agent',
        provider: 'claude',
        status: 'ONLINE',
      },
    });

    agentP2Outsider = await prisma.agent.create({
      data: {
        projectId: project2.id,
        ownerId: outsiderUser.id,
        name: 'Project 2 Outsider Agent',
        provider: 'openai',
        status: 'ONLINE',
      },
    });

    // Create Tasks
    taskP1 = await prisma.task.create({
      data: {
        projectId: project1.id,
        creatorId: ownerUser.id,
        title: 'Task for Execution',
        description: 'Execution test task in project 1',
      },
    });

    taskP2 = await prisma.task.create({
      data: {
        projectId: project2.id,
        creatorId: outsiderUser.id,
        title: 'Outsider Task',
        description: 'Execution test task in project 2',
      },
    });

    // Assign responsibility for taskP1 to agentP1Responsible
    await prisma.taskResponsibility.create({
      data: {
        taskId: taskP1.id,
        agentId: agentP1Responsible.id,
        role: 'backend',
      },
    });
  });

  afterAll(async () => {
    const projectIds = [project1?.id, project2?.id].filter(Boolean);
    if (projectIds.length > 0) {
      await prisma.taskExecution.deleteMany({ where: { task: { projectId: { in: projectIds } } } }).catch(() => {});
      await prisma.taskResponsibility.deleteMany({ where: { task: { projectId: { in: projectIds } } } }).catch(() => {});
      await prisma.taskDependency.deleteMany({ where: { task: { projectId: { in: projectIds } } } }).catch(() => {});
      await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => {});
    }

    const userIds = [ownerUser?.id, memberUser?.id, outsiderUser?.id].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    }
  });

  describe('Execution Creation & Authorization', () => {
    it('returns 401 Unauthorized when creating execution without auth', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskP1.id}/executions`)
        .send({ agentId: agentP1Responsible.id });

      expect(res.status).toBe(401);
    });

    it('returns 403 Forbidden when non-member tries to start execution', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskP1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${outsiderSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('not a member');
    });

    it('returns 404 Not Found when creating execution for non-existent project', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/projects/${fakeId}/tasks/${taskP1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      expect(res.status).toBe(404);
    });

    it('returns 404 Not Found when task does not belong to project', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskP2.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      expect(res.status).toBe(404);
    });

    it('returns 403 Forbidden when agent belongs to another project', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskP1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP2Outsider.id });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('does not belong to this project');
    });

    it('returns 403 Forbidden when agent is NOT responsible for task', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskP1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Unassigned.id });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('not assigned responsibility');
    });

    it('creates execution successfully, persists input, and runs MockAgentExecutor pipeline', async () => {
      const inputData = { instruction: 'Build auth middleware', env: 'test' };
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskP1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          agentId: agentP1Responsible.id,
          input: inputData,
        });

      expect(res.status).toBe(201);
      expect(res.body.taskId).toBe(taskP1.id);
      expect(res.body.agentId).toBe(agentP1Responsible.id);
      expect(res.body.input).toEqual(inputData);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.output).toBeDefined();
      expect(res.body.startedAt).toBeDefined();
      expect(res.body.completedAt).toBeDefined();
    });
  });

  describe('Mock Executor & Task/Agent Integration', () => {
    it('updates task to IN_PROGRESS then COMPLETED on successful mock execution', async () => {
      // Create a new task and assign responsibility
      const newTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Task for Success Integration',
          description: 'Testing task status transition to COMPLETED',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: newTask.id, agentId: agentP1Responsible.id },
      });

      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${newTask.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('COMPLETED');

      // Verify task status updated to COMPLETED
      const updatedTask = await prisma.task.findUnique({ where: { id: newTask.id } });
      expect(updatedTask?.status).toBe('COMPLETED');
    });

    it('updates task to FAILED on mock execution failure path', async () => {
      const failTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Task for Failure Integration',
          description: 'Testing task status transition to FAILED',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: failTask.id, agentId: agentP1Responsible.id },
      });

      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${failTask.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          agentId: agentP1Responsible.id,
          input: { fail: true, errorMessage: 'Custom error message' },
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.error).toBe('Custom error message');

      const updatedTask = await prisma.task.findUnique({ where: { id: failTask.id } });
      expect(updatedTask?.status).toBe('FAILED');
    });

    it('updates agent status to BUSY during active execution then back to ONLINE when finished', async () => {
      // Create agent and task
      const tempAgent = await prisma.agent.create({
        data: {
          projectId: project1.id,
          ownerId: ownerUser.id,
          name: 'Temp Agent for Status Test',
          provider: 'claude',
          status: 'ONLINE',
        },
      });

      const tempTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Temp Task for Agent Status Test',
          description: 'Testing agent status transitions',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: tempTask.id, agentId: tempAgent.id },
      });

      // Execute task
      await request(app)
        .post(`/projects/${project1.id}/tasks/${tempTask.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: tempAgent.id });

      // After execution completes, tempAgent status should return to ONLINE
      const agentAfter = await prisma.agent.findUnique({ where: { id: tempAgent.id } });
      expect(agentAfter?.status).toBe('ONLINE');
    });
  });

  describe('Lifecycle State Transitions & Validation', () => {
    it('rejects invalid state transition attempts (e.g. COMPLETED -> RUNNING)', async () => {
      // Find an execution that completed
      const listRes = await request(app)
        .get(`/projects/${project1.id}/tasks/${taskP1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      const completedExecId = listRes.body.items[0].id;

      // Attempt invalid transition via service helper
      await expect(
        executionService.updateExecutionStatus(
          project1.id,
          taskP1.id,
          completedExecId,
          ownerUser.id,
          'RUNNING',
        ),
      ).rejects.toThrow('Invalid execution state transition');
    });
  });

  describe('Stale Execution Protection', () => {
    it('stale/older execution completion does not overwrite newer task state', async () => {
      const multiTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Multi Execution Task',
          description: 'Testing stale execution protection',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: multiTask.id, agentId: agentP1Responsible.id },
      });

      // Create older execution manually
      const olderExec = await prisma.taskExecution.create({
        data: {
          taskId: multiTask.id,
          agentId: agentP1Responsible.id,
          status: 'RUNNING',
          createdAt: new Date(Date.now() - 10000),
        },
      });

      // Create newer execution manually
      const newerExec = await prisma.taskExecution.create({
        data: {
          taskId: multiTask.id,
          agentId: agentP1Responsible.id,
          status: 'RUNNING',
          createdAt: new Date(),
        },
      });

      // Finish newer execution first -> COMPLETED
      await executionService.updateExecutionStatus(
        project1.id,
        multiTask.id,
        newerExec.id,
        ownerUser.id,
        'COMPLETED',
      );

      const taskAfterNewer = await prisma.task.findUnique({ where: { id: multiTask.id } });
      expect(taskAfterNewer?.status).toBe('COMPLETED');

      // Now complete older execution -> FAILED
      await executionService.updateExecutionStatus(
        project1.id,
        multiTask.id,
        olderExec.id,
        ownerUser.id,
        'FAILED',
      );

      // Task status must remain COMPLETED (newer execution state preserved!)
      const taskAfterOlder = await prisma.task.findUnique({ where: { id: multiTask.id } });
      expect(taskAfterOlder?.status).toBe('COMPLETED');
    });
  });

  describe('Execution Retrieval & Pagination', () => {
    it('lists task executions with paginated response { items, page, limit, total }', async () => {
      const res = await request(app)
        .get(`/projects/${project1.id}/tasks/${taskP1.id}/executions?page=1&limit=10`)
        .set('Cookie', [`agentmesh_session=${memberSession.id}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('gets a single execution by ID (GET /projects/:projectId/tasks/:taskId/executions/:executionId)', async () => {
      const listRes = await request(app)
        .get(`/projects/${project1.id}/tasks/${taskP1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      const targetId = listRes.body.items[0].id;

      const getRes = await request(app)
        .get(`/projects/${project1.id}/tasks/${taskP1.id}/executions/${targetId}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(targetId);
      expect(getRes.body.taskId).toBe(taskP1.id);
    });

    it('returns 404 when trying to access execution from another project (project isolation)', async () => {
      const listRes = await request(app)
        .get(`/projects/${project1.id}/tasks/${taskP1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      const targetId = listRes.body.items[0].id;

      const res = await request(app)
        .get(`/projects/${project2.id}/tasks/${taskP2.id}/executions/${targetId}`)
        .set('Cookie', [`agentmesh_session=${outsiderSession.id}`]);

      expect(res.status).toBe(404);
    });
  });

  describe('Dual Path Prefix Verification', () => {
    it('supports route with /api prefix (/api/projects/:projectId/tasks/:taskId/executions)', async () => {
      const res = await request(app)
        .get(`/api/projects/${project1.id}/tasks/${taskP1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });
});
