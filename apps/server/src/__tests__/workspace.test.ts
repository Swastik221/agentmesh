import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { validateFilePaths } from '../workspace/file-path.validator.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { executionService } from '../execution/execution.service.js';
import { AgentExecutor, AgentExecutionRequest, AgentExecutionResult } from '../execution/executors/agent-executor.js';

describe('Shared Development Environment (PRD #14)', () => {
  const app = createApp();

  let userA: { id: string; cookie: string };
  let userB: { id: string; cookie: string };
  let projectA: { id: string };
  let projectB: { id: string };
  let agentA: { id: string };

  beforeEach(async () => {
    // Clean database
    await prisma.taskExecution.deleteMany();
    await prisma.taskResponsibility.deleteMany();
    await prisma.taskDependency.deleteMany();
    await prisma.task.deleteMany();
    await prisma.projectWorkspace.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.projectBrainEntry.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();

    // Create User A
    const uA = await prisma.user.create({
      data: { walletAddress: '0x1111111111111111111111111111111111111111', displayName: 'User A' },
    });
    const sA = await prisma.authSession.create({
      data: { userId: uA.id, expiresAt: new Date(Date.now() + 86400000) },
    });
    userA = { id: uA.id, cookie: `agentmesh_session=${sA.id}` };

    // Create User B
    const uB = await prisma.user.create({
      data: { walletAddress: '0x2222222222222222222222222222222222222222', displayName: 'User B' },
    });
    const sB = await prisma.authSession.create({
      data: { userId: uB.id, expiresAt: new Date(Date.now() + 86400000) },
    });
    userB = { id: uB.id, cookie: `agentmesh_session=${sB.id}` };

    // Create Project A owned by User A
    const pA = await prisma.project.create({
      data: { name: 'Project A', ownerId: userA.id },
    });
    await prisma.projectMember.create({
      data: { projectId: pA.id, userId: userA.id, role: 'OWNER' },
    });
    projectA = { id: pA.id };

    // Create Project B owned by User B
    const pB = await prisma.project.create({
      data: { name: 'Project B', ownerId: userB.id },
    });
    await prisma.projectMember.create({
      data: { projectId: pB.id, userId: userB.id, role: 'OWNER' },
    });
    projectB = { id: pB.id };

    // Create Agent in Project A
    const agA = await prisma.agent.create({
      data: { projectId: projectA.id, ownerId: userA.id, name: 'Agent A', provider: 'MOCK', status: 'ONLINE' },
    });
    agentA = { id: agA.id };
  });

  describe('File Path Validation Utility', () => {
    it('validates and normalizes valid relative paths', () => {
      const paths = ['src/app.ts', 'apps/web/src\\App.tsx', 'README.md'];
      const validated = validateFilePaths(paths);
      expect(validated).toEqual(['src/app.ts', 'apps/web/src/App.tsx', 'README.md']);
    });

    it('deduplicates paths', () => {
      const paths = ['src/app.ts', 'src/app.ts', 'src\\app.ts'];
      const validated = validateFilePaths(paths);
      expect(validated).toEqual(['src/app.ts']);
    });

    it('rejects absolute paths', () => {
      expect(() => validateFilePaths(['/etc/passwd'])).toThrow('must be relative, not absolute');
      expect(() => validateFilePaths(['C:\\Windows\\System32'])).toThrow('must be relative, not absolute');
    });

    it('rejects directory traversal', () => {
      expect(() => validateFilePaths(['../../secret.txt'])).toThrow('invalid directory traversal');
      expect(() => validateFilePaths(['src/../secret.txt'])).toThrow('invalid directory traversal');
    });

    it('rejects empty and malformed paths', () => {
      expect(() => validateFilePaths([''])).toThrow('cannot be empty');
      expect(() => validateFilePaths(['   '])).toThrow('cannot be empty');
      expect(() => validateFilePaths(['src//app.ts'])).toThrow('invalid empty path segments');
    });
  });

  describe('Workspace API', () => {
    it('creates and returns workspace for project', async () => {
      const res = await request(app)
        .post(`/projects/${projectA.id}/workspace`)
        .set('Cookie', userA.cookie)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.projectId).toBe(projectA.id);
      expect(res.body.rootPath).toBe(`workspaces/${projectA.id}`);

      // Also via /api prefix
      const resApi = await request(app)
        .get(`/api/projects/${projectA.id}/workspace`)
        .set('Cookie', userA.cookie)
        .expect(200);

      expect(resApi.body.id).toBe(res.body.id);
    });

    it('calling workspace creation twice returns same workspace without error', async () => {
      const res1 = await request(app)
        .post(`/projects/${projectA.id}/workspace`)
        .set('Cookie', userA.cookie)
        .expect(201);

      const res2 = await request(app)
        .post(`/projects/${projectA.id}/workspace`)
        .set('Cookie', userA.cookie)
        .expect(201);

      expect(res1.body.id).toBe(res2.body.id);
    });

    it('returns 404 for nonexistent project', async () => {
      await request(app)
        .get('/projects/nonexistent-id/workspace')
        .set('Cookie', userA.cookie)
        .expect(404);
    });

    it('returns 401 for unauthorized user', async () => {
      await request(app)
        .get(`/projects/${projectA.id}/workspace`)
        .expect(401);
    });

    it('returns 403 for non-member user', async () => {
      await request(app)
        .get(`/projects/${projectA.id}/workspace`)
        .set('Cookie', userB.cookie)
        .expect(403);
    });

    it('enforces project isolation', async () => {
      await request(app)
        .post(`/projects/${projectB.id}/workspace`)
        .set('Cookie', userB.cookie)
        .expect(201);

      // User A cannot get Project B workspace
      await request(app)
        .get(`/projects/${projectB.id}/workspace`)
        .set('Cookie', userA.cookie)
        .expect(403);
    });
  });

  describe('Task File Ownership Metadata', () => {
    it('creates task with validated filePaths', async () => {
      const res = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({
          title: 'Task with files',
          description: 'Modifies auth and UI',
          filePaths: ['apps/web/src/App.tsx', 'apps/server/src/auth.ts'],
        })
        .expect(201);

      expect(res.body.filePaths).toEqual(['apps/web/src/App.tsx', 'apps/server/src/auth.ts']);
    });

    it('rejects task creation with invalid filePaths', async () => {
      await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({
          title: 'Task bad files',
          description: 'Modifies system files',
          filePaths: ['/etc/passwd'],
        })
        .expect(400);
    });

    it('updates task filePaths', async () => {
      const taskRes = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 1', description: 'Desc' })
        .expect(201);

      const updateRes = await request(app)
        .patch(`/projects/${projectA.id}/tasks/${taskRes.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ filePaths: ['src/index.ts'] })
        .expect(200);

      expect(updateRes.body.filePaths).toEqual(['src/index.ts']);
    });
  });

  describe('File Conflict Detection & Concurrency Safety', () => {
    it('detects file conflict when updating task to IN_PROGRESS with overlapping files', async () => {
      // Task 1 IN_PROGRESS modifying src/auth.ts
      const task1 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 1', description: 'Desc 1', filePaths: ['src/auth.ts'] })
        .expect(201);

      await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task1.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      // Task 2 TODO modifying src/auth.ts
      const task2 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 2', description: 'Desc 2', filePaths: ['src/auth.ts', 'src/user.ts'] })
        .expect(201);

      // Attempting to set Task 2 to IN_PROGRESS fails with 409 FILE_CONFLICT
      const conflictRes = await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task2.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(409);

      expect(conflictRes.body.error).toBe('FILE_CONFLICT');
      expect(conflictRes.body.conflicts).toEqual([
        {
          taskId: task1.body.id,
          filePaths: ['src/auth.ts'],
        },
      ]);
    });

    it('allows non-conflicting tasks to become IN_PROGRESS', async () => {
      const task1 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 1', description: 'Desc 1', filePaths: ['src/auth.ts'] })
        .expect(201);

      await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task1.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      const task2 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 2', description: 'Desc 2', filePaths: ['src/billing.ts'] })
        .expect(201);

      await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task2.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
    });

    it('completed, failed, cancelled, or TODO tasks do not trigger conflicts', async () => {
      const task1 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 1', description: 'Desc 1', filePaths: ['src/auth.ts'] })
        .expect(201);

      // Set Task 1 to COMPLETED
      await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task1.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ status: 'COMPLETED' })
        .expect(200);

      // Task 2 modifying src/auth.ts can become IN_PROGRESS
      const task2 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 2', description: 'Desc 2', filePaths: ['src/auth.ts'] })
        .expect(201);

      await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task2.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
    });

    it('enforces concurrency protection when two requests attempt to set IN_PROGRESS simultaneously', async () => {
      const task1 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 1', description: 'Desc 1', filePaths: ['src/shared.ts'] })
        .expect(201);

      const task2 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 2', description: 'Desc 2', filePaths: ['src/shared.ts'] })
        .expect(201);

      // Trigger simultaneous updates to IN_PROGRESS
      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/projects/${projectA.id}/tasks/${task1.body.id}`)
          .set('Cookie', userA.cookie)
          .send({ status: 'IN_PROGRESS' }),
        request(app)
          .patch(`/projects/${projectA.id}/tasks/${task2.body.id}`)
          .set('Cookie', userA.cookie)
          .send({ status: 'IN_PROGRESS' }),
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses.sort()).toEqual([200, 409]);
    });

    it('enforces conflict check when assigning responsibility', async () => {
      const task1 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 1', description: 'Desc 1', filePaths: ['src/db.ts'] })
        .expect(201);

      await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task1.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      const task2 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Task 2', description: 'Desc 2', filePaths: ['src/db.ts'] })
        .expect(201);

      const assignRes = await request(app)
        .post(`/projects/${projectA.id}/tasks/${task2.body.id}/responsibilities`)
        .set('Cookie', userA.cookie)
        .send({ agentId: agentA.id })
        .expect(409);

      expect(assignRes.body.error).toBe('FILE_CONFLICT');
    });

    it('refetches fresh task state inside transaction during concurrent file-path mutation vs responsibility assignment', async () => {
      // Task 1 is IN_PROGRESS on src/conflicting.ts
      const task1 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Active Task', description: 'Desc 1', filePaths: ['src/conflicting.ts'] })
        .expect(201);

      await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task1.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      // Task 2 initially has safe filePaths (no conflict)
      const task2 = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Mutating Task', description: 'Desc 2', filePaths: ['src/safe.ts'] })
        .expect(201);

      // Trigger simultaneous task file-path mutation (adding conflicting path) and responsibility assignment
      const [pathMutationRes, assignRes] = await Promise.all([
        request(app)
          .patch(`/projects/${projectA.id}/tasks/${task2.body.id}`)
          .set('Cookie', userA.cookie)
          .send({ filePaths: ['src/conflicting.ts'] }),
        request(app)
          .post(`/projects/${projectA.id}/tasks/${task2.body.id}/responsibilities`)
          .set('Cookie', userA.cookie)
          .send({ agentId: agentA.id }),
      ]);

      // At least one of the concurrent operations must detect the file conflict and fail with 409
      const statuses = [pathMutationRes.status, assignRes.status];
      expect(statuses).toContain(409);
    });
  });

  describe('Workspace State Snapshot', () => {
    it('returns lightweight workspace state snapshot', async () => {
      const task = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({
          title: 'Snapshot task',
          description: 'Desc',
          priority: 'HIGH',
          filePaths: ['src/config.ts'],
        })
        .expect(201);

      await request(app)
        .post(`/projects/${projectA.id}/tasks/${task.body.id}/responsibilities`)
        .set('Cookie', userA.cookie)
        .send({ agentId: agentA.id })
        .expect(201);

      const stateRes = await request(app)
        .get(`/projects/${projectA.id}/workspace/state`)
        .set('Cookie', userA.cookie)
        .expect(200);

      expect(stateRes.body).toHaveProperty('projectId', projectA.id);
      expect(stateRes.body).toHaveProperty('workspace.id');
      expect(Array.isArray(stateRes.body.tasks)).toBe(true);

      const taskSnapshot = stateRes.body.tasks.find((t: { id: string }) => t.id === task.body.id);
      expect(taskSnapshot).toBeDefined();
      expect(taskSnapshot.title).toBe('Snapshot task');
      expect(taskSnapshot.priority).toBe('HIGH');
      expect(taskSnapshot.responsibleAgentIds).toEqual([agentA.id]);
      expect(taskSnapshot.filePaths).toEqual(['src/config.ts']);

      // Ensure heavy properties (chat history, brain entries, etc.) are omitted
      expect(taskSnapshot).not.toHaveProperty('description');
      expect(taskSnapshot).not.toHaveProperty('creator');
    });
  });

  describe('WebSocket Integration & Protocol Events', () => {
    it('broadcasts task.status WS event on status update', async () => {
      const broadcastSpy = vi.spyOn(connectionManager, 'broadcastToProject');

      const task = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'WS Event Task', description: 'Desc' })
        .expect(201);

      await request(app)
        .patch(`/projects/${projectA.id}/tasks/${task.body.id}`)
        .set('Cookie', userA.cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      expect(broadcastSpy).toHaveBeenCalledWith(
        projectA.id,
        expect.objectContaining({
          type: 'task.status',
          payload: {
            taskId: task.body.id,
            status: 'IN_PROGRESS',
          },
        }),
      );

      broadcastSpy.mockRestore();
    });
  });

  describe('Execution Workspace Context', () => {
    it('passes resolved ExecutionContext to AgentExecutor during execution pipeline', async () => {
      let capturedRequest: AgentExecutionRequest | undefined;

      const mockExec: AgentExecutor = {
        async execute(req: AgentExecutionRequest): Promise<AgentExecutionResult> {
          capturedRequest = req;
          return { status: 'COMPLETED', output: { ok: true }, error: null };
        },
      };

      executionService.setExecutor(mockExec);

      const task = await request(app)
        .post(`/projects/${projectA.id}/tasks`)
        .set('Cookie', userA.cookie)
        .send({ title: 'Context task', description: 'Desc' })
        .expect(201);

      await request(app)
        .post(`/projects/${projectA.id}/tasks/${task.body.id}/responsibilities`)
        .set('Cookie', userA.cookie)
        .send({ agentId: agentA.id })
        .expect(201);

      const execRes = await request(app)
        .post(`/projects/${projectA.id}/tasks/${task.body.id}/executions`)
        .set('Cookie', userA.cookie)
        .send({ agentId: agentA.id })
        .expect(201);

      // Wait briefly for background execution pipeline to run
      await new Promise((r) => setTimeout(r, 100));

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.executionId).toBe(execRes.body.id);
      expect(capturedRequest?.context).toBeDefined();
      expect(capturedRequest?.context?.projectId).toBe(projectA.id);
      expect(capturedRequest?.context?.rootPath).toBe(`workspaces/${projectA.id}`);
      expect(capturedRequest?.context?.workingDirectory).toBe(`workspaces/${projectA.id}`);
    });
  });
});
