import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { executionService } from '../execution/execution.service.js';
import { mockAgentExecutor } from '../execution/executors/mock-agent-executor.js';

async function waitForExecutionStatus(
  executionId: string,
  targetStatuses: string[] = ['COMPLETED', 'FAILED', 'CANCELLED'],
  timeoutMs = 2000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const exec = await prisma.taskExecution.findUnique({ where: { id: executionId } });
    if (exec && targetStatuses.includes(exec.status)) {
      return exec;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return await prisma.taskExecution.findUnique({ where: { id: executionId } });
}

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
    executionService.setExecutor(mockAgentExecutor);
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

  describe('Async Execution Creation & Authorization', () => {
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

    it('creates execution asynchronously, returns 201 Created and QUEUED status immediately, then background pipeline completes', async () => {
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
      expect(res.body.status).toBe('QUEUED');

      // Wait for background execution pipeline to complete
      const completedExec = await waitForExecutionStatus(res.body.id);
      expect(completedExec?.status).toBe('COMPLETED');
      expect(completedExec?.output).toBeDefined();
      expect(completedExec?.completedAt).toBeDefined();
    });
  });

  describe('Mock Executor & Task/Agent Integration', () => {
    it('updates task to IN_PROGRESS then COMPLETED on successful mock execution', async () => {
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
      expect(res.body.status).toBe('QUEUED');

      // Wait for background completion
      const completed = await waitForExecutionStatus(res.body.id);
      expect(completed?.status).toBe('COMPLETED');

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
      expect(res.body.status).toBe('QUEUED');

      const failed = await waitForExecutionStatus(res.body.id);
      expect(failed?.status).toBe('FAILED');
      expect(failed?.error).toBe('Custom error message');

      const updatedTask = await prisma.task.findUnique({ where: { id: failTask.id } });
      expect(updatedTask?.status).toBe('FAILED');
    });

    it('updates agent status to BUSY during active execution then back to ONLINE when finished', async () => {
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

      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${tempTask.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: tempAgent.id });

      expect(res.status).toBe(201);

      await waitForExecutionStatus(res.body.id);

      const agentAfter = await prisma.agent.findUnique({ where: { id: tempAgent.id } });
      expect(agentAfter?.status).toBe('ONLINE');
    });
  });

  describe('Cancellation API Endpoint', () => {
    it('cancels a QUEUED execution successfully via POST /cancel', async () => {
      const cancelTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Task to Cancel QUEUED',
          description: 'Description for cancel task',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: cancelTask.id, agentId: agentP1Responsible.id },
      });

      // Inject a delayed executor so execution stays QUEUED/RUNNING long enough
      executionService.setExecutor({
        async execute() {
          await new Promise((r) => setTimeout(r, 200));
          return { status: 'COMPLETED', output: null, error: null };
        },
      });

      const createRes = await request(app)
        .post(`/projects/${project1.id}/tasks/${cancelTask.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      const execId = createRes.body.id;

      // Cancel execution immediately
      const cancelRes = await request(app)
        .post(`/projects/${project1.id}/tasks/${cancelTask.id}/executions/${execId}/cancel`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.id).toBe(execId);
      expect(cancelRes.body.status).toBe('CANCELLED');

      // Verify task status updated to CANCELLED
      const updatedTask = await prisma.task.findUnique({ where: { id: cancelTask.id } });
      expect(updatedTask?.status).toBe('CANCELLED');

      // Reset executor
      executionService.setExecutor(mockAgentExecutor);
    });

    it('returns 409 Conflict when attempting to cancel COMPLETED execution', async () => {
      const task = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Task Completed Cancel Test',
          description: 'Description for completed task',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: task.id, agentId: agentP1Responsible.id },
      });

      const createRes = await request(app)
        .post(`/projects/${project1.id}/tasks/${task.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      const execId = createRes.body.id;
      await waitForExecutionStatus(execId);

      const cancelRes = await request(app)
        .post(`/projects/${project1.id}/tasks/${task.id}/executions/${execId}/cancel`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(cancelRes.status).toBe(409);
      expect(cancelRes.body.message).toContain('Invalid execution state transition');
    });

    it('returns 409 Conflict when attempting to cancel FAILED execution', async () => {
      const failTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Task Failed Cancel Test',
          description: 'Description for failed task',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: failTask.id, agentId: agentP1Responsible.id },
      });

      const createRes = await request(app)
        .post(`/projects/${project1.id}/tasks/${failTask.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id, input: { fail: true } });

      const execId = createRes.body.id;
      await waitForExecutionStatus(execId);

      const cancelRes = await request(app)
        .post(`/projects/${project1.id}/tasks/${failTask.id}/executions/${execId}/cancel`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(cancelRes.status).toBe(409);
    });

    it('returns 409 Conflict when attempting to cancel already CANCELLED execution', async () => {
      const task = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Task Double Cancel Test',
          description: 'Description for double cancel task',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: task.id, agentId: agentP1Responsible.id },
      });

      executionService.setExecutor({
        async execute() {
          await new Promise((r) => setTimeout(r, 200));
          return { status: 'COMPLETED', output: null, error: null };
        },
      });

      const createRes = await request(app)
        .post(`/projects/${project1.id}/tasks/${task.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      const execId = createRes.body.id;

      await request(app)
        .post(`/projects/${project1.id}/tasks/${task.id}/executions/${execId}/cancel`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      const secondCancel = await request(app)
        .post(`/projects/${project1.id}/tasks/${task.id}/executions/${execId}/cancel`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(secondCancel.status).toBe(409);

      executionService.setExecutor(mockAgentExecutor);
    });

    it('returns 401 Unauthorized when cancelling without auth', async () => {
      const res = await request(app).post(
        `/projects/${project1.id}/tasks/${taskP1.id}/executions/some-id/cancel`,
      );

      expect(res.status).toBe(401);
    });

    it('returns 403 Forbidden when non-member tries to cancel', async () => {
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskP1.id}/executions/some-id/cancel`)
        .set('Cookie', [`agentmesh_session=${outsiderSession.id}`]);

      expect(res.status).toBe(403);
    });

    it('returns 404 Not Found when execution does not exist', async () => {
      const fakeExecId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/projects/${project1.id}/tasks/${taskP1.id}/executions/${fakeExecId}/cancel`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(404);
    });
  });

  describe('Race Safety & Concurrency Requirements', () => {
    it('Cancellation race: executor finishing after cancellation does NOT overwrite CANCELLED status', async () => {
      const raceTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Race Condition Task',
          description: 'Description for race condition task',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: raceTask.id, agentId: agentP1Responsible.id },
      });

      let resolveExecutor: () => void;
      const executorPromise = new Promise<void>((res) => {
        resolveExecutor = res;
      });

      executionService.setExecutor({
        async execute() {
          await executorPromise;
          return { status: 'COMPLETED', output: { race: true }, error: null };
        },
      });

      const createRes = await request(app)
        .post(`/projects/${project1.id}/tasks/${raceTask.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      const execId = createRes.body.id;

      // Cancel while executor is waiting on promise
      const cancelRes = await request(app)
        .post(`/projects/${project1.id}/tasks/${raceTask.id}/executions/${execId}/cancel`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCELLED');

      // Now resolve executor promise
      resolveExecutor!();
      await new Promise((r) => setTimeout(r, 50));

      // Re-query execution state: MUST remain CANCELLED
      const finalExec = await prisma.taskExecution.findUnique({ where: { id: execId } });
      expect(finalExec?.status).toBe('CANCELLED');

      executionService.setExecutor(mockAgentExecutor);
    });

    it('Cancellation race before RUNNING transition: cancellation winning before QUEUED -> RUNNING update stops pipeline', async () => {
      const preRunningTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Pre-RUNNING Cancellation Task',
          description: 'Testing cancellation winning before RUNNING transition',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: preRunningTask.id, agentId: agentP1Responsible.id },
      });

      // Create a QUEUED execution directly in DB without triggering pipeline yet
      const queuedExec = await prisma.taskExecution.create({
        data: {
          taskId: preRunningTask.id,
          agentId: agentP1Responsible.id,
          status: 'QUEUED',
        },
      });

      // Cancel execution before runExecutionPipeline runs
      await executionService.cancelExecution(
        project1.id,
        preRunningTask.id,
        queuedExec.id,
        ownerUser.id,
      );

      const dbBefore = await prisma.taskExecution.findUnique({ where: { id: queuedExec.id } });
      expect(dbBefore?.status).toBe('CANCELLED');

      // Now run the pipeline on the cancelled execution
      await executionService.runExecutionPipeline(queuedExec.id, null);

      // Verify that updateMany affects 0 rows, re-reads CANCELLED, and pipeline aborts without transitioning to RUNNING/COMPLETED
      const dbAfter = await prisma.taskExecution.findUnique({ where: { id: queuedExec.id } });
      expect(dbAfter?.status).toBe('CANCELLED');
      expect(dbAfter?.startedAt).toBeNull();
      expect(dbAfter?.completedAt).toBeDefined();

      const agentState = await prisma.agent.findUnique({ where: { id: agentP1Responsible.id } });
      expect(agentState?.status).toBe('ONLINE');
    });

    it('Multiple active executions on same agent: agent remains BUSY until all active executions complete/cancel', async () => {
      const multiTask1 = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Multi Exec 1',
          description: 'Description 1',
        },
      });
      const multiTask2 = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Multi Exec 2',
          description: 'Description 2',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: multiTask1.id, agentId: agentP1Responsible.id },
      });
      await prisma.taskResponsibility.create({
        data: { taskId: multiTask2.id, agentId: agentP1Responsible.id },
      });

      let finishFirstExec: () => void;
      let finishSecondExec: () => void;

      const p1 = new Promise<void>((r) => (finishFirstExec = r));
      const p2 = new Promise<void>((r) => (finishSecondExec = r));

      let callCount = 0;
      executionService.setExecutor({
        async execute() {
          callCount++;
          if (callCount === 1) {
            await p1;
          } else {
            await p2;
          }
          return { status: 'COMPLETED', output: null, error: null };
        },
      });

      const create1 = await request(app)
        .post(`/projects/${project1.id}/tasks/${multiTask1.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      const create2 = await request(app)
        .post(`/projects/${project1.id}/tasks/${multiTask2.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      expect(create1.status).toBe(201);
      expect(create2.status).toBe(201);

      // Finish first execution
      finishFirstExec!();
      await new Promise((r) => setTimeout(r, 50));

      // Agent must still be BUSY because execution 2 is running
      const agentMiddle = await prisma.agent.findUnique({ where: { id: agentP1Responsible.id } });
      expect(agentMiddle?.status).toBe('BUSY');

      // Finish second execution
      finishSecondExec!();
      await new Promise((r) => setTimeout(r, 50));

      // Now agent should be ONLINE
      const agentFinal = await prisma.agent.findUnique({ where: { id: agentP1Responsible.id } });
      expect(agentFinal?.status).toBe('ONLINE');

      executionService.setExecutor(mockAgentExecutor);
    });

    it('Stale task protection: older execution completion/cancellation does not overwrite newer task state', async () => {
      const multiTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Stale Task State Protection',
          description: 'Description for stale task protection',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: multiTask.id, agentId: agentP1Responsible.id },
      });

      // Older execution
      const olderExec = await prisma.taskExecution.create({
        data: {
          taskId: multiTask.id,
          agentId: agentP1Responsible.id,
          status: 'RUNNING',
          createdAt: new Date(Date.now() - 10000),
        },
      });

      // Newer execution
      const newerExec = await prisma.taskExecution.create({
        data: {
          taskId: multiTask.id,
          agentId: agentP1Responsible.id,
          status: 'RUNNING',
          createdAt: new Date(),
        },
      });

      // Complete newer execution -> COMPLETED
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

      // Task status must remain COMPLETED
      const taskAfterOlder = await prisma.task.findUnique({ where: { id: multiTask.id } });
      expect(taskAfterOlder?.status).toBe('COMPLETED');
    });
  });

  describe('Execution Retrieval & Dual Route Verification', () => {
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

    it('supports route with /api prefix for cancellation', async () => {
      const cancelTask = await prisma.task.create({
        data: {
          projectId: project1.id,
          creatorId: ownerUser.id,
          title: 'Api Prefix Cancel Task',
          description: 'Description for api prefix task',
        },
      });

      await prisma.taskResponsibility.create({
        data: { taskId: cancelTask.id, agentId: agentP1Responsible.id },
      });

      executionService.setExecutor({
        async execute() {
          await new Promise((r) => setTimeout(r, 200));
          return { status: 'COMPLETED', output: null, error: null };
        },
      });

      const createRes = await request(app)
        .post(`/api/projects/${project1.id}/tasks/${cancelTask.id}/executions`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({ agentId: agentP1Responsible.id });

      const execId = createRes.body.id;

      const cancelRes = await request(app)
        .post(`/api/projects/${project1.id}/tasks/${cancelTask.id}/executions/${execId}/cancel`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('CANCELLED');

      executionService.setExecutor(mockAgentExecutor);
    });
  });
});

