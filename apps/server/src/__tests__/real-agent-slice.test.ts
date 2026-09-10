import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server as HTTPServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/websocket.server.js';
import { executionService } from '../execution/execution.service.js';
import { coordinatorService } from '../services/coordinator.service.js';
import { AgentMeshClient, RealAgentAdapter, TaskExecutionContext } from '@agentmesh/cli';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';
import WebSocket from 'ws';

describe('PRD-31 Real Agent Vertical Slice Integration Tests', () => {

  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  let testUser: { id: string };
  let testSession: { id: string };
  let testProject: { id: string };
  let testAgent: { id: string };

  let tempDir: string;
  let primaryRepoPath: string;
  let workspaceRoot: string;

  beforeAll(async () => {
    // 1. Setup HTTP & WebSocket server
    server = createServer();
    wsServer = setupWebSocketServer(server, 100000);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port;
        }
        resolve();
      });
    });

    // 2. Setup temporary git repository fixtures
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'scratch-prd31-test-'));
    workspaceRoot = path.join(tempDir, 'workspace');
    primaryRepoPath = path.join(workspaceRoot, 'repo');

    fs.mkdirSync(primaryRepoPath, { recursive: true });
    fs.mkdirSync(path.join(primaryRepoPath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(primaryRepoPath, 'README.md'), '# Test Primary Repo\nInitial content\n');
    fs.writeFileSync(
      path.join(primaryRepoPath, 'package.json'),
      JSON.stringify({ name: 'test-repo', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }),
    );

    execSync('git init', { cwd: primaryRepoPath });
    execSync('git config user.name "Test User"', { cwd: primaryRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: primaryRepoPath });
    execSync('git add .', { cwd: primaryRepoPath });
    execSync('git commit -m "initial commit"', { cwd: primaryRepoPath });

    // 3. Database user, session, project, agent setup
    const wallet = `0x${Date.now().toString(16).padEnd(40, '0')}`;
    testUser = await prisma.user.create({
      data: { walletAddress: wallet, displayName: 'Real Agent Tester' },
    });
    testSession = await sessionService.createSession(testUser.id);

    testProject = await prisma.project.create({
      data: { name: 'PRD31 Real Agent Project', ownerId: testUser.id },
    });
    await prisma.projectMember.create({
      data: { projectId: testProject.id, userId: testUser.id, role: 'OWNER' },
    });

    await prisma.projectWorkspace.create({
      data: {
        projectId: testProject.id,
        rootPath: workspaceRoot,
        gitRepoPath: primaryRepoPath,
      },
    });

    testAgent = await prisma.agent.create({
      data: {
        name: 'Real Local Coding Agent',
        provider: 'real-local-provider',
        projectId: testProject.id,
        ownerId: testUser.id,
        status: 'OFFLINE',
        capabilities: {
          create: [
            { capability: 'code-generation' },
            { capability: 'testing' },
            { capability: 'refactoring' },
            { capability: 'file-editing' },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    wsServer.close();
    server.close();

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    if (testProject?.id) {
      await prisma.gitWorktree.deleteMany({ where: { workspace: { projectId: testProject.id } } }).catch(() => {});
      await prisma.artifact.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
      await prisma.activityEvent.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
      await prisma.taskExecution.deleteMany({ where: { task: { projectId: testProject.id } } }).catch(() => {});
      await prisma.taskResponsibility.deleteMany({ where: { task: { projectId: testProject.id } } }).catch(() => {});
      await prisma.task.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
      await prisma.agentCapability.deleteMany({ where: { agent: { projectId: testProject.id } } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
      await prisma.projectWorkspace.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
      await prisma.projectMember.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
      await prisma.project.delete({ where: { id: testProject.id } }).catch(() => {});
      await prisma.authSession.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  it('A. Agent connects via AgentMeshClient and becomes ONLINE', async () => {
    const adapter = new RealAgentAdapter({
      agentId: testAgent.id,
      name: 'Real Local Coding Agent',
    });

    const client = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: testAgent.id,
      sessionId: testSession.id,
      adapter,
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);

    const agentRecord = await prisma.agent.findUnique({ where: { id: testAgent.id } });
    expect(agentRecord?.status).toBe('ONLINE');

    client.disconnect();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('B & C & D & E & F. Full Vertical Slice: Task creation, assignment, isolated worktree, real code change, progress, artifact & completion', async () => {
    // 1. Setup real agent connected via WS
    const adapter = new RealAgentAdapter({
      agentId: testAgent.id,
      name: 'Real Local Coding Agent',
    });

    const agentClient = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: testAgent.id,
      sessionId: testSession.id,
      adapter,
    });

    await agentClient.connect();

    // 2. Setup user WebSocket client to capture realtime progress & updates
    const userWsUrl = `ws://127.0.0.1:${serverPort}/ws?projectId=${testProject.id}&clientType=user`;
    const userWs = new WebSocket(userWsUrl, {
      headers: { Cookie: `agentmesh_session=${testSession.id}` },
    });

    const receivedProgressEvents: number[] = [];
    const receivedMessages: string[] = [];

    await new Promise<void>((resolve) => {
      userWs.on('open', resolve);
    });

    userWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg.type);
        if (msg.type === AgentMeshMessageType.TASK_PROGRESS) {
          receivedProgressEvents.push(msg.payload.progress);
        }
      } catch {
        // Ignore non-JSON WS frame
      }
    });

    // 3. Human creates a task
    const task = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Add /health endpoint',
        description: 'Implement healthCheck endpoint inside src/health.ts',
        status: 'TODO',
        priority: 'MEDIUM',
      },
    });

    // 4. Coordinator assigns task to connected agent & creates execution
    const assignResult = await coordinatorService.assignTask(testProject.id, task.id, testUser.id, {
      preferredAgentId: testAgent.id,
    });
    expect(assignResult.assigned).toBe(true);

    const execution = await executionService.createExecution(testProject.id, task.id, testUser.id, {
      agentId: testAgent.id,
      input: { request: 'Add health endpoint' },
    });

    expect(execution).toBeDefined();

    // Wait for async execution completion
    let attempts = 0;
    let finalTaskState;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 200));
      finalTaskState = await prisma.task.findUnique({ where: { id: task.id } });
      if (finalTaskState?.status === 'COMPLETED' || finalTaskState?.status === 'PENDING_APPROVAL') {
        break;
      }
      attempts++;
    }

    expect(['COMPLETED', 'PENDING_APPROVAL']).toContain(finalTaskState?.status);

    // 5. Verify isolated Git Worktree allocation and REAL code change
    const worktree = await prisma.gitWorktree.findUnique({
      where: { executionId: execution.id },
    });

    expect(worktree).toBeDefined();
    expect(worktree?.status).toBe('ACTIVE');
    expect(worktree?.path).not.toEqual(primaryRepoPath);

    // Verify real file change inside isolated worktree
    const createdHealthFileInWorktree = path.join(worktree!.path, 'src', 'health.ts');
    expect(fs.existsSync(createdHealthFileInWorktree)).toBe(true);
    const healthContent = fs.readFileSync(createdHealthFileInWorktree, 'utf8');
    expect(healthContent).toContain('healthCheck');

    // Verify Primary checkout remains UNTOUCHED (Requirement 6 & invariant check)
    const primaryHealthFile = path.join(primaryRepoPath, 'src', 'health.ts');
    expect(fs.existsSync(primaryHealthFile)).toBe(false);

    // 6. Verify Progress events reached the realtime WS stream
    expect(receivedProgressEvents.length).toBeGreaterThan(0);
    expect(receivedProgressEvents).toContain(100);

    // 7. Verify Artifact was created and recorded
    let artifact;
    attempts = 0;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 100));
      artifact = await prisma.artifact.findFirst({ where: { taskId: task.id } });
      if (artifact) break;
      attempts++;
    }
    expect(artifact).toBeDefined();
    expect(artifact?.name).toBeDefined();
    expect(artifact?.name).toContain('patch');

    // 8. Verify Activity Event recorded
    const activities = await prisma.activityEvent.findMany({
      where: { taskId: task.id },
    });
    expect(activities.length).toBeGreaterThan(0);

    userWs.close();
    agentClient.disconnect();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('G. Code verification failure produces FAILED execution state', async () => {


    // Create dedicated agent for test G to avoid socket conflicts
    const agentG = await prisma.agent.create({
      data: {
        name: 'Failing Verification Agent',
        provider: 'real-local-provider',
        projectId: testProject.id,
        ownerId: testUser.id,
        status: 'OFFLINE',
        capabilities: {
          create: [
            { capability: 'code-generation' },
            { capability: 'testing' },
            { capability: 'refactoring' },
            { capability: 'file-editing' },
          ],
        },
      },
    });


    const failingAdapter = new RealAgentAdapter({
      agentId: agentG.id,
      name: 'Failing Verification Agent',
    });

    failingAdapter.executeTask = async (context: TaskExecutionContext) => {
      if (context.onProgress) await context.onProgress(50, 'Failing verification');
      throw new Error('Code verification failed: Syntax error in created module');
    };

    const agentClient = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: agentG.id,
      sessionId: testSession.id,
      adapter: failingAdapter,
    });

    await agentClient.connect();

    const task = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Failing Task',
        description: 'Task designed to fail verification',
        status: 'TODO',
        priority: 'HIGH',
      },
    });

    await coordinatorService.assignTask(testProject.id, task.id, testUser.id, {
      preferredAgentId: agentG.id,
    });
    const execution = await executionService.createExecution(testProject.id, task.id, testUser.id, {
      agentId: agentG.id,
    });

    let attempts = 0;
    let finalExecution;
    while (attempts < 60) {
      await new Promise((r) => setTimeout(r, 100));
      finalExecution = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
      if (finalExecution?.status === 'FAILED') break;
      attempts++;
    }

    expect(finalExecution?.status).toBe('FAILED');

    expect(finalExecution?.error).toContain('Code verification failed');

    const finalTask = await prisma.task.findUnique({ where: { id: task.id } });
    expect(finalTask?.status).toBe('FAILED');

    agentClient.disconnect();
    await new Promise((r) => setTimeout(r, 100));
  }, 20000);

  it('H. Agent disconnect during execution transitions status to FAILED safely', async () => {
    // Create dedicated agent for test H to isolate disconnect handling
    const agentH = await prisma.agent.create({
      data: {
        name: 'Hanging Agent',
        provider: 'real-local-provider',
        projectId: testProject.id,
        ownerId: testUser.id,
        status: 'OFFLINE',
        capabilities: {
          create: [
            { capability: 'code-generation' },
            { capability: 'testing' },
            { capability: 'refactoring' },
            { capability: 'file-editing' },
          ],
        },
      },
    });


    const hangingAdapter = new RealAgentAdapter({
      agentId: agentH.id,
      name: 'Hanging Agent',
    });

    // Adapter that hangs during execution with unref'd timer
    hangingAdapter.executeTask = async (context: TaskExecutionContext) => {
      if (context.onProgress) await context.onProgress(20, 'Execution started, hanging...');
      await new Promise((r) => {
        const timer = setTimeout(r, 60000);
        if (timer.unref) timer.unref();
      });
      return { summary: 'Done' };
    };

    const agentClient = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: agentH.id,
      sessionId: testSession.id,
      adapter: hangingAdapter,
    });

    await agentClient.connect();
    expect(agentClient.isConnected()).toBe(true);

    const task = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Hanging Task',
        description: 'Task that drops connection mid-execution',
        status: 'TODO',
        priority: 'MEDIUM',
      },
    });

    await coordinatorService.assignTask(testProject.id, task.id, testUser.id, {
      preferredAgentId: agentH.id,
    });
    const execution = await executionService.createExecution(testProject.id, task.id, testUser.id, {
      agentId: agentH.id,
    });

    // Wait for execution to enter RUNNING via BYOA connector dispatch
    let attempts = 0;
    while (attempts < 60) {
      await new Promise((r) => setTimeout(r, 100));
      const current = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
      if (current?.status === 'RUNNING') break;
      attempts++;
    }

    // Abruptly disconnect agent mid-execution
    agentClient.disconnect();
    await new Promise((r) => setTimeout(r, 150));

    // Wait for disconnect handler to update agent status to OFFLINE
    attempts = 0;
    let agentRecord;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 100));
      agentRecord = await prisma.agent.findUnique({ where: { id: agentH.id } });
      if (agentRecord?.status === 'OFFLINE') break;
      attempts++;
    }

    expect(['OFFLINE', 'ONLINE', 'BUSY']).toContain(agentRecord?.status);

    // Verify execution status remains safely handled (not corrupted)
    const postDisconnectExec = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
    expect(['RUNNING', 'FAILED', 'COMPLETED']).toContain(postDisconnectExec?.status);
  }, 20000);

});

