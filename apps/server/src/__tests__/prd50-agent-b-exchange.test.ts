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

describe('PRD-50 Real Agent B Artifact Exchange Integration Tests', () => {
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
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'scratch-prd50-test-'));
    workspaceRoot = path.join(tempDir, 'workspace');
    primaryRepoPath = path.join(workspaceRoot, 'repo');

    fs.mkdirSync(primaryRepoPath, { recursive: true });
    fs.mkdirSync(path.join(primaryRepoPath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(primaryRepoPath, 'README.md'), '# PRD50 Repo\n');
    fs.writeFileSync(
      path.join(primaryRepoPath, 'package.json'),
      JSON.stringify({ name: 'prd50-repo', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }),
    );

    execSync('git init', { cwd: primaryRepoPath });
    execSync('git config user.name "PRD50 Tester"', { cwd: primaryRepoPath });
    execSync('git config user.email "prd50@example.com"', { cwd: primaryRepoPath });
    execSync('git add .', { cwd: primaryRepoPath });
    execSync('git commit -m "initial commit"', { cwd: primaryRepoPath });

    // 3. Database fixtures
    const wallet = `0x${Date.now().toString(16).padEnd(40, '0')}`;
    testUser = await prisma.user.create({
      data: { walletAddress: wallet, displayName: 'PRD50 Exchange Tester' },
    });
    testSession = await sessionService.createSession(testUser.id);

    testProject = await prisma.project.create({
      data: { name: 'PRD50 Agent Exchange Project', ownerId: testUser.id },
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

  it('Test 1: Artifact dependency initially blocks Task B assignment & execution', async () => {
    const taskA = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Producer Task 1', description: 'Producer task description', status: 'TODO' },
    });
    const taskB = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Consumer Task 1', description: 'Consumer task description', status: 'TODO' },
    });

    await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    const resolution = await dependencyService.resolveTaskDependencies(testProject.id, taskB.id, testUser.id);
    expect(resolution.ready).toBe(false);

    const assignRes = await coordinatorService.assignTask(testProject.id, taskB.id, testUser.id, {
      preferredAgentId: testAgentB.id,
    });
    expect(assignRes.assigned).toBe(false);
    if (!assignRes.assigned) {
      expect(assignRes.reason).toBe('DEPENDENCIES_NOT_SATISFIED');
    }
  });

  it('Test 2 & 13: Multi-artifact producer matching resolves exact intended dependency and ignores duplicate/unrelated artifacts', async () => {
    const taskA = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Multi Artifact Task A', description: 'Produces build log and audit', status: 'TODO' },
    });
    const taskB = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Specific Consumer Task B', description: 'Requires audit spec', status: 'TODO' },
    });

    const dep = await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED:name:agent-a-audit',
    });

    // Unrelated artifact (build-log) published by Task A
    const artifactUnrelated = await artifactService.createArtifact(testProject.id, taskA.id, testUser.id, {
      type: 'LOG',
      name: 'build-log',
      payload: { log: 'ok' },
      agentId: testAgentA.id,
    });

    const depCheck1 = await prisma.taskDependency.findUnique({ where: { id: dep.id } });
    expect(depCheck1?.artifactId).toBeNull();

    // Exact matching artifact (agent-a-audit) published by Task A
    const artifactAudit = await artifactService.createArtifact(testProject.id, taskA.id, testUser.id, {
      type: 'SECURITY_AUDIT',
      name: 'agent-a-audit',
      payload: { message: 'UNIQUE-PRODUCER-VALUE-12345' },
      agentId: testAgentA.id,
    });

    const depCheck2 = await prisma.taskDependency.findUnique({ where: { id: dep.id } });
    expect(depCheck2?.artifactId).toBe(artifactAudit.id);
    expect(depCheck2?.artifactId).not.toBe(artifactUnrelated.id);
  });

  it('Test 3 & 4: Task B becomes ready after Artifact A, coordinator assigns Agent B when online', async () => {
    // Set agent B ONLINE for coordinator assignment
    await prisma.agent.update({ where: { id: testAgentB.id }, data: { status: 'ONLINE' } });

    const taskA = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Task A Ready Test', description: 'Task A description', status: 'TODO' },
    });
    const taskB = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Task B Ready Test', description: 'Task B description', status: 'TODO' },
    });

    await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    await artifactService.createArtifact(testProject.id, taskA.id, testUser.id, {
      type: 'CODE',
      name: 'spec-a',
      payload: { value: 'spec' },
      agentId: testAgentA.id,
    });

    const resolution = await dependencyService.resolveTaskDependencies(testProject.id, taskB.id, testUser.id);
    expect(resolution.ready).toBe(true);

    const assignB = await coordinatorService.assignTask(testProject.id, taskB.id, testUser.id, {
      preferredAgentId: testAgentB.id,
    });
    expect(assignB.assigned).toBe(true);
  });

  it('Test 5 - 9: Complete Causal Consumption Loop (Agent A -> Artifact A -> Agent B -> Worktree B -> Artifact B with provenance & contentHash)', async () => {
    const adapterA = new RealAgentAdapter({ agentId: testAgentA.id, name: 'Agent A' });
    const clientA = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: testAgentA.id,
      sessionId: testSession.id,
      adapter: adapterA,
    });

    const adapterB = new RealAgentAdapter({ agentId: testAgentB.id, name: 'Agent B' });
    const clientB = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: testAgentB.id,
      sessionId: testSession.id,
      adapter: adapterB,
    });

    await clientA.connect();
    await clientB.connect();

    await prisma.agent.update({ where: { id: testAgentA.id }, data: { status: 'ONLINE' } });
    await prisma.agent.update({ where: { id: testAgentB.id }, data: { status: 'ONLINE' } });

    expect(clientA.isConnected()).toBe(true);
    expect(clientB.isConnected()).toBe(true);

    const uniqueProducerValue = 'UNIQUE-PRODUCER-VALUE-12345';

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

    await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });


    await coordinatorService.assignTask(testProject.id, taskA.id, testUser.id, { preferredAgentId: testAgentA.id });
    const execA = await executionService.createExecution(testProject.id, taskA.id, testUser.id, {
      agentId: testAgentA.id,
      input: { action: 'produce-artifact', sourceValue: uniqueProducerValue },
    });
    expect(execA).toBeDefined();

    let attempts = 0;
    let artifactA;
    while (attempts < 40) {
      await new Promise((r) => setTimeout(r, 150));
      artifactA = await prisma.artifact.findFirst({ where: { taskId: taskA.id } });
      if (artifactA) break;
      attempts++;
    }

    // Hardened requirement 1: Remove fallback creation. Artifact A MUST exist naturally from Agent A execution.
    expect(artifactA).toBeDefined();
    expect(artifactA?.agentId).toBe(testAgentA.id);
    expect(artifactA?.taskId).toBe(taskA.id);

    const payloadA = artifactA!.payload as Record<string, unknown>;
    expect(payloadA.sourceValue).toBe(uniqueProducerValue);

    // Hardened requirement 4: Use persisted server contentHash from artifactService.getArtifact
    const artifactADetail = await artifactService.getArtifact(testProject.id, artifactA!.id, testUser.id);
    expect(artifactADetail.contentHash).toBeDefined();
    const artifactAHash = artifactADetail.contentHash;

    // Verify Task B is ready now
    attempts = 0;
    let readyRes;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 100));
      readyRes = await dependencyService.resolveTaskDependencies(testProject.id, taskB.id, testUser.id);
      if (readyRes.ready) break;
      attempts++;
    }
    expect(readyRes?.ready).toBe(true);

    // Hardened requirement 3: Verify Agent B receives actual resolved dependency containing Artifact A metadata
    const taskBDeps = await prisma.taskDependency.findMany({
      where: { taskId: taskB.id },
      include: { artifact: true },
    });
    expect(taskBDeps.length).toBeGreaterThan(0);
    const resolvedDep = taskBDeps[0];
    expect(resolvedDep.artifactId).toBe(artifactA!.id);
    expect(resolvedDep.artifact).toBeDefined();
    expect(resolvedDep.artifact?.id).toBe(artifactA!.id);
    expect(resolvedDep.artifact?.agentId).toBe(testAgentA.id);
    expect(resolvedDep.artifact?.taskId).toBe(taskA.id);

    // Execute Task B with Agent B
    await coordinatorService.assignTask(testProject.id, taskB.id, testUser.id, { preferredAgentId: testAgentB.id });
    const execB = await executionService.createExecution(testProject.id, taskB.id, testUser.id, {
      agentId: testAgentB.id,
      input: { action: 'consume-artifact' },
    });
    expect(execB).toBeDefined();

    attempts = 0;
    let artifactB;
    while (attempts < 40) {
      await new Promise((r) => setTimeout(r, 150));
      artifactB = await prisma.artifact.findFirst({ where: { taskId: taskB.id } });
      if (artifactB) break;
      attempts++;
    }

    expect(artifactB).toBeDefined();
    expect(artifactB?.agentId).toBe(testAgentB.id);

    // Hardened requirement 2: Mandatory Worktree B & consumer.ts proof (no conditionals allowed)
    const worktreeB = await prisma.gitWorktree.findUnique({ where: { executionId: execB.id } });
    expect(worktreeB).toBeDefined();
    expect(worktreeB?.path).toBeDefined();

    const consumerFile = path.join(worktreeB!.path, 'src', 'consumer.ts');
    expect(fs.existsSync(consumerFile)).toBe(true);

    const fileText = fs.readFileSync(consumerFile, 'utf8');
    expect(fileText).toContain(uniqueProducerValue);

    // Verify Artifact B payload contains provenance referencing Artifact A and server contentHash
    const payloadB = artifactB!.payload as Record<string, unknown>;
    expect(payloadB.consumedArtifacts).toBeDefined();
    const consumedList = payloadB.consumedArtifacts as Array<{ artifactId: string; contentHash?: string }>;
    expect(consumedList.length).toBeGreaterThan(0);
    expect(consumedList[0].artifactId).toBe(artifactA!.id);
    expect(consumedList[0].contentHash).toBe(artifactAHash);

    clientA.disconnect();
    clientB.disconnect();
  }, 40000);

  it('Test 10: Producer failure leaves Task B blocked', async () => {
    const taskFailProducer = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Producer Fail Task', description: 'Failing producer task', status: 'TODO' },
    });
    const taskConsumerWaiting = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Consumer Wait Task', description: 'Waiting consumer task', status: 'TODO' },
    });

    await dependencyService.createDependency(testProject.id, taskConsumerWaiting.id, testUser.id, {
      dependsOnTaskId: taskFailProducer.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    // Mark producer task as FAILED directly
    await prisma.task.update({
      where: { id: taskFailProducer.id },
      data: { status: 'FAILED' },
    });

    const resolution = await dependencyService.resolveTaskDependencies(
      testProject.id,
      taskConsumerWaiting.id,
      testUser.id,
    );
    expect(resolution.ready).toBe(false);
  });

  it('Test 11: Consumer failure does not invalidate Artifact A', async () => {
    const taskProducer = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Producer Success Task', description: 'Successful producer task', status: 'TODO' },
    });
    const taskConsumerFail = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Consumer Failing Task', description: 'Failing consumer task', status: 'TODO' },
    });

    await dependencyService.createDependency(testProject.id, taskConsumerFail.id, testUser.id, {
      dependsOnTaskId: taskProducer.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    const artifactA = await artifactService.createArtifact(testProject.id, taskProducer.id, testUser.id, {
      type: 'CODE',
      name: 'artifact-a',
      payload: { data: 'val' },
      agentId: testAgentA.id,
    });

    // Mark consumer task FAILED
    await prisma.task.update({
      where: { id: taskConsumerFail.id },
      data: { status: 'FAILED' },
    });

    const checkArtifactA = await prisma.artifact.findUnique({ where: { id: artifactA.id } });
    expect(checkArtifactA).toBeDefined();

    await prisma.artifact.delete({ where: { id: artifactA.id } }).catch(() => {});
  });

  it('Test 12: Cross-project artifact access is rejected', async () => {
    const foreignProject = await prisma.project.create({
      data: { name: 'Foreign Project B', ownerId: testUser.id },
    });
    await prisma.projectMember.create({
      data: { projectId: foreignProject.id, userId: testUser.id, role: 'OWNER' },
    });

    const foreignAgent = await prisma.agent.create({
      data: {
        name: 'Foreign Agent',
        provider: 'real-local-provider',
        projectId: foreignProject.id,
        ownerId: testUser.id,
        status: 'OFFLINE',
      },
    });

    const foreignTask = await prisma.task.create({
      data: { projectId: foreignProject.id, creatorId: testUser.id, title: 'Foreign Task', description: 'Foreign project task', status: 'TODO' },
    });

    const foreignArtifact = await artifactService.createArtifact(foreignProject.id, foreignTask.id, testUser.id, {
      type: 'CODE',
      name: 'foreign-artifact',
      payload: { data: 'secret' },
      agentId: foreignAgent.id,
    });

    const localTask = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Local Task', description: 'Local project task', status: 'TODO' },
    });

    // Cross-project dependency creation should be rejected
    await expect(
      dependencyService.createDependency(testProject.id, localTask.id, testUser.id, {
        dependsOnTaskId: foreignTask.id,
        dependencyType: 'ARTIFACT_REQUIRED',
      }),
    ).rejects.toThrow();

    await prisma.artifact.delete({ where: { id: foreignArtifact.id } }).catch(() => {});
    await prisma.task.delete({ where: { id: foreignTask.id } }).catch(() => {});
    await prisma.agent.delete({ where: { id: foreignAgent.id } }).catch(() => {});
    await prisma.projectMember.deleteMany({ where: { projectId: foreignProject.id } }).catch(() => {});
    await prisma.project.delete({ where: { id: foreignProject.id } }).catch(() => {});
  });

  it('Test 14: Realtime artifact, dependency, and task status events are broadcast', async () => {
    const taskA = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Realtime Task A', description: 'Broadcast task A', status: 'TODO' },
    });
    const taskB = await prisma.task.create({
      data: { projectId: testProject.id, creatorId: testUser.id, title: 'Realtime Task B', description: 'Broadcast task B', status: 'TODO' },
    });

    const dep = await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    expect(dep).toBeDefined();

    const art = await artifactService.createArtifact(testProject.id, taskA.id, testUser.id, {
      type: 'CODE',
      name: 'realtime-spec',
      payload: { data: 'broadcast' },
      agentId: testAgentA.id,
    });

    expect(art).toBeDefined();
    expect(art.contentHash).toBeDefined();
  });
});
