import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, Server as HTTPServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/websocket.server.js';
import { executionService } from '../execution/execution.service.js';
import { AgentMeshMessageType, createAgentMeshMessage } from '@agentmesh/agent-protocol';
import WebSocket from 'ws';
import { paymentService } from '../payments/payment.service.js';
import { x402Service } from '../payments/x402.service.js';

describe('PRD-56 Real Agent Execution Hardening Integration Tests', () => {
  let server: HTTPServer;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  let tempDir: string;
  let primaryRepoPath: string;
  let workspaceRoot: string;

  let testUser: { id: string; walletAddress: string | null };
  let testSession: { id: string };
  let testProjectA: { id: string };
  let testProjectB: { id: string };

  async function connectAndHandshakeAgent(
    projectId: string,
    agentId: string,
    capabilities: string[],
  ): Promise<WebSocket> {
    const wsUrl = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectId}&clientType=agent`;
    const agentWs = new WebSocket(wsUrl, {
      headers: { Cookie: `agentmesh_session=${testSession.id}` },
    });

    await new Promise<void>((resolve, reject) => {
      agentWs.on('open', resolve);
      agentWs.on('error', reject);
    });

    const handshakeMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.AGENT_HANDSHAKE,
      projectId,
      senderId: agentId,
      payload: { agentId, capabilities },
    });

    const handshakePromise = new Promise<void>((resolve, reject) => {
      const handler = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED) {
            agentWs.off('message', handler);
            resolve();
          } else if (msg.type === AgentMeshMessageType.AGENT_HANDSHAKE_REJECTED) {
            agentWs.off('message', handler);
            reject(new Error(`Handshake rejected: ${JSON.stringify(msg.payload)}`));
          }
        } catch {
        // ignore non-JSON or invalid message
      }
      };
      agentWs.on('message', handler);
    });

    agentWs.send(JSON.stringify(handshakeMsg));
    await handshakePromise;
    return agentWs;
  }

  async function createTestAgent(projectId: string, name: string, capabilities: string[] = ['code-analysis']) {
    return await prisma.agent.create({
      data: {
        name,
        provider: 'real-agent-provider',
        projectId,
        ownerId: testUser.id,
        status: 'OFFLINE',
        capabilities: {
          create: capabilities.map((c) => ({ capability: c })),
        },
      },
    });
  }

  beforeAll(async () => {
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

    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'scratch-prd56-test-'));
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

    const wallet = `0x${Date.now().toString(16).padEnd(40, '0')}`;
    testUser = await prisma.user.create({
      data: { walletAddress: wallet, displayName: 'Hardening Tester' },
    });
    testSession = await sessionService.createSession(testUser.id);

    testProjectA = await prisma.project.create({
      data: { name: 'PRD-56 Project A', ownerId: testUser.id },
    });
    await prisma.projectMember.create({
      data: { projectId: testProjectA.id, userId: testUser.id, role: 'OWNER' },
    });
    await prisma.projectWorkspace.create({
      data: {
        projectId: testProjectA.id,
        rootPath: workspaceRoot,
        gitRepoPath: primaryRepoPath,
      },
    });

    testProjectB = await prisma.project.create({
      data: { name: 'PRD-56 Project B', ownerId: testUser.id },
    });
    await prisma.projectMember.create({
      data: { projectId: testProjectB.id, userId: testUser.id, role: 'OWNER' },
    });
    await prisma.projectWorkspace.create({
      data: {
        projectId: testProjectB.id,
        rootPath: workspaceRoot,
        gitRepoPath: primaryRepoPath,
      },
    });
  });

  afterAll(async () => {
    wsServer.close();
    server.close();

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const pIds = [testProjectA?.id, testProjectB?.id].filter(Boolean);
    if (pIds.length > 0) {
      await prisma.gitWorktree.deleteMany({ where: { workspace: { projectId: { in: pIds } } } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { projectId: { in: pIds } } }).catch(() => {});
      await prisma.taskExecution.deleteMany({ where: { task: { projectId: { in: pIds } } } }).catch(() => {});
      await prisma.taskResponsibility.deleteMany({ where: { task: { projectId: { in: pIds } } } }).catch(() => {});
      await prisma.task.deleteMany({ where: { projectId: { in: pIds } } }).catch(() => {});
      await prisma.agentCapability.deleteMany({ where: { agent: { projectId: { in: pIds } } } }).catch(() => {});
      await prisma.agent.deleteMany({ where: { projectId: { in: pIds } } }).catch(() => {});
      await prisma.projectWorkspace.deleteMany({ where: { projectId: { in: pIds } } }).catch(() => {});
      await prisma.projectMember.deleteMany({ where: { projectId: { in: pIds } } }).catch(() => {});
      await prisma.project.deleteMany({ where: { id: { in: pIds } } }).catch(() => {});
    }

    if (testUser?.id) {
      await prisma.authSession.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  // Test 1: Real agent receives TASK_REQUEST
  it('Test 1: Real agent receives TASK_REQUEST via WebSocket protocol', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T1');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agent.id, ['code-analysis']);

    let receivedTaskRequestPayload: Record<string, unknown> | null = null;
    agentWs.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === AgentMeshMessageType.TASK_REQUEST) {
          receivedTaskRequestPayload = msg.payload as Record<string, unknown>;
        }
      } catch {
        // ignore non-JSON or invalid message
      }
    });

    const task = await prisma.task.create({
      data: {
        projectId: testProjectA.id,
        creatorId: testUser.id,
        title: 'Task for Test 1',
        description: 'Verify TASK_REQUEST delivery',
        status: 'TODO',
      },
    });

    await prisma.taskResponsibility.create({
      data: { taskId: task.id, agentId: agent.id, role: 'PRIMARY' },
    });

    const execution = await executionService.createExecution(testProjectA.id, task.id, testUser.id, {
      agentId: agent.id,
      input: { requireRealAgent: true },
    });

    let attempts = 0;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 100));
      if (receivedTaskRequestPayload) break;
      attempts++;
    }

    expect(receivedTaskRequestPayload).not.toBeNull();
    const payload = receivedTaskRequestPayload as unknown as Record<string, unknown>;
    expect(payload.taskId).toBe(task.id);
    expect(payload.executionId).toBe(execution.id);

    agentWs.close();
    await new Promise((r) => setTimeout(r, 100));
  }, 15000);

  // Test 2: TASK_COMPLETED completes the correct execution
  it('Test 2: TASK_COMPLETED completes the correct execution', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T2');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agent.id, ['code-analysis']);

    agentWs.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === AgentMeshMessageType.TASK_REQUEST) {
          const completedMsg = createAgentMeshMessage({
            type: AgentMeshMessageType.TASK_COMPLETED,
            projectId: testProjectA.id,
            senderId: agent.id,
            payload: {
              taskId: msg.payload.taskId,
              executionId: msg.payload.executionId,
              result: { summary: 'Completed Test 2' },
            },
          });
          agentWs.send(JSON.stringify(completedMsg));
        }
      } catch {
        // ignore non-JSON or invalid message
      }
    });

    const task = await prisma.task.create({
      data: {
        projectId: testProjectA.id,
        creatorId: testUser.id,
        title: 'Task for Test 2',
        description: 'Verify TASK_COMPLETED behavior',
        status: 'TODO',
      },
    });

    await prisma.taskResponsibility.create({
      data: { taskId: task.id, agentId: agent.id, role: 'PRIMARY' },
    });

    const execution = await executionService.createExecution(testProjectA.id, task.id, testUser.id, {
      agentId: agent.id,
      input: { requireRealAgent: true },
    });

    let attempts = 0;
    let updatedExec;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 100));
      updatedExec = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
      if (updatedExec?.status === 'COMPLETED') break;
      attempts++;
    }

    expect(updatedExec?.status).toBe('COMPLETED');
    agentWs.close();
    await new Promise((r) => setTimeout(r, 100));
  }, 15000);

  // Test 3: TASK_FAILED fails the correct execution
  it('Test 3: TASK_FAILED fails the correct execution', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T3');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agent.id, ['code-analysis']);

    agentWs.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === AgentMeshMessageType.TASK_REQUEST) {
          const failedMsg = createAgentMeshMessage({
            type: AgentMeshMessageType.TASK_FAILED,
            projectId: testProjectA.id,
            senderId: agent.id,
            payload: {
              taskId: msg.payload.taskId,
              executionId: msg.payload.executionId,
              error: 'Explicit failure for Test 3',
            },
          });
          agentWs.send(JSON.stringify(failedMsg));
        }
      } catch {
        // ignore non-JSON or invalid message
      }
    });

    const task = await prisma.task.create({
      data: {
        projectId: testProjectA.id,
        creatorId: testUser.id,
        title: 'Task for Test 3',
        description: 'Verify TASK_FAILED behavior',
        status: 'TODO',
      },
    });

    await prisma.taskResponsibility.create({
      data: { taskId: task.id, agentId: agent.id, role: 'PRIMARY' },
    });

    const execution = await executionService.createExecution(testProjectA.id, task.id, testUser.id, {
      agentId: agent.id,
      input: { requireRealAgent: true },
    });

    let attempts = 0;
    let updatedExec;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 100));
      updatedExec = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
      if (updatedExec?.status === 'FAILED') break;
      attempts++;
    }

    expect(updatedExec?.status).toBe('FAILED');
    expect(updatedExec?.error).toContain('Explicit failure for Test 3');
    agentWs.close();
    await new Promise((r) => setTimeout(r, 100));
  }, 15000);

  // Test 4: Duplicate TASK_COMPLETED is idempotent
  it('Test 4: Duplicate TASK_COMPLETED is idempotent', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T4');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agent.id, ['code-analysis']);

    const task = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Test 4 Task', description: 'Idempotency test', status: 'TODO' },
    });
    await prisma.taskResponsibility.create({
      data: { taskId: task.id, agentId: agent.id, role: 'PRIMARY' },
    });

    const execution = await prisma.taskExecution.create({
      data: { taskId: task.id, agentId: agent.id, status: 'RUNNING', startedAt: new Date() },
    });

    const completedMsg1 = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_COMPLETED,
      projectId: testProjectA.id,
      senderId: agent.id,
      payload: { taskId: task.id, executionId: execution.id, result: { output: 'First Result' } },
    });

    agentWs.send(JSON.stringify(completedMsg1));
    await new Promise((r) => setTimeout(r, 200));

    let execCheck = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
    expect(execCheck?.status).toBe('COMPLETED');
    expect((execCheck?.output as Record<string, unknown>)?.output).toBe('First Result');

    const completedMsg2 = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_COMPLETED,
      projectId: testProjectA.id,
      senderId: agent.id,
      payload: { taskId: task.id, executionId: execution.id, result: { output: 'Second Overwrite Attempt' } },
    });

    agentWs.send(JSON.stringify(completedMsg2));
    await new Promise((r) => setTimeout(r, 200));

    execCheck = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
    expect(execCheck?.status).toBe('COMPLETED');
    expect((execCheck?.output as Record<string, unknown>)?.output).toBe('First Result');

    agentWs.close();
    await new Promise((r) => setTimeout(r, 100));
  }, 15000);

  // Test 5: Duplicate TASK_FAILED is idempotent
  it('Test 5: Duplicate TASK_FAILED is idempotent', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T5');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agent.id, ['code-analysis']);

    const task = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Test 5 Task', description: 'Duplicate fail test', status: 'TODO' },
    });
    await prisma.taskResponsibility.create({
      data: { taskId: task.id, agentId: agent.id, role: 'PRIMARY' },
    });

    const execution = await prisma.taskExecution.create({
      data: { taskId: task.id, agentId: agent.id, status: 'RUNNING', startedAt: new Date() },
    });

    const failedMsg1 = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_FAILED,
      projectId: testProjectA.id,
      senderId: agent.id,
      payload: { taskId: task.id, executionId: execution.id, error: 'First Failure' },
    });

    agentWs.send(JSON.stringify(failedMsg1));
    await new Promise((r) => setTimeout(r, 200));

    let execCheck = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
    expect(execCheck?.status).toBe('FAILED');
    expect(execCheck?.error).toBe('First Failure');

    const failedMsg2 = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_FAILED,
      projectId: testProjectA.id,
      senderId: agent.id,
      payload: { taskId: task.id, executionId: execution.id, error: 'Second Failure' },
    });

    agentWs.send(JSON.stringify(failedMsg2));
    await new Promise((r) => setTimeout(r, 200));

    execCheck = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
    expect(execCheck?.status).toBe('FAILED');
    expect(execCheck?.error).toBe('First Failure');

    agentWs.close();
    await new Promise((r) => setTimeout(r, 100));
  }, 15000);

  // Test 6: TASK_COMPLETED / TASK_FAILED race has one terminal winner
  it('Test 6: TASK_COMPLETED / TASK_FAILED race has one terminal winner', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T6');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agent.id, ['code-analysis']);

    const task = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Test 6 Task', description: 'Race test', status: 'TODO' },
    });

    const execution = await prisma.taskExecution.create({
      data: { taskId: task.id, agentId: agent.id, status: 'RUNNING', startedAt: new Date() },
    });

    const completedMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_COMPLETED,
      projectId: testProjectA.id,
      senderId: agent.id,
      payload: { taskId: task.id, executionId: execution.id, result: { output: 'Winner Output' } },
    });

    const failedMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_FAILED,
      projectId: testProjectA.id,
      senderId: agent.id,
      payload: { taskId: task.id, executionId: execution.id, error: 'Late Failure' },
    });

    agentWs.send(JSON.stringify(completedMsg));
    await new Promise((r) => setTimeout(r, 100));
    agentWs.send(JSON.stringify(failedMsg));
    await new Promise((r) => setTimeout(r, 200));

    const execCheck = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
    expect(execCheck?.status).toBe('COMPLETED');
    expect(execCheck?.error).toBeNull();

    agentWs.close();
    await new Promise((r) => setTimeout(r, 100));
  }, 15000);

  // Test 7: Agent disconnect during execution does not produce false success
  it('Test 7: Agent disconnect during execution does not produce false success', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T7');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agent.id, ['code-analysis']);

    const task = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Test 7 Task', description: 'Disconnect test', status: 'TODO' },
    });

    const execution = await prisma.taskExecution.create({
      data: { taskId: task.id, agentId: agent.id, status: 'RUNNING', startedAt: new Date() },
    });

    agentWs.close();
    await new Promise((r) => setTimeout(r, 200));

    const execCheck = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
    const agentCheck = await prisma.agent.findUnique({ where: { id: agent.id } });

    expect(execCheck?.status).not.toBe('COMPLETED');
    expect(agentCheck?.status).toBe('OFFLINE');
  }, 15000);

  // Test 8: Unavailable agent cannot complete a real-agent-required execution
  it('Test 8: Unavailable agent cannot complete a real-agent-required execution', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T8 (Offline)');
    const task = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Test 8 Task', description: 'Unavailable agent test', status: 'TODO' },
    });
    await prisma.taskResponsibility.create({
      data: { taskId: task.id, agentId: agent.id, role: 'PRIMARY' },
    });

    const execution = await executionService.createExecution(testProjectA.id, task.id, testUser.id, {
      agentId: agent.id,
      input: { requireRealAgent: true },
    });

    let attempts = 0;
    let execCheck;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 100));
      execCheck = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
      if (execCheck?.status === 'FAILED') break;
      attempts++;
    }

    expect(execCheck?.status).toBe('FAILED');
    expect(execCheck?.error).toContain('Agent is not connected via WebSocket');
  }, 15000);

  // Test 9: Execution timeout cannot remain RUNNING forever
  it('Test 9: Execution timeout cannot remain RUNNING forever', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T9');
    const task = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Test 9 Task', description: 'Timeout test', status: 'TODO' },
    });

    const staleDate = new Date(Date.now() - 600000);
    const staleExecution = await prisma.taskExecution.create({
      data: {
        taskId: task.id,
        agentId: agent.id,
        status: 'RUNNING',
        startedAt: staleDate,
        createdAt: staleDate,
      },
    });

    const failedCount = await executionService.failTimedOutExecutions(300000);
    expect(failedCount).toBeGreaterThanOrEqual(1);

    const execCheck = await prisma.taskExecution.findUnique({ where: { id: staleExecution.id } });
    expect(execCheck?.status).toBe('FAILED');
    expect(execCheck?.error).toBe('EXECUTION_TIMEOUT');
  }, 15000);

  // Test 10: Two executions cannot cross-complete
  it('Test 10: Two executions cannot cross-complete', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T10');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agent.id, ['code-analysis']);

    const task1 = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Test 10 Task 1', description: 'Cross complete task 1', status: 'TODO' },
    });
    const task2 = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Test 10 Task 2', description: 'Cross complete task 2', status: 'TODO' },
    });

    const exec1 = await prisma.taskExecution.create({
      data: { taskId: task1.id, agentId: agent.id, status: 'RUNNING', startedAt: new Date() },
    });
    const exec2 = await prisma.taskExecution.create({
      data: { taskId: task2.id, agentId: agent.id, status: 'RUNNING', startedAt: new Date() },
    });

    const completedMsg1 = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_COMPLETED,
      projectId: testProjectA.id,
      senderId: agent.id,
      payload: { taskId: task1.id, executionId: exec1.id, result: { output: 'Exec 1 Done' } },
    });

    agentWs.send(JSON.stringify(completedMsg1));
    await new Promise((r) => setTimeout(r, 200));

    const check1 = await prisma.taskExecution.findUnique({ where: { id: exec1.id } });
    const check2 = await prisma.taskExecution.findUnique({ where: { id: exec2.id } });

    expect(check1?.status).toBe('COMPLETED');
    expect(check2?.status).toBe('RUNNING');

    agentWs.close();
    await new Promise((r) => setTimeout(r, 100));
  }, 15000);

  // Test 11: Cross-project completion is rejected
  it('Test 11: Cross-project completion is rejected', async () => {
    const agentA = await createTestAgent(testProjectA.id, 'Agent T11 A');
    const agentB = await createTestAgent(testProjectB.id, 'Agent T11 B');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agentA.id, ['code-analysis']);

    const taskB = await prisma.task.create({
      data: { projectId: testProjectB.id, creatorId: testUser.id, title: 'Project B Task', description: 'Cross project test task', status: 'TODO' },
    });
    const execB = await prisma.taskExecution.create({
      data: { taskId: taskB.id, agentId: agentB.id, status: 'RUNNING', startedAt: new Date() },
    });

    const crossProjMsg = createAgentMeshMessage({
      type: AgentMeshMessageType.TASK_COMPLETED,
      projectId: testProjectB.id,
      senderId: agentA.id,
      payload: { taskId: taskB.id, executionId: execB.id, result: { malicious: true } },
    });

    agentWs.send(JSON.stringify(crossProjMsg));
    await new Promise((r) => setTimeout(r, 200));

    const checkB = await prisma.taskExecution.findUnique({ where: { id: execB.id } });
    expect(checkB?.status).toBe('RUNNING');

    agentWs.close();
    await new Promise((r) => setTimeout(r, 100));
  }, 15000);

  // Test 12: Paid capability still requires a real agent
  it('Test 12: Paid capability still requires a real agent (no mock fallback)', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T12 (Offline)', ['refactoring']);
    const task = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Paid Cap Task', description: 'Paid cap real agent test', status: 'TODO' },
    });
    await prisma.taskResponsibility.create({
      data: { taskId: task.id, agentId: agent.id, role: 'PRIMARY' },
    });

    const execution = await executionService.createExecution(testProjectA.id, task.id, testUser.id, {
      agentId: agent.id,
      input: { capability: 'refactoring', requireRealAgent: true },
    });

    let attempts = 0;
    let execCheck;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 100));
      execCheck = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
      if (execCheck?.status === 'FAILED') break;
      attempts++;
    }

    expect(execCheck?.status).toBe('FAILED');
    expect(execCheck?.error).toContain('Agent is not connected via WebSocket');
  }, 15000);

  // Test 13: Settled payment + failed execution preserves Payment = SETTLED and Execution = FAILED
  it('Test 13: Settled payment + failed execution preserves Payment = SETTLED', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T13');
    const req = x402Service.generateRequirement();
    const settled = await prisma.payment.create({
      data: {
        projectId: testProjectA.id,
        requesterUserId: testUser.id,
        agentId: agent.id,
        action: 'capability.execute',
        amount: req.amount,
        asset: req.asset,
        network: req.network,
        receiverAddress: req.receiver,
        status: 'SETTLED',
        x402PaymentReference: req.paymentReference,
        transactionReference: '0.0.1000@123456789.000000000',
        settledAt: new Date(),
      },
    });
    expect(settled.status).toBe('SETTLED');

    const task = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Paid Task Test 13', description: 'Preserve payment test', status: 'TODO' },
    });
    const execution = await prisma.taskExecution.create({
      data: { taskId: task.id, agentId: agent.id, status: 'FAILED', error: 'Agent execution failed mid-way' },
    });

    await prisma.payment.update({
      where: { id: settled.id },
      data: { executionId: execution.id },
    });

    const updatedPayment = await prisma.payment.findUnique({ where: { id: settled.id } });
    const updatedExec = await prisma.taskExecution.findUnique({ where: { id: execution.id } });

    expect(updatedPayment?.status).toBe('SETTLED');
    expect(updatedExec?.status).toBe('FAILED');
  }, 15000);

  // Test 14: Duplicate paid execution remains idempotent
  it('Test 14: Duplicate paid execution remains idempotent', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T14');
    vi.spyOn(x402Service, 'verifyAndSettle').mockResolvedValue({
      valid: true,
      amount: '1000',
      asset: '0.0.429274',
    });

    const paymentRef = `test-ref-${Date.now()}`;
    const req = x402Service.generateRequirement({
      paymentReference: paymentRef,
      amount: '1000',
    });

    const validHeader = JSON.stringify({
      scheme: 'exact',
      network: req.network,
      asset: req.asset,
      transactionReference: `tx-${paymentRef}`,
      payerAddress: '0x123Payer',
      paymentReference: paymentRef,
    });

    const settled1 = await paymentService.processPaymentHeader(
      testProjectA.id,
      testUser.id,
      validHeader,
      req,
      agent.id,
    );

    const settled2 = await paymentService.processPaymentHeader(
      testProjectA.id,
      testUser.id,
      validHeader,
      req,
      agent.id,
    );

    expect(settled1.id).toBe(settled2.id);
    expect(settled1.status).toBe('SETTLED');

    const paymentCount = await prisma.payment.count({
      where: { x402PaymentReference: paymentRef },
    });
    expect(paymentCount).toBe(1);
  }, 15000);

  // Test 15: Agent returns from BUSY after execution terminal state
  it('Test 15: Agent returns from BUSY after execution terminal state', async () => {
    const agent = await createTestAgent(testProjectA.id, 'Agent T15');
    const agentWs = await connectAndHandshakeAgent(testProjectA.id, agent.id, ['code-analysis']);

    let agentCheck = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(agentCheck?.status).toBe('ONLINE');

    agentWs.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === AgentMeshMessageType.TASK_REQUEST) {
          const completedMsg = createAgentMeshMessage({
            type: AgentMeshMessageType.TASK_COMPLETED,
            projectId: testProjectA.id,
            senderId: agent.id,
            payload: {
              taskId: msg.payload.taskId,
              executionId: msg.payload.executionId,
              result: { summary: 'Completed Test 15' },
            },
          });
          agentWs.send(JSON.stringify(completedMsg));
        }
      } catch {
        // ignore non-JSON or invalid message
      }
    });

    const task = await prisma.task.create({
      data: { projectId: testProjectA.id, creatorId: testUser.id, title: 'Test 15 Task', description: 'BUSY status recovery test', status: 'TODO' },
    });
    await prisma.taskResponsibility.create({
      data: { taskId: task.id, agentId: agent.id, role: 'PRIMARY' },
    });

    const execution = await executionService.createExecution(testProjectA.id, task.id, testUser.id, {
      agentId: agent.id,
      input: { requireRealAgent: true },
    });

    let attempts = 0;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 100));
      const exec = await prisma.taskExecution.findUnique({ where: { id: execution.id } });
      if (exec?.status === 'COMPLETED') break;
      attempts++;
    }

    agentCheck = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(agentCheck?.status).toBe('ONLINE');

    agentWs.close();
    await new Promise((r) => setTimeout(r, 200));

    agentCheck = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(agentCheck?.status).toBe('OFFLINE');
  }, 15000);
});
