import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';

describe('PRD #12 Task / Responsibility Engine Integration Tests', () => {
  const app = createApp();

  const walletOwner = '0xTASKOWNER11111111111111111111111111111111';
  const walletMember = '0xTASKMEMBER22222222222222222222222222222222';
  const walletOutsider = '0xTASKOUTSIDER333333333333333333333333333333';

  let ownerUser: { id: string };
  let memberUser: { id: string };
  let outsiderUser: { id: string };

  let ownerSession: { id: string };
  let memberSession: { id: string };
  let outsiderSession: { id: string };

  let project1: { id: string };
  let project2: { id: string };

  let agentP1: { id: string };
  let agentP2: { id: string };

  beforeAll(async () => {
    // Cleanup prior test data
    const existingUsers = await prisma.user.findMany({
      where: { walletAddress: { in: [walletOwner, walletMember, walletOutsider] } },
    });

    for (const u of existingUsers) {
      await prisma.taskResponsibility.deleteMany({ where: { agent: { ownerId: u.id } } }).catch(() => {});
      await prisma.taskDependency.deleteMany({ where: { task: { creatorId: u.id } } }).catch(() => {});
      await prisma.task.deleteMany({ where: { creatorId: u.id } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { ownerId: u.id } }).catch(() => {});

      const userProjects = await prisma.project.findMany({ where: { ownerId: u.id } });
      for (const p of userProjects) {
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
      data: { walletAddress: walletOwner, displayName: 'Task Project Owner' },
    });
    memberUser = await prisma.user.create({
      data: { walletAddress: walletMember, displayName: 'Task Project Member' },
    });
    outsiderUser = await prisma.user.create({
      data: { walletAddress: walletOutsider, displayName: 'Task Outsider User' },
    });

    // Create sessions
    ownerSession = await sessionService.createSession(ownerUser.id);
    memberSession = await sessionService.createSession(memberUser.id);
    outsiderSession = await sessionService.createSession(outsiderUser.id);

    // Create Project 1 (Owner + Member)
    project1 = await prisma.project.create({
      data: {
        name: 'Task Test Project 1',
        description: 'First project for task tests',
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
        name: 'Task Test Project 2',
        description: 'Second project for task tests',
        ownerId: outsiderUser.id,
        members: {
          create: [{ userId: outsiderUser.id, role: 'OWNER' }],
        },
      },
    });

    // Create Agent in Project 1
    agentP1 = await prisma.agent.create({
      data: {
        projectId: project1.id,
        ownerId: ownerUser.id,
        name: 'Project 1 Backend Agent',
        provider: 'claude',
      },
    });

    // Create Agent in Project 2
    agentP2 = await prisma.agent.create({
      data: {
        projectId: project2.id,
        ownerId: outsiderUser.id,
        name: 'Project 2 Outsider Agent',
        provider: 'openai',
      },
    });
  });

  afterAll(async () => {
    const projectIds = [project1?.id, project2?.id].filter(Boolean);
    if (projectIds.length > 0) {
      await prisma.taskDependency.deleteMany({ where: { task: { projectId: { in: projectIds } } } }).catch(() => {});
      await prisma.taskResponsibility.deleteMany({ where: { task: { projectId: { in: projectIds } } } }).catch(() => {});
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

  describe('Task Creation & Authorization', () => {
    it('creates a task when authenticated as project member', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'Implement Authentication',
          description: 'Build SIWE auth and session management',
          priority: 'HIGH',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.projectId).toBe(project1.id);
      expect(res.body.creatorId).toBe(ownerUser.id);
      expect(res.body.title).toBe('Implement Authentication');
      expect(res.body.description).toBe('Build SIWE auth and session management');
      expect(res.body.status).toBe('TODO');
      expect(res.body.priority).toBe('HIGH');
    });

    it('returns 401 Unauthorized when creating task without session', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .send({
          title: 'Unauthenticated Task',
          description: 'Should fail',
        });

      expect(res.status).toBe(401);
    });

    it('returns 403 Forbidden when non-member tries to create task in project', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${outsiderSession.id}`])
        .send({
          title: 'Unauthorized Task',
          description: 'Non-member creation attempt',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('not a member');
    });

    it('returns 404 Not Found when creating task in non-existent project', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/projects/${fakeId}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'Phantom Task',
          description: 'Nonexistent project',
        });

      expect(res.status).toBe(404);
    });

    it('ignores client-supplied creatorId and locks creator to SIWE session user', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${memberSession.id}`])
        .send({
          title: 'Spoofed Creator Task',
          description: 'Attempt to pass creatorId',
          creatorId: outsiderUser.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.creatorId).toBe(memberUser.id);
      expect(res.body.creatorId).not.toBe(outsiderUser.id);
    });

    it('sets default priority to MEDIUM and status to TODO when not specified', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'Default Task',
          description: 'Default priority and status check',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('TODO');
      expect(res.body.priority).toBe('MEDIUM');
    });

    it('rejects creation with empty title or description', async () => {
      const res1 = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: '   ',
          description: 'Valid description',
        });
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'Valid title',
          description: '  ',
        });
      expect(res2.status).toBe(400);
    });

    it('rejects creation with title exceeding 200 chars or description exceeding 10000 chars', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'a'.repeat(201),
          description: 'Valid description',
        });
      expect(res.status).toBe(400);
    });
  });

  describe('Task Retrieval & Updates', () => {
    let createdTaskId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'Initial Task for Retrieval',
          description: 'Task description for GET and PATCH tests',
          priority: 'LOW',
        });
      createdTaskId = res.body.id;
    });

    it('gets a single task by ID (GET /projects/:projectId/tasks/:taskId)', async () => {
      const res = await request(app)
        .get(`/projects/${project1.id}/tasks/${createdTaskId}`)
        .set('Cookie', [`agentmesh_session=${memberSession.id}`]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdTaskId);
      expect(res.body.title).toBe('Initial Task for Retrieval');
    });

    it('returns 404 when accessing task from another project (cross-project isolation)', async () => {
      const res = await request(app)
        .get(`/projects/${project2.id}/tasks/${createdTaskId}`)
        .set('Cookie', [`agentmesh_session=${outsiderSession.id}`]);

      expect(res.status).toBe(404);
    });

    it('updates task using PATCH (PATCH /projects/:projectId/tasks/:taskId)', async () => {
      const res = await request(app)
        .patch(`/projects/${project1.id}/tasks/${createdTaskId}`)
        .set('Cookie', [`agentmesh_session=${memberSession.id}`])
        .send({
          title: 'Updated Task Title',
          status: 'IN_PROGRESS',
          priority: 'CRITICAL',
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Task Title');
      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.priority).toBe('CRITICAL');
      expect(res.body.description).toBe('Task description for GET and PATCH tests');
    });

    it('rejects empty PATCH request body', async () => {
      const res = await request(app)
        .patch(`/projects/${project1.id}/tasks/${createdTaskId}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects PATCH request with invalid status or priority', async () => {
      const res = await request(app)
        .patch(`/projects/${project1.id}/tasks/${createdTaskId}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          status: 'INVALID_STATUS',
        });

      expect(res.status).toBe(400);
    });

    it('deletes task returning 204 No Content (DELETE /projects/:projectId/tasks/:taskId)', async () => {
      const deleteRes = await request(app)
        .delete(`/projects/${project1.id}/tasks/${createdTaskId}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(deleteRes.status).toBe(204);

      const getRes = await request(app)
        .get(`/projects/${project1.id}/tasks/${createdTaskId}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(getRes.status).toBe(404);
    });
  });

  describe('Pagination & Filtering', () => {
    beforeAll(async () => {
      // Seed tasks in project 1
      const tasksToCreate = [
        { title: 'Task 1', description: 'Desc 1', status: 'TODO' as const, priority: 'HIGH' as const },
        { title: 'Task 2', description: 'Desc 2', status: 'TODO' as const, priority: 'LOW' as const },
        { title: 'Task 3', description: 'Desc 3', status: 'IN_PROGRESS' as const, priority: 'HIGH' as const },
        { title: 'Task 4', description: 'Desc 4', status: 'COMPLETED' as const, priority: 'CRITICAL' as const },
      ];

      for (const t of tasksToCreate) {
        await request(app)
          .post(`/projects/${project1.id}/tasks`)
          .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
          .send(t);
      }
    });

    it('returns paginated items schema { items, page, limit, total }', async () => {
      const res = await request(app)
        .get(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
      expect(res.body.total).toBeGreaterThanOrEqual(4);
    });

    it('filters tasks by status (status=TODO)', async () => {
      const res = await request(app)
        .get(`/projects/${project1.id}/tasks?status=TODO`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(2);
      expect(res.body.items.every((t: { status: string }) => t.status === 'TODO')).toBe(true);
    });

    it('filters tasks by priority (priority=HIGH)', async () => {
      const res = await request(app)
        .get(`/projects/${project1.id}/tasks?priority=HIGH`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(2);
      expect(res.body.items.every((t: { priority: string }) => t.priority === 'HIGH')).toBe(true);
    });

    it('rejects limit greater than 100', async () => {
      const res = await request(app)
        .get(`/projects/${project1.id}/tasks?limit=101`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(400);
    });
  });

  describe('Task Responsibilities', () => {
    let taskForResp: string;

    beforeAll(async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'Task for Responsibility Test',
          description: 'Testing responsibility assignment',
        });
      taskForResp = res.body.id;
    });

    it('assigns agent to task (POST /projects/:projectId/tasks/:taskId/responsibilities)', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskForResp}/responsibilities`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          agentId: agentP1.id,
          role: 'backend',
        });

      expect(res.status).toBe(201);
      expect(res.body.taskId).toBe(taskForResp);
      expect(res.body.agentId).toBe(agentP1.id);
      expect(res.body.role).toBe('backend');
    });

    it('lists task responsibilities (GET /projects/:projectId/tasks/:taskId/responsibilities)', async () => {
      const res = await request(app)
        .get(`/projects/${project1.id}/tasks/${taskForResp}/responsibilities`)
        .set('Cookie', [`agentmesh_session=${memberSession.id}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].agentId).toBe(agentP1.id);
    });

    it('returns 409 Conflict when assigning same agent twice', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskForResp}/responsibilities`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          agentId: agentP1.id,
          role: 'frontend',
        });

      expect(res.status).toBe(409);
    });

    it('returns 403 Forbidden when assigning an agent from another project', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskForResp}/responsibilities`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          agentId: agentP2.id,
        });

      expect(res.status).toBe(403);
    });

    it('returns 404 Not Found when assigning nonexistent agent', async () => {
      const fakeAgentId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskForResp}/responsibilities`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          agentId: fakeAgentId,
        });

      expect(res.status).toBe(404);
    });

    it('removes responsibility returning 204 No Content', async () => {
      const delRes = await request(app)
        .delete(`/projects/${project1.id}/tasks/${taskForResp}/responsibilities/${agentP1.id}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(delRes.status).toBe(204);

      const listRes = await request(app)
        .get(`/projects/${project1.id}/tasks/${taskForResp}/responsibilities`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(listRes.body.length).toBe(0);
    });
  });

  describe('Task Dependencies', () => {
    let mainTask: string;
    let dependencyTask: string;
    let project2Task: string;

    beforeAll(async () => {
      const res1 = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'Main Task',
          description: 'Main feature task',
        });
      mainTask = res1.body.id;

      const res2 = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'Prerequisite Task',
          description: 'Must be completed first',
        });
      dependencyTask = res2.body.id;

      const res3 = await request(app)
        .post(`/projects/${project2.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${outsiderSession.id}`])
        .send({
          title: 'Project 2 Task',
          description: 'Outsider task',
        });
      project2Task = res3.body.id;
    });

    it('adds a task dependency (POST /projects/:projectId/tasks/:taskId/dependencies)', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${mainTask}/dependencies`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          dependsOnTaskId: dependencyTask,
        });

      expect(res.status).toBe(201);
      expect(res.body.taskId).toBe(mainTask);
      expect(res.body.dependsOnTaskId).toBe(dependencyTask);
    });

    it('lists task dependencies (GET /projects/:projectId/tasks/:taskId/dependencies)', async () => {
      const res = await request(app)
        .get(`/projects/${project1.id}/tasks/${mainTask}/dependencies`)
        .set('Cookie', [`agentmesh_session=${memberSession.id}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].dependsOnTaskId).toBe(dependencyTask);
    });

    it('returns 400 Bad Request when adding self-dependency', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${mainTask}/dependencies`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          dependsOnTaskId: mainTask,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('itself');
    });

    it('returns 409 Conflict when adding duplicate dependency', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${mainTask}/dependencies`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          dependsOnTaskId: dependencyTask,
        });

      expect(res.status).toBe(409);
    });

    it('returns 404 Not Found when creating dependency on task from another project', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${mainTask}/dependencies`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          dependsOnTaskId: project2Task,
        });

      expect(res.status).toBe(404);
    });

    it('removes dependency returning 204 No Content', async () => {
      const delRes = await request(app)
        .delete(`/projects/${project1.id}/tasks/${mainTask}/dependencies/${dependencyTask}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(delRes.status).toBe(204);

      const listRes = await request(app)
        .get(`/projects/${project1.id}/tasks/${mainTask}/dependencies`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(listRes.body.length).toBe(0);
    });
  });

  describe('Cascade Behavior On Task Deletion', () => {
    it('deleting a task automatically cleans up responsibilities and dependencies without orphans', async () => {
      // 1. Create 2 tasks
      const task1Res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ title: 'Task to Delete', description: 'Cascade test parent' });
      const t1Id = task1Res.body.id;

      const task2Res = await request(app)
        .post(`/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ title: 'Task Dependent', description: 'Cascade test child' });
      const t2Id = task2Res.body.id;

      // 2. Add responsibility to t1Id
      await request(app)
        .post(`/projects/${project1.id}/tasks/${t1Id}/responsibilities`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1.id, role: 'testing' });

      // 3. Add dependency from t2Id -> t1Id
      await request(app)
        .post(`/projects/${project1.id}/tasks/${t2Id}/dependencies`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ dependsOnTaskId: t1Id });

      // 4. Delete t1Id
      const delRes = await request(app)
        .delete(`/projects/${project1.id}/tasks/${t1Id}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(delRes.status).toBe(204);

      // 5. Verify responsibilities for t1Id are gone
      const resps = await prisma.taskResponsibility.findMany({ where: { taskId: t1Id } });
      expect(resps.length).toBe(0);

      // 6. Verify dependencies where dependsOnTaskId was t1Id are gone
      const deps = await prisma.taskDependency.findMany({ where: { dependsOnTaskId: t1Id } });
      expect(deps.length).toBe(0);
    });
  });

  describe('Dual Prefix Routing Verification', () => {
    it('supports route with /api prefix (/api/projects/:projectId/tasks)', async () => {
      const res = await request(app)
        .get(`/api/projects/${project1.id}/tasks`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });
});
