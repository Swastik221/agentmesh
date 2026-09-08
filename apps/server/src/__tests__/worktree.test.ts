import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { gitService } from '../git/git.service.js';
import { worktreeService } from '../git/worktree.service.js';
import { workspaceService } from '../workspace/workspace.service.js';
import { GitRepositoryInvalidError, GitRepositoryNotFoundError } from '../git/git.errors.js';

const execFileAsync = promisify(execFile);

describe('PRD #15 — Git / Worktree Integration', () => {
  const app = createApp();

  let tempDir: string;
  let workspaceRootDir: string;
  let gitRepoDir: string;

  let userA: { id: string; cookie: string };
  let userB: { id: string; cookie: string };
  let projectA: { id: string };
  let projectB: { id: string };

  let agentA: { id: string };
  let taskA: { id: string };
  let executionA: { id: string };

  beforeAll(async () => {
    // Create temp directory for Git test repository & workspace
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'temp-git-test-'));
    workspaceRootDir = path.join(tempDir, 'workspace-root');
    gitRepoDir = path.join(workspaceRootDir, 'git-repo');

    fs.mkdirSync(gitRepoDir, { recursive: true });

    // Initialize real git repo
    await execFileAsync('git', ['init'], { cwd: gitRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: gitRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitRepoDir });

    fs.writeFileSync(path.join(gitRepoDir, 'README.md'), '# Test Repo\n');
    await execFileAsync('git', ['add', '.'], { cwd: gitRepoDir });
    await execFileAsync('git', ['commit', '-m', 'initial commit'], { cwd: gitRepoDir });
  });

  afterAll(async () => {
    // Clean up temporary filesystem directories
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Clean database
    await prisma.gitWorktree.deleteMany();
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
      data: { walletAddress: '0x3333333333333333333333333333333333333333', displayName: 'User A' },
    });
    const sA = await prisma.authSession.create({
      data: { userId: uA.id, expiresAt: new Date(Date.now() + 86400000) },
    });
    userA = { id: uA.id, cookie: `agentmesh_session=${sA.id}` };

    // Create User B
    const uB = await prisma.user.create({
      data: { walletAddress: '0x4444444444444444444444444444444444444444', displayName: 'User B' },
    });
    const sB = await prisma.authSession.create({
      data: { userId: uB.id, expiresAt: new Date(Date.now() + 86400000) },
    });
    userB = { id: uB.id, cookie: `agentmesh_session=${sB.id}` };

    // Create Project A
    const pA = await prisma.project.create({
      data: { name: 'Project A', ownerId: userA.id },
    });
    await prisma.projectMember.create({
      data: { projectId: pA.id, userId: userA.id, role: 'OWNER' },
    });
    projectA = { id: pA.id };

    // Create Project B
    const pB = await prisma.project.create({
      data: { name: 'Project B', ownerId: userB.id },
    });
    await prisma.projectMember.create({
      data: { projectId: pB.id, userId: userB.id, role: 'OWNER' },
    });
    projectB = { id: pB.id };

    // Create Project Workspace for Project A with real gitRepoPath
    await prisma.projectWorkspace.create({
      data: {
        projectId: projectA.id,
        rootPath: workspaceRootDir,
        gitRepoPath: gitRepoDir,
      },
    });

    // Create Agent in Project A
    const agA = await prisma.agent.create({
      data: { projectId: projectA.id, ownerId: userA.id, name: 'Agent A', provider: 'claude', status: 'ONLINE' },
    });
    agentA = { id: agA.id };

    // Create Task in Project A
    const tA = await prisma.task.create({
      data: { projectId: projectA.id, creatorId: userA.id, title: 'Git Task', description: 'Desc' },
    });
    taskA = { id: tA.id };

    // Assign Responsibility
    await prisma.taskResponsibility.create({
      data: { taskId: taskA.id, agentId: agentA.id },
    });

    // Create Execution
    const exA = await prisma.taskExecution.create({
      data: { taskId: taskA.id, agentId: agentA.id, status: 'QUEUED' },
    });
    executionA = { id: exA.id };
  });

  describe('Repository Validation', () => {
    it('validates a valid Git repository successfully', async () => {
      await expect(gitService.validateRepository(gitRepoDir)).resolves.not.toThrow();
    });

    it('rejects a non-existent directory', async () => {
      const missing = path.join(tempDir, 'does-not-exist');
      await expect(gitService.validateRepository(missing)).rejects.toThrow(GitRepositoryNotFoundError);
    });

    it('rejects a non-Git directory', async () => {
      const nonGit = path.join(tempDir, 'non-git-dir');
      fs.mkdirSync(nonGit, { recursive: true });
      await expect(gitService.validateRepository(nonGit)).rejects.toThrow(GitRepositoryInvalidError);
    });
  });

  describe('Worktree Creation API & File Isolation', () => {
    it('creates a physical Git worktree and persists record in database', async () => {
      const res = await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.executionId).toBe(executionA.id);
      expect(res.body.agentId).toBe(agentA.id);
      expect(res.body.taskId).toBe(taskA.id);
      expect(res.body.branchName).toBe(`agentmesh/execution/${executionA.id}`);
      expect(res.body.status).toBe('ACTIVE');

      // Verify physical directory exists on disk
      expect(fs.existsSync(res.body.path)).toBe(true);

      // Verify git branch exists
      const worktreeList = await gitService.listWorktrees(gitRepoDir);
      const matched = worktreeList.find((w) => w.worktreePath === res.body.path);
      expect(matched).toBeDefined();
      expect(matched?.branchName).toBe(`agentmesh/execution/${executionA.id}`);
    });

    it('supports route with /api prefix for worktree creation', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(201);

      expect(res.body.executionId).toBe(executionA.id);
    });

    it('rejects worktree creation if worktree already exists for execution', async () => {
      await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(201);

      const res2 = await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(409);

      expect(res2.body.error).toBe('GIT_WORKTREE_ALREADY_EXISTS');
    });

    it('enforces concurrency protection on simultaneous worktree creation', async () => {
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
          .set('Cookie', userA.cookie),
        request(app)
          .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
          .set('Cookie', userA.cookie),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const activeCount = await prisma.gitWorktree.count({
        where: { executionId: executionA.id, status: 'ACTIVE' },
      });
      expect(activeCount).toBe(1);
    });

    it('cleans up physical worktree when DB insertion fails after Git creation', async () => {
      const ex2 = await prisma.taskExecution.create({
        data: { taskId: taskA.id, agentId: agentA.id, status: 'QUEUED' },
      });

      const originalCreate = prisma.gitWorktree.create;
      prisma.gitWorktree.create = (async () => {
        throw new Error('Simulated DB Error');
      }) as unknown as typeof prisma.gitWorktree.create;

      try {
        await expect(worktreeService.createWorktree(projectA.id, ex2.id, userA.id)).rejects.toThrow('Simulated DB Error');
      } finally {
        prisma.gitWorktree.create = originalCreate;
      }

      const expectedWorktreePath = path.resolve(workspaceRootDir, '.worktrees', ex2.id);
      expect(fs.existsSync(expectedWorktreePath)).toBe(false);
    });

    it('server-generates worktree path contained in workspace root and execution-specific branch name', async () => {
      const res = await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(201);

      const expectedPath = path.resolve(workspaceRootDir, '.worktrees', executionA.id);
      expect(res.body.path).toBe(expectedPath);
      expect(res.body.branchName).toBe(`agentmesh/execution/${executionA.id}`);
      expect(res.body.path.startsWith(workspaceRootDir)).toBe(true);
    });
  });

  describe('Authorization & Security Validation', () => {
    it('returns 401 Unauthorized for unauthenticated request', async () => {
      await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .expect(401);
    });

    it('returns 403 Forbidden for non-member user', async () => {
      await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userB.cookie)
        .expect(403);
    });

    it('returns 404 for execution belonging to another project', async () => {
      await request(app)
        .post(`/projects/${projectB.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userB.cookie)
        .expect(404);
    });

    it('returns 403 if agent is not assigned responsibility for task', async () => {
      const unassignedAgent = await prisma.agent.create({
        data: { projectId: projectA.id, ownerId: userA.id, name: 'Unassigned Agent', provider: 'claude' },
      });
      const unassignedExec = await prisma.taskExecution.create({
        data: { taskId: taskA.id, agentId: unassignedAgent.id, status: 'QUEUED' },
      });

      await request(app)
        .post(`/projects/${projectA.id}/executions/${unassignedExec.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(403);
    });

    it('rejects repository path configured outside workspace boundary', async () => {
      const outsidePath = path.resolve(tempDir, 'outside-repo');
      fs.mkdirSync(outsidePath, { recursive: true });

      await expect(
        workspaceService.updateGitRepoPath(projectA.id, userA.id, outsidePath),
      ).rejects.toThrow();
    });

    it('rejects repository path resolving outside workspace boundary via symlink', async () => {
      const outsideDir = path.resolve(tempDir, 'outside-target');
      fs.mkdirSync(outsideDir, { recursive: true });
      const symlinkPath = path.resolve(workspaceRootDir, 'symlink-repo');

      if (!fs.existsSync(symlinkPath)) {
        fs.symlinkSync(outsideDir, symlinkPath, 'dir');
      }

      expect(() => worktreeService.assertPathContained(workspaceRootDir, symlinkPath)).toThrow();

      if (fs.existsSync(symlinkPath)) {
        fs.unlinkSync(symlinkPath);
      }
    });
  });

  describe('Worktree Retrieval, Listing, & Removal', () => {
    it('gets worktree for execution', async () => {
      const created = await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(201);

      const getRes = await request(app)
        .get(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(200);

      expect(getRes.body.id).toBe(created.body.id);
      expect(getRes.body.path).toBe(created.body.path);
    });

    it('lists project worktrees with filtering', async () => {
      await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(201);

      const listRes = await request(app)
        .get(`/projects/${projectA.id}/worktrees?agentId=${agentA.id}`)
        .set('Cookie', userA.cookie)
        .expect(200);

      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0].executionId).toBe(executionA.id);
    });

    it('removes physical Git worktree and updates database status to REMOVED', async () => {
      const created = await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(201);

      const worktreePath = created.body.path;
      expect(fs.existsSync(worktreePath)).toBe(true);

      const removeRes = await request(app)
        .post(`/projects/${projectA.id}/worktrees/${created.body.id}/remove`)
        .set('Cookie', userA.cookie)
        .expect(200);

      expect(removeRes.body.status).toBe('REMOVED');
      expect(fs.existsSync(worktreePath)).toBe(false);

      // Verify idempotency on repeated removal
      const removeAgainRes = await request(app)
        .post(`/projects/${projectA.id}/worktrees/${created.body.id}/remove`)
        .set('Cookie', userA.cookie)
        .expect(200);

      expect(removeAgainRes.body.status).toBe('REMOVED');
    });

    it('fails worktree removal safely when worktree has uncommitted/dirty changes and leaves DB status ACTIVE', async () => {
      const created = await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(201);

      const worktreePath = created.body.path;
      expect(fs.existsSync(worktreePath)).toBe(true);

      // Make worktree dirty by creating an uncommitted file
      fs.writeFileSync(path.join(worktreePath, 'dirty.txt'), 'uncommitted changes');

      // Attempt to remove worktree
      const res = await request(app)
        .post(`/projects/${projectA.id}/worktrees/${created.body.id}/remove`)
        .set('Cookie', userA.cookie)
        .expect(500);

      expect(res.body.error).toBe('GIT_WORKTREE_REMOVAL_FAILED');

      // Verify physical directory still exists on disk
      expect(fs.existsSync(worktreePath)).toBe(true);

      // Verify DB record status remains ACTIVE
      const dbRecord = await prisma.gitWorktree.findUnique({
        where: { id: created.body.id },
      });
      expect(dbRecord?.status).toBe('ACTIVE');

      // Clean up dirty file so that subsequent test cleanups can succeed
      fs.unlinkSync(path.join(worktreePath, 'dirty.txt'));
    });
  });

  describe('ExecutionContext Integration', () => {
    it('resolves ExecutionContext workingDirectory pointing to active Git worktree', async () => {
      const created = await request(app)
        .post(`/projects/${projectA.id}/executions/${executionA.id}/worktree`)
        .set('Cookie', userA.cookie)
        .expect(201);

      const context = await workspaceService.getExecutionContext(projectA.id, taskA.id, executionA.id);
      expect(context.workingDirectory).toBe(created.body.path);
      expect(context.rootPath).toBe(workspaceRootDir);
    });

    it('falls back to workspace rootPath if no active Git worktree exists for execution', async () => {
      const context = await workspaceService.getExecutionContext(projectA.id, taskA.id, executionA.id);
      expect(context.workingDirectory).toBe(workspaceRootDir);
      expect(context.rootPath).toBe(workspaceRootDir);
    });
  });
});
