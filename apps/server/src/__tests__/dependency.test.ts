import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';

const app = createApp();

describe('PRD-15 Dependency Service & Cycle Detection Tests', () => {
  let token: string;
  let userId: string;
  let projectId: string;
  let taskAId: string;
  let taskBId: string;
  let taskCId: string;
  let agentId: string;

  beforeEach(async () => {
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

    const user = await prisma.user.create({
      data: {
        walletAddress: '0x3333333333333333333333333333333333333333',
        displayName: 'Test User',
      },
    });
    userId = user.id;
    const session = await sessionService.createSession(user.id);
    token = session.id;

    const project = await prisma.project.create({
      data: {
        name: 'Dependency Test Project',
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    });
    projectId = project.id;

    const agent = await prisma.agent.create({
      data: {
        projectId,
        ownerId: user.id,
        name: 'Agent 1',
        provider: 'custom',
        status: 'ONLINE',
      },
    });
    agentId = agent.id;

    const taskA = await prisma.task.create({
      data: { projectId, creatorId: user.id, title: 'Task A', description: 'Task A' },
    });
    taskAId = taskA.id;

    const taskB = await prisma.task.create({
      data: { projectId, creatorId: user.id, title: 'Task B', description: 'Task B' },
    });
    taskBId = taskB.id;

    const taskC = await prisma.task.create({
      data: { projectId, creatorId: user.id, title: 'Task C', description: 'Task C' },
    });
    taskCId = taskC.id;
  });

  it('1. Should create a valid task completion dependency (Task B depends on Task A)', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskBId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        dependsOnTaskId: taskAId,
      });

    expect(res.status).toBe(201);
    expect(res.body.taskId).toBe(taskBId);
    expect(res.body.dependsOnTaskId).toBe(taskAId);
    expect(res.body.dependencyType).toBe('TASK_COMPLETION');
  });

  it('2. Should create a valid artifact dependency (Task B depends on Artifact A)', async () => {
    const artifact = await prisma.artifact.create({
      data: {
        projectId,
        taskId: taskAId,
        agentId,
        ownerUserId: userId,
        type: 'API_CONTRACT',
        name: 'Auth API Spec',
        version: 1,
        payload: { auth: true },
      },
    });

    const res = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskBId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        dependencyType: 'ARTIFACT_REQUIRED',
        artifactId: artifact.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.taskId).toBe(taskBId);
    expect(res.body.artifactId).toBe(artifact.id);
  });

  it('3. Should reject self-dependency (Task A depends on Task A)', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskAId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        dependsOnTaskId: taskAId,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot depend on itself/i);
  });

  it('4. Should reject duplicate dependencies', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskBId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        dependsOnTaskId: taskAId,
      });

    const resDuplicate = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskBId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        dependsOnTaskId: taskAId,
      });

    expect(resDuplicate.status).toBe(409);
  });

  it('5. Direct cycle detection: Task A -> Task B, then Task B -> Task A rejected', async () => {
    // Task B depends on Task A
    await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskBId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dependsOnTaskId: taskAId });

    // Task A depends on Task B (creates direct cycle A -> B -> A)
    const resCycle = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskAId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dependsOnTaskId: taskBId });

    expect(resCycle.status).toBe(400);
    expect(resCycle.body.message).toMatch(/circular task dependency/i);
  });

  it('6. Multi-hop cycle detection: A -> B -> C -> A rejected', async () => {
    // Task B depends on Task A
    await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskBId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dependsOnTaskId: taskAId });

    // Task C depends on Task B
    await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskCId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dependsOnTaskId: taskBId });

    // Task A depends on Task C (creates cycle A -> B -> C -> A)
    const resCycle = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskAId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dependsOnTaskId: taskCId });

    expect(resCycle.status).toBe(400);
    expect(resCycle.body.message).toMatch(/circular task dependency/i);
  });

  it('7. Dependency readiness: correctly reports pending vs available dependencies', async () => {
    // Task B depends on Task A completion
    await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskBId}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dependsOnTaskId: taskAId });

    // Check readiness before Task A completion
    const resBefore = await request(app)
      .get(`/api/projects/${projectId}/tasks/${taskBId}/dependencies/readiness`)
      .set('Authorization', `Bearer ${token}`);

    expect(resBefore.status).toBe(200);
    expect(resBefore.body.ready).toBe(false);
    expect(resBefore.body.available).toBe(0);
    expect(resBefore.body.total).toBe(1);

    // Complete Task A
    await prisma.task.update({
      where: { id: taskAId },
      data: { status: 'COMPLETED' },
    });

    // Check readiness after Task A completion
    const resAfter = await request(app)
      .get(`/api/projects/${projectId}/tasks/${taskBId}/dependencies/readiness`)
      .set('Authorization', `Bearer ${token}`);

    expect(resAfter.status).toBe(200);
    expect(resAfter.body.ready).toBe(true);
    expect(resAfter.body.available).toBe(1);
    expect(resAfter.body.total).toBe(1);
  });

  it('8. Inconclusive deep graph traversal fails safely with DEPENDENCY_GRAPH_TOO_DEEP', async () => {
    // Create chain of 11 tasks: T0 -> T1 -> T2 -> ... -> T10
    const tasks = [taskAId];
    for (let i = 1; i <= 10; i++) {
      const t = await prisma.task.create({
        data: {
          projectId,
          creatorId: userId,
          title: `Chain Task ${i}`,
          description: `Deep task ${i}`,
        },
      });
      tasks.push(t.id);
    }

    // Link T(i) depends on T(i-1)
    for (let i = 1; i < tasks.length; i++) {
      await prisma.taskDependency.create({
        data: {
          projectId,
          taskId: tasks[i],
          dependsOnTaskId: tasks[i - 1],
          dependencyType: 'TASK_COMPLETION',
        },
      });
    }

    // Attempting T0 depends on T10 (traversal from T10 -> ... -> T0 depth exceeds 10)
    const resDeep = await request(app)
      .post(`/api/projects/${projectId}/tasks/${tasks[0]}/dependencies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dependsOnTaskId: tasks[tasks.length - 1] });

    expect(resDeep.status).toBe(400);
    expect(resDeep.body.message).toMatch(/DEPENDENCY_GRAPH_TOO_DEEP/i);
  });
});
