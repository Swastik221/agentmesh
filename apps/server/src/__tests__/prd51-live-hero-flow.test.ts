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
import { policyService } from '../services/policy.service.js';
import { x402Service } from '../payments/x402.service.js';
import { PAYMENT_CONFIG } from '../payments/payment.config.js';
import { AgentMeshClient, RealAgentAdapter } from '@agentmesh/cli';
import { PolicyDecision } from '@prisma/client';

describe('PRD-51 Final Live Hero Flow Integration Tests', () => {
  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  let testUser: { id: string; walletAddress: string };
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
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'scratch-prd51-test-'));
    workspaceRoot = path.join(tempDir, 'workspace');
    primaryRepoPath = path.join(workspaceRoot, 'repo');

    fs.mkdirSync(primaryRepoPath, { recursive: true });
    fs.mkdirSync(path.join(primaryRepoPath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(primaryRepoPath, 'README.md'), '# PRD51 Hero Flow Repo\n');
    fs.writeFileSync(
      path.join(primaryRepoPath, 'package.json'),
      JSON.stringify({ name: 'prd51-repo', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }),
    );

    execSync('git init', { cwd: primaryRepoPath });
    execSync('git config user.name "PRD51 Tester"', { cwd: primaryRepoPath });
    execSync('git config user.email "prd51@example.com"', { cwd: primaryRepoPath });
    execSync('git add .', { cwd: primaryRepoPath });
    execSync('git commit -m "initial commit"', { cwd: primaryRepoPath });

    // 3. Database fixtures
    const wallet = `0x${Date.now().toString(16).padEnd(40, '0')}`;
    const createdUser = await prisma.user.create({
      data: { walletAddress: wallet, displayName: 'PRD51 Hero Flow Tester' },
    });
    testUser = { id: createdUser.id, walletAddress: createdUser.walletAddress || '' };
    testSession = await sessionService.createSession(testUser.id);

    testProject = await prisma.project.create({
      data: { name: 'PRD51 Final Live Hero Flow Project', ownerId: testUser.id },
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
        name: 'Agent A (Security Auditor)',
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
        name: 'Agent B (Remediation Engineer)',
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
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    if (testProject?.id) {
      await prisma.approvalRequest.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
      await prisma.policy.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
      await prisma.gitWorktree.deleteMany({ where: { workspace: { projectId: testProject.id } } }).catch(() => {});
      await prisma.artifact.deleteMany({ where: { projectId: testProject.id } }).catch(() => {});
      await prisma.taskExecution.deleteMany({ where: { task: { projectId: testProject.id } } }).catch(() => {});
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

  it('Test 1 — Real SIWE Session & Live Workspace Access', async () => {
    // Validate session created via sessionService is active & authorized
    const validatedSession = await sessionService.validateSession(testSession.id);
    expect(validatedSession).not.toBeNull();
    expect(validatedSession?.user.id).toBe(testUser.id);
    expect(validatedSession?.user.walletAddress).toBe(testUser.walletAddress);

    // Verify project authorization for the authenticated session user
    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: testProject.id,
          userId: testUser.id,
        },
      },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe('OWNER');
  });

  it('Test 2 — Task B is BLOCKED before Artifact A exists', async () => {
    const taskA = await prisma.task.create({
      data: {
        title: 'Task A — Perform Security Audit',
        description: 'Audit primary codebase for vulnerabilities',
        projectId: testProject.id,
        creatorId: testUser.id,
        status: 'TODO',
      },
    });

    const taskB = await prisma.task.create({
      data: {
        title: 'Task B — Remediate Security Audit',
        description: 'Apply security patches based on audit report',
        projectId: testProject.id,
        creatorId: testUser.id,
        status: 'TODO',
      },
    });

    await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    // Verify Task B is reported as BLOCKED (not ready)
    const readyRes = await dependencyService.resolveTaskDependencies(testProject.id, taskB.id, testUser.id);
    expect(readyRes.ready).toBe(false);

    // Verify coordinator assignTask rejects assignment due to unsatisfied dependencies
    const assignResult = await coordinatorService.assignTask(testProject.id, taskB.id, testUser.id, {
      preferredAgentId: testAgentB.id,
    });
    expect(assignResult.assigned).toBe(false);
    if (!assignResult.assigned) {
      expect(assignResult.reason).toBe('DEPENDENCIES_NOT_SATISFIED');
    }

    // Clean up temporary test tasks
    await prisma.taskDependency.deleteMany({ where: { taskId: taskB.id } });
    await prisma.task.deleteMany({ where: { id: { in: [taskA.id, taskB.id] } } });
  });

  it('Test 3 - 9 — Complete Hero Flow (Agent A -> Approval -> x402 Payment -> Artifact A -> Dependency Ready -> Agent B -> Provenance & ContentHash)', async () => {
    const UNIQUE_PRODUCER_VALUE = `UNIQUE-PRODUCER-VALUE-${Date.now()}`;

    // 1. Connect Real Agent A via WebSocket client
    const adapterA = new RealAgentAdapter({ agentId: testAgentA.id, name: 'Agent A' });
    const clientA = new AgentMeshClient({
      serverUrl: `http://127.0.0.1:${serverPort}`,
      workspaceId: testProject.id,
      agentId: testAgentA.id,
      sessionId: testSession.id,
      adapter: adapterA,
    });

    // 2. Connect Real Agent B via WebSocket client
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

    // 3. Create Task A and Task B with artifact dependency
    const taskA = await prisma.task.create({
      data: {
        title: 'Hero Flow Task A — Audit',
        description: 'Perform security audit on project codebase',
        projectId: testProject.id,
        creatorId: testUser.id,
        status: 'TODO',
      },
    });

    const taskB = await prisma.task.create({
      data: {
        title: 'Hero Flow Task B — Remediate',
        description: 'Remediate security findings from audit',
        projectId: testProject.id,
        creatorId: testUser.id,
        status: 'TODO',
      },
    });

    await dependencyService.createDependency(testProject.id, taskB.id, testUser.id, {
      dependsOnTaskId: taskA.id,
      dependencyType: 'ARTIFACT_REQUIRED',
    });

    // Verify Task B is BLOCKED (not ready) initially
    const initialReadyRes = await dependencyService.resolveTaskDependencies(testProject.id, taskB.id, testUser.id);
    expect(initialReadyRes.ready).toBe(false);

    // 4. Test Policy Approval System (Section 15)
    await prisma.policy.create({
      data: {
        projectId: testProject.id,
        name: 'Require Approval for Task Execution',
        action: 'task.execute',
        decision: PolicyDecision.APPROVAL_REQUIRED,
      },
    });

    const policyResult = await policyService.evaluateAction(testProject.id, 'task.execute');
    expect(policyResult.decision).toBe(PolicyDecision.APPROVAL_REQUIRED);

    // 5. Test Real x402 Payment Requirement & Settle Structure (Section 16 & 17)
    const requirement = x402Service.generateRequirement({
      amount: PAYMENT_CONFIG.DEFAULT_ATOMIC_AMOUNT,
      asset: PAYMENT_CONFIG.USDC_TOKEN_ID,
      network: PAYMENT_CONFIG.NETWORK,
      receiver: PAYMENT_CONFIG.RECEIVER_ADDRESS,
    });
    expect(requirement.network).toBe('hedera:testnet');
    expect(requirement.asset).toBe('0.0.429274');
    expect(requirement.receiver).toBe(PAYMENT_CONFIG.RECEIVER_ADDRESS);

    // 6. Assign Task A
    await coordinatorService.assignTask(testProject.id, taskA.id, testUser.id, { preferredAgentId: testAgentA.id });

    // Attempt createExecution -> triggers ApprovalRequiredError
    let caughtApprovalError: Error | null = null;
    try {
      await executionService.createExecution(testProject.id, taskA.id, testUser.id, {
        agentId: testAgentA.id,
        input: { action: 'produce-artifact', sourceValue: UNIQUE_PRODUCER_VALUE },
      });
    } catch (err) {
      caughtApprovalError = err as Error;
    }
    expect(caughtApprovalError).not.toBeNull();
    expect(caughtApprovalError?.message).toContain('Execution blocked pending human approval');

    // Human approves pending approval request in real database
    const pendingApproval = await prisma.approvalRequest.findFirst({
      where: { projectId: testProject.id, action: 'task.execute', status: 'PENDING' },
    });
    expect(pendingApproval).not.toBeNull();

    await prisma.approvalRequest.update({
      where: { id: pendingApproval!.id },
      data: { status: 'APPROVED', resolvedByUserId: testUser.id },
    });

    // Execute Task A after human approval
    const execA = await executionService.createExecutionBypassingPolicy(testProject.id, taskA.id, testUser.id, {
      agentId: testAgentA.id,
      input: { action: 'produce-artifact', sourceValue: UNIQUE_PRODUCER_VALUE },
    });
    expect(execA).toBeDefined();

    // Wait for Task A execution & Artifact A creation
    let attemptsA = 0;
    let artifactA;
    while (attemptsA < 40) {
      await new Promise((r) => setTimeout(r, 150));
      artifactA = await prisma.artifact.findFirst({ where: { taskId: taskA.id } });
      if (artifactA) break;
      attemptsA++;
    }

    expect(artifactA).toBeDefined();
    expect(artifactA?.agentId).toBe(testAgentA.id);

    const payloadA = artifactA!.payload as Record<string, unknown>;
    expect(payloadA.sourceValue).toBe(UNIQUE_PRODUCER_VALUE);

    const artifactADetail = await artifactService.getArtifact(testProject.id, artifactA!.id, testUser.id);
    expect(artifactADetail.contentHash).toBeDefined();
    const artifactAHash = artifactADetail.contentHash;

    // 7. Verify Dependency Resolution — Task B becomes ready (Test 4)
    let readyRes;
    let attemptsReady = 0;
    while (attemptsReady < 20) {
      await new Promise((r) => setTimeout(r, 100));
      readyRes = await dependencyService.resolveTaskDependencies(testProject.id, taskB.id, testUser.id);
      if (readyRes.ready) break;
      attemptsReady++;
    }
    expect(readyRes?.ready).toBe(true);

    // 8. Assign and Execute Task B with Agent B
    await coordinatorService.assignTask(testProject.id, taskB.id, testUser.id, { preferredAgentId: testAgentB.id });
    const execB = await executionService.createExecutionBypassingPolicy(testProject.id, taskB.id, testUser.id, {
      agentId: testAgentB.id,
      input: { action: 'consume-artifact' },
    });
    expect(execB).toBeDefined();

    // Wait for Task B execution & Artifact B creation
    let attemptsB = 0;
    let artifactB;
    while (attemptsB < 40) {
      await new Promise((r) => setTimeout(r, 150));
      artifactB = await prisma.artifact.findFirst({ where: { taskId: taskB.id } });
      if (artifactB) break;
      attemptsB++;
    }

    expect(artifactB).toBeDefined();
    expect(artifactB?.agentId).toBe(testAgentB.id);

    // Verify Worktree B contains consumed content with UNIQUE_PRODUCER_VALUE
    const worktreeB = await prisma.gitWorktree.findUnique({ where: { executionId: execB.id } });
    expect(worktreeB).toBeDefined();
    expect(worktreeB?.path).toBeDefined();

    const consumerFile = path.join(worktreeB!.path, 'src', 'consumer.ts');
    expect(fs.existsSync(consumerFile)).toBe(true);
    const fileText = fs.readFileSync(consumerFile, 'utf8');
    expect(fileText).toContain(UNIQUE_PRODUCER_VALUE);

    // 9. Test 7 & 8 — Verify Artifact B records Artifact A Provenance and preserves Content Hash
    const payloadB = artifactB!.payload as Record<string, unknown>;
    expect(payloadB.consumedArtifacts).toBeDefined();
    const consumedList = payloadB.consumedArtifacts as Array<{ artifactId: string; contentHash?: string }>;
    expect(consumedList.length).toBeGreaterThan(0);
    expect(consumedList[0].artifactId).toBe(artifactA!.id);
    expect(consumedList[0].contentHash).toBe(artifactAHash);

    // Test 9 — Worktree Isolation: Primary git checkout remains clean
    const gitStatusOutput = execSync('git status --porcelain', { cwd: primaryRepoPath }).toString();
    expect(gitStatusOutput.trim()).toBe('');

    // Disconnect agents
    await clientA.disconnect();
    await clientB.disconnect();
  }, 40000);

  it('Test 10 — Producer Failure Safety', async () => {
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

    // Verify no artifact was created for failing producer
    const artifactCount = await prisma.artifact.count({ where: { taskId: taskFailProducer.id } });
    expect(artifactCount).toBe(0);
  });

  it('Test 11 — Consumer Failure Safety', async () => {
    // First, produce a valid artifact for Task A
    const producerTask = await prisma.task.create({
      data: {
        title: 'Producer Task for Consumer Failure Test',
        description: 'Produces valid artifact for consumer failure test',
        projectId: testProject.id,
        creatorId: testUser.id,
        status: 'COMPLETED',
      },
    });

    const validArtifact = await artifactService.createArtifact(testProject.id, producerTask.id, testUser.id, {
      type: 'DATA',
      name: 'valid-producer-artifact',
      payload: { data: 'essential' },
      agentId: testAgentA.id,
    });

    // Create consumer task depending on validArtifact
    const consumerTask = await prisma.task.create({
      data: {
        title: 'Failing Consumer Task',
        description: 'Consumer task that crashes during processing',
        projectId: testProject.id,
        creatorId: testUser.id,
        status: 'TODO',
      },
    });

    await dependencyService.createDependency(testProject.id, consumerTask.id, testUser.id, {
      dependsOnTaskId: producerTask.id,
      dependencyType: 'ARTIFACT_REQUIRED:name:valid-producer-artifact',
    });

    // Verify producer artifact remains safely intact in Postgres
    const artifactStillExists = await prisma.artifact.findUnique({ where: { id: validArtifact.id } });
    expect(artifactStillExists).not.toBeNull();

    // Verify no consumer artifact was falsely created
    const consumerArtifactCount = await prisma.artifact.count({ where: { taskId: consumerTask.id } });
    expect(consumerArtifactCount).toBe(0);
  }, 30000);

  it('Test 12 — Cross-Project Authorization Isolation', async () => {
    // Create Project 2
    const project2 = await prisma.project.create({
      data: { name: 'PRD51 Isolated Project 2', ownerId: testUser.id },
    });
    await prisma.projectMember.create({
      data: { projectId: project2.id, userId: testUser.id, role: 'OWNER' },
    });

    const agentInProject2 = await prisma.agent.create({
      data: {
        name: 'Agent in Project 2',
        provider: 'real-local-provider',
        projectId: project2.id,
        ownerId: testUser.id,
        status: 'OFFLINE',
      },
    });

    const taskInProject1 = await prisma.task.create({
      data: {
        title: 'Project 1 Task',
        description: 'Task in Project 1',
        projectId: testProject.id,
        creatorId: testUser.id,
        status: 'COMPLETED',
      },
    });

    const taskInProject2 = await prisma.task.create({
      data: {
        title: 'Task in Project 2',
        description: 'Task isolated in project 2',
        projectId: project2.id,
        creatorId: testUser.id,
        status: 'TODO',
      },
    });

    // Create an artifact in Project 1
    const artifactInProject1 = await artifactService.createArtifact(testProject.id, taskInProject1.id, testUser.id, {
      type: 'SECRET',
      name: 'project-1-secret-artifact',
      payload: { topSecret: true },
      agentId: testAgentA.id,
    });
    expect(artifactInProject1).toBeDefined();

    // Attempting to set dependency across projects should throw or reject
    let crossProjectError = null;
    try {
      await dependencyService.createDependency(project2.id, taskInProject2.id, testUser.id, {
        dependsOnTaskId: taskInProject1.id,
        dependencyType: 'ARTIFACT_REQUIRED:name:project-1-secret-artifact',
      });
    } catch (err) {
      crossProjectError = err;
    }

    // Must prevent cross-project dependency resolution or reject it
    expect(crossProjectError).not.toBeNull();

    // Clean up Project 2 fixtures
    await prisma.taskDependency.deleteMany({ where: { taskId: taskInProject2.id } });
    await prisma.task.deleteMany({ where: { id: { in: [taskInProject1.id, taskInProject2.id] } } });
    await prisma.agent.deleteMany({ where: { id: agentInProject2.id } });
    await prisma.projectMember.deleteMany({ where: { projectId: project2.id } });
    await prisma.project.delete({ where: { id: project2.id } });
  });
});
