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
import { dependencyService } from '../services/dependency.service.js';
import { artifactService } from '../services/artifact.service.js';
import { AgentMeshClient, RealAgentAdapter } from '@agentmesh/cli';

describe('PRD-32 Real Agent-to-Agent Artifact Exchange Integration Tests', () => {
  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  let testUser: { id: string };
  let testSession: { id: string };
  let testProject: { id: string };
  let testAgentA: { id: string };
  let testAgentB: { id: string };

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
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'scratch-prd32-test-'));
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
      data: { walletAddress: wallet, displayName: 'Artifact Exchange Tester' },
    });
    testSession = await sessionService.createSession(testUser.id);

    testProject = await prisma.project.create({
      data: { name: 'PRD32 Artifact Exchange Project', ownerId: testUser.id },
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

    // Create Agent A (Producer) and Agent B (Consumer)
    testAgentA = await prisma.agent.create({
      data: {
        name: 'Agent A (Producer)',
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

    testAgentB = await prisma.agent.create({
      data: {
        name: 'Agent B (Consumer)',
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
      await prisma.taskDependency.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
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

  it('1. Task B depends on Artifact A / Task A (TaskDependency created & persisted)', async () => {
    const taskA = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Task A — Produce Auth Module',
        description: 'Implement auth module and publish artifact',
        status: 'TODO',
        priority: 'HIGH',
      },
    });

    const taskB = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Task B — Integrate Auth Module',
        description: 'Integrate auth module produced by Task A',
        status: 'TODO',
        priority: 'HIGH',
      },
    });

    const dep = await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    expect(dep).toBeDefined();
    expect(dep.taskId).toBe(taskB.id);
    expect(dep.dependsOnTaskId).toBe(taskA.id);
    expect(dep.dependencyType).toBe('ARTIFACT_REQUIRED');
  });

  it('2. Unsatisfied artifact dependency blocks Task B assignment & execution', async () => {
    const taskA = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Blocked Producer Task A',
        description: 'Task A desc',
        status: 'TODO',
      },
    });

    const taskB = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Blocked Consumer Task B',
        description: 'Task B desc',
        status: 'TODO',
      },
    });

    await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    // Check dependency resolution
    const resolution = await dependencyService.resolveTaskDependencies(testProject.id, taskB.id, testUser.id);
    expect(resolution.ready).toBe(false);

    // Attempt assignment -> blocked by dependency gating
    const assignRes = await coordinatorService.assignTask(testProject.id, taskB.id, testUser.id, {
      preferredAgentId: testAgentB.id,
    });
    expect(assignRes.assigned).toBe(false);
    if (!assignRes.assigned) {
      expect(assignRes.reason).toBe('DEPENDENCIES_NOT_SATISFIED');
    }
  });

  it('3-8. Full Genuine Collaboration Loop: Agent A -> Artifact A -> AgentMesh -> Agent B -> Artifact B', async () => {
    // 1. Connect Agent A and Agent B via BYOA client
    const adapterA = new RealAgentAdapter({
      agentId: testAgentA.id,
      name: 'Agent A (Producer)',
    });
    const clientA = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: testAgentA.id,
      sessionId: testSession.id,
      adapter: adapterA,
    });

    const adapterB = new RealAgentAdapter({
      agentId: testAgentB.id,
      name: 'Agent B (Consumer)',
    });
    const clientB = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: testAgentB.id,
      sessionId: testSession.id,
      adapter: adapterB,
    });

    await clientA.connect();
    await clientB.connect();

    expect(clientA.isConnected()).toBe(true);
    expect(clientB.isConnected()).toBe(true);

    // 2. Create Task A & Task B with dependency (Task B requires Artifact A from Task A)
    const taskA = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Task A — Produce Auth API Contract',
        description: 'Implement auth module inside src/health.ts',
        status: 'TODO',
      },
    });

    const taskB = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Task B — Consume Auth API Contract',
        description: 'Integrate auth contract into src/consumer.ts',
        status: 'TODO',
      },
    });

    const taskDependency = await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    expect(taskDependency).toBeDefined();

    // Verify Task B is blocked initially
    const initialRes = await dependencyService.resolveTaskDependencies(testProject.id, taskB.id, testUser.id);
    expect(initialRes.ready).toBe(false);

    // 3. Assign & execute Task A with Agent A
    const assignA = await coordinatorService.assignTask(testProject.id, taskA.id, testUser.id, {
      preferredAgentId: testAgentA.id,
    });
    expect(assignA.assigned).toBe(true);

    const execA = await executionService.createExecution(testProject.id, taskA.id, testUser.id, {
      agentId: testAgentA.id,
      input: { action: 'produce-artifact' },
    });

    // Wait for Task A execution to complete & produce Artifact A
    let attempts = 0;
    let artifactA;
    while (attempts < 40) {
      await new Promise((r) => setTimeout(r, 150));
      artifactA = await prisma.artifact.findFirst({
        where: { taskId: taskA.id },
      });
      if (artifactA) break;
      attempts++;
    }

    expect(artifactA).toBeDefined();
    expect(artifactA?.agentId).toBe(testAgentA.id);
    expect(artifactA?.type).toBe('CODE');

    const worktreeA = await prisma.gitWorktree.findUnique({
      where: { executionId: execA.id },
    });
    expect(worktreeA).toBeDefined();

    // 4. Verify Task B dependency automatically becomes READY & satisfied after Artifact A creation
    attempts = 0;
    let readyRes;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 100));
      readyRes = await dependencyService.resolveTaskDependencies(testProject.id, taskB.id, testUser.id);
      if (readyRes.ready) break;
      attempts++;
    }
    expect(readyRes?.ready).toBe(true);

    // 5. Assign & execute Task B with Agent B
    const assignB = await coordinatorService.assignTask(testProject.id, taskB.id, testUser.id, {
      preferredAgentId: testAgentB.id,
    });
    expect(assignB.assigned).toBe(true);

    const execB = await executionService.createExecution(testProject.id, taskB.id, testUser.id, {
      agentId: testAgentB.id,
      input: { action: 'consume-artifact' },
    });

    // Wait for Task B execution to complete & produce Artifact B
    attempts = 0;
    let artifactB;
    while (attempts < 40) {
      await new Promise((r) => setTimeout(r, 150));
      artifactB = await prisma.artifact.findFirst({
        where: { taskId: taskB.id },
      });
      if (artifactB) break;
      attempts++;
    }

    expect(artifactB).toBeDefined();
    expect(artifactB?.agentId).toBe(testAgentB.id);

    const worktreeB = await prisma.gitWorktree.findUnique({
      where: { executionId: execB.id },
    });
    expect(worktreeB).toBeDefined();

    // 6. Verify Worktree Isolation: Worktree A != Worktree B != Primary Checkout
    expect(worktreeA!.path).not.toEqual(worktreeB!.path);
    expect(worktreeA!.path).not.toEqual(primaryRepoPath);
    expect(worktreeB!.path).not.toEqual(primaryRepoPath);

    // Verify Agent B created src/consumer.ts in Worktree B containing content derived from Artifact A
    const consumerFilePath = path.join(worktreeB!.path, 'src', 'consumer.ts');
    expect(fs.existsSync(consumerFilePath)).toBe(true);
    const consumerContent = fs.readFileSync(consumerFilePath, 'utf8');
    expect(consumerContent).toContain('producer-output-from-' + testAgentA.id);

    // Verify primary repo checkout remains 100% clean and untouched
    const primaryConsumerPath = path.join(primaryRepoPath, 'src', 'consumer.ts');
    expect(fs.existsSync(primaryConsumerPath)).toBe(false);

    // 7. Verify Artifact B payload contains provenance referencing Artifact A
    const payloadB = artifactB!.payload as Record<string, unknown>;
    expect(payloadB.consumedArtifacts).toBeDefined();
    const consumedList = payloadB.consumedArtifacts as Array<{ artifactId: string }>;
    expect(consumedList.length).toBeGreaterThan(0);
    expect(consumedList[0].artifactId).toBe(artifactA!.id);

    clientA.disconnect();
    clientB.disconnect();
  }, 25000);

  it('9. Producer failure keeps consumer task blocked', async () => {
    const failingAgent = await prisma.agent.create({
      data: {
        name: 'Failing Producer Agent',
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

    const taskProducer = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Failing Producer Task',
        description: 'Producer designed to fail',
        status: 'TODO',
      },
    });

    const taskConsumer = await prisma.task.create({
      data: {
        projectId: testProject.id,
        creatorId: testUser.id,
        title: 'Consumer Waiting Task',
        description: 'Consumer waiting for failing producer',
        status: 'TODO',
      },
    });

    await dependencyService.createDependency(testProject.id, taskConsumer.id, testUser.id, {
      dependsOnTaskId: taskProducer.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    // Setup failing adapter
    const failingAdapter = new RealAgentAdapter({
      agentId: failingAgent.id,
    });
    failingAdapter.executeTask = async () => {
      throw new Error('Producer execution failed unexpectedly');
    };

    const failingClient = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: failingAgent.id,
      sessionId: testSession.id,
      adapter: failingAdapter,
    });

    await failingClient.connect();

    await coordinatorService.assignTask(testProject.id, taskProducer.id, testUser.id, {
      preferredAgentId: failingAgent.id,
    });
    const execProducer = await executionService.createExecution(testProject.id, taskProducer.id, testUser.id, {
      agentId: failingAgent.id,
    });

    let attempts = 0;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 100));
      const currentExec = await prisma.taskExecution.findUnique({ where: { id: execProducer.id } });
      if (currentExec?.status === 'FAILED') break;
      attempts++;
    }

    // Consumer task B must remain blocked
    const consumerResolution = await dependencyService.resolveTaskDependencies(
      testProject.id,
      taskConsumer.id,
      testUser.id,
    );
    expect(consumerResolution.ready).toBe(false);

    const assignConsumerRes = await coordinatorService.assignTask(
      testProject.id,
      taskConsumer.id,
      testUser.id,
      { preferredAgentId: testAgentB.id },
    );
    expect(assignConsumerRes.assigned).toBe(false);
    if (!assignConsumerRes.assigned) {
      expect(assignConsumerRes.reason).toBe('DEPENDENCIES_NOT_SATISFIED');
    }

    failingClient.disconnect();
  }, 20000);

  it('10. Cross-project artifact dependency access is rejected', async () => {
    // Create second project owned by testUser
    const project2 = await prisma.project.create({
      data: { name: 'PRD32 Isolation Project 2', ownerId: testUser.id },
    });
    await prisma.projectMember.create({
      data: { projectId: project2.id, userId: testUser.id, role: 'OWNER' },
    });

    const taskProject2 = await prisma.task.create({
      data: {
        projectId: project2.id,
        creatorId: testUser.id,
        title: 'Project 2 Task',
        description: 'Task in project 2',
        status: 'TODO',
      },
    });

    // Create artifact in testProject
    const artifactProject1 = await artifactService.createArtifact(
      testProject.id,
      (await prisma.task.findFirst({ where: { projectId: testProject.id } }))!.id,
      testUser.id,
      {
        type: 'CODE',
        name: 'Project 1 Artifact',
        agentId: testAgentA.id,
        payload: { secret: 'proj1-data' },
      },
    );

    // Attempting to create dependency in project2 targeting artifact from project1 must throw
    await expect(
      dependencyService.createDependency(project2.id, taskProject2.id, testUser.id, {
        artifactId: artifactProject1.id,
        dependencyType: 'ARTIFACT_REQUIRED',
      }),
    ).rejects.toThrow('Artifact not found in this project');

    // Cleanup project2
    await prisma.taskDependency.deleteMany({ where: { projectId: project2.id } }).catch(() => {});
    await prisma.task.deleteMany({ where: { projectId: project2.id } }).catch(() => {});
    await prisma.projectMember.deleteMany({ where: { projectId: project2.id } }).catch(() => {});
    await prisma.project.delete({ where: { id: project2.id } }).catch(() => {});
  });
});
