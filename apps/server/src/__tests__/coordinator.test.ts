/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, Server as HTTPServer } from 'node:http';
import WebSocket from 'ws';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { connectionManager } from '../websocket/connection.manager.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/websocket.server.js';
import { coordinatorService } from '../services/coordinator.service.js';
import request from 'supertest';
import { createApp } from '../app.js';

describe('PRD-14 Coordinator & Intelligent Task Assignment Tests', () => {
  let server: HTTPServer;
  let wss: AgentMeshWebSocketServer;
  let serverPort: number;
  let app: ReturnType<typeof createApp>;

  let userA: any;
  let userB: any;
  let sessionA: any;
  let sessionB: any;
  let projectA: any;
  let projectB: any;
  let agentA1: any;
  let agentA2: any;
  let agentB1: any;

  beforeAll(async () => {
    app = createApp();
    server = createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port;
        }
        resolve();
      });
    });

    wss = setupWebSocketServer(server);

    userA = await prisma.user.create({
      data: {
        walletAddress: `0xcoordA${Date.now()}`,
        displayName: 'Coordinator Developer A',
      },
    });

    userB = await prisma.user.create({
      data: {
        walletAddress: `0xcoordB${Date.now()}`,
        displayName: 'Coordinator Developer B',
      },
    });

    sessionA = await sessionService.createSession(userA.id);
    sessionB = await sessionService.createSession(userB.id);

    projectA = await prisma.project.create({
      data: {
        name: 'Project Alpha (Coordinator)',
        ownerId: userA.id,
      },
    });

    projectB = await prisma.project.create({
      data: {
        name: 'Project Beta (Coordinator)',
        ownerId: userB.id,
      },
    });

    await prisma.projectMember.createMany({
      data: [
        {
          projectId: projectA.id,
          userId: userA.id,
          role: 'OWNER',
        },
        {
          projectId: projectA.id,
          userId: userB.id,
          role: 'MEMBER',
        },
        {
          projectId: projectB.id,
          userId: userB.id,
          role: 'OWNER',
        },
      ],
    });

    agentA1 = await prisma.agent.create({
      data: {
        projectId: projectA.id,
        ownerId: userA.id,
        name: 'Agent A1 (TS/React)',
        provider: 'anthropic',
        status: 'ONLINE',
        capabilities: {
          create: [
            { capability: 'language:typescript' },
            { capability: 'framework:react' },
            { capability: 'tool:vite' },
          ],
        },
      },
      include: { capabilities: true },
    });

    agentA2 = await prisma.agent.create({
      data: {
        projectId: projectA.id,
        ownerId: userA.id,
        name: 'Agent A2 (Python/FastAPI)',
        provider: 'openai',
        status: 'ONLINE',
        capabilities: {
          create: [
            { capability: 'language:python' },
            { capability: 'framework:fastapi' },
          ],
        },
      },
      include: { capabilities: true },
    });

    agentB1 = await prisma.agent.create({
      data: {
        projectId: projectB.id,
        ownerId: userB.id,
        name: 'Agent B1 (Beta)',
        provider: 'google',
        status: 'ONLINE',
      },
    });
  });

  afterAll(async () => {
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await prisma.taskResponsibility.deleteMany({
      where: { task: { projectId: { in: [projectA.id, projectB.id] } } },
    });
    await prisma.taskExecution.deleteMany({
      where: { task: { projectId: { in: [projectA.id, projectB.id] } } },
    });
    await prisma.task.deleteMany({
      where: { projectId: { in: [projectA.id, projectB.id] } },
    });
    await prisma.agentCapability.deleteMany({
      where: { agentId: { in: [agentA1.id, agentA2.id, agentB1.id] } },
    });
    await prisma.agent.deleteMany({
      where: { id: { in: [agentA1.id, agentA2.id, agentB1.id] } },
    });
    await prisma.projectMember.deleteMany({
      where: { projectId: { in: [projectA.id, projectB.id] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [projectA.id, projectB.id] } },
    });
    await prisma.authSession.deleteMany({
      where: { id: { in: [sessionA.id, sessionB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
  });

  beforeEach(() => {
    connectionManager.clear();
  });

  it('1. Capability matching assigns task to highest matching agent', async () => {
    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Build React UI Component',
        description: 'Need TypeScript and React capabilities',
        requiredCapabilities: ['language:typescript', 'framework:react'],
      },
    });

    const result = await coordinatorService.assignTask(projectA.id, task.id, userA.id);

    expect(result.assigned).toBe(true);
    if (result.assigned) {
      expect(result.agentId).toBe(agentA1.id);
      expect(result.source).toBe('CAPABILITY_MATCH');
      expect(result.score).toBeGreaterThan(0);
      expect(result.explanation?.matchedCapabilities).toContain('language:typescript');
    }
  });

  it('2. Explicit human preference overrides higher-scoring capability agent', async () => {
    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Python API route',
        description: 'Prefers Agent A1 despite Agent A2 matching Python',
        preferredAgentId: agentA1.id,
        requiredCapabilities: ['language:python'],
      },
    });

    const result = await coordinatorService.assignTask(projectA.id, task.id, userA.id);

    expect(result.assigned).toBe(true);
    if (result.assigned) {
      expect(result.agentId).toBe(agentA1.id);
      expect(result.source).toBe('HUMAN_PREFERENCE');
    }
  });

  it('3. Preferred agent offline returns PREFERRED_AGENT_UNAVAILABLE without silent fallback', async () => {
    const offlineAgent = await prisma.agent.create({
      data: {
        projectId: projectA.id,
        ownerId: userA.id,
        name: 'Offline Agent',
        provider: 'anthropic',
        status: 'OFFLINE',
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Task for offline agent',
        description: 'Explicit preference for offline agent',
        preferredAgentId: offlineAgent.id,
      },
    });

    const result = await coordinatorService.assignTask(projectA.id, task.id, userA.id);

    expect(result.assigned).toBe(false);
    if (!result.assigned) {
      expect(result.reason).toBe('PREFERRED_AGENT_UNAVAILABLE');
    }

    await prisma.agent.delete({ where: { id: offlineAgent.id } });
  });

  it('4. Preferred agent from another project returns PREFERRED_AGENT_UNAUTHORIZED', async () => {
    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Cross project preference task',
        description: 'Prefers agent from Project B',
        preferredAgentId: agentB1.id,
      },
    });

    const result = await coordinatorService.assignTask(projectA.id, task.id, userA.id);

    expect(result.assigned).toBe(false);
    if (!result.assigned) {
      expect(result.reason).toBe('PREFERRED_AGENT_UNAUTHORIZED');
    }
  });

  it('5. No eligible agents available returns NO_ELIGIBLE_AGENT', async () => {
    const emptyProject = await prisma.project.create({
      data: {
        name: 'Empty Project',
        ownerId: userA.id,
      },
    });

    await prisma.projectMember.create({
      data: {
        projectId: emptyProject.id,
        userId: userA.id,
        role: 'OWNER',
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: emptyProject.id,
        creatorId: userA.id,
        title: 'No agent task',
        description: 'Project has no agents',
      },
    });

    const result = await coordinatorService.assignTask(emptyProject.id, task.id, userA.id);

    expect(result.assigned).toBe(false);
    if (!result.assigned) {
      expect(result.reason).toBe('NO_ELIGIBLE_AGENT');
    }

    await prisma.task.delete({ where: { id: task.id } });
    await prisma.projectMember.deleteMany({ where: { projectId: emptyProject.id } });
    await prisma.project.delete({ where: { id: emptyProject.id } });
  });

  it('6. Already assigned task returns TASK_ALREADY_ASSIGNED', async () => {
    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Re-assign task',
        description: 'Will be assigned twice',
      },
    });

    const firstResult = await coordinatorService.assignTask(projectA.id, task.id, userA.id);
    expect(firstResult.assigned).toBe(true);

    const secondResult = await coordinatorService.assignTask(projectA.id, task.id, userA.id);
    expect(secondResult.assigned).toBe(false);
    if (!secondResult.assigned) {
      expect(secondResult.reason).toBe('TASK_ALREADY_ASSIGNED');
    }
  });

  it('7. Determinism: 100 consecutive assignments under identical state produce exact same agent choice', async () => {
    const choices: string[] = [];

    for (let i = 0; i < 100; i++) {
      const task = await prisma.task.create({
        data: {
          projectId: projectA.id,
          creatorId: userA.id,
          title: `Determinism test task ${i}`,
          description: 'Identical requirements',
          requiredCapabilities: ['language:typescript'],
        },
      });

      const res = await coordinatorService.assignTask(projectA.id, task.id, userA.id);
      if (res.assigned) {
        choices.push(res.agentId);
      }
    }

    expect(choices.length).toBe(100);
    const uniqueChoices = new Set(choices);
    expect(uniqueChoices.size).toBe(1);
    expect(choices[0]).toBe(agentA1.id);
  });

  it('8. Deterministic tie-breaking selects agent predictably when capability scores match', async () => {
    // Create a generic task where both agents match equally
    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Tie-break task',
        description: 'No requirements specified',
      },
    });

    const res = await coordinatorService.assignTask(projectA.id, task.id, userA.id);
    expect(res.assigned).toBe(true);
    if (res.assigned) {
      // Deterministic selection picks agent based on createdAt/id sorting
      expect(res.agentId).toBe(agentA1.id);
    }

    await prisma.task.delete({ where: { id: task.id } });
  });

  it('9. HTTP API POST /api/projects/:projectId/tasks/:taskId/assign works with SIWE auth', async () => {
    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'API endpoint test task',
        description: 'Test POST endpoint',
      },
    });

    const res = await request(app)
      .post(`/api/projects/${projectA.id}/tasks/${task.id}/assign`)
      .set('Cookie', [`agentmesh_session=${sessionA.id}`])
      .send({ preferredAgentId: agentA2.id });

    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(true);
    expect(res.body.agentId).toBe(agentA2.id);
    expect(res.body.source).toBe('HUMAN_PREFERENCE');
  });

  it('10. Security: Non-member assignment request rejected with 403 Forbidden', async () => {
    const nonMemberUser = await prisma.user.create({
      data: {
        walletAddress: `0xnonmember${Date.now()}`,
        displayName: 'Non Member',
      },
    });
    const nonMemberSession = await sessionService.createSession(nonMemberUser.id);

    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Security task',
        description: 'Non-member attempt',
      },
    });

    const res = await request(app)
      .post(`/api/projects/${projectA.id}/tasks/${task.id}/assign`)
      .set('Cookie', [`agentmesh_session=${nonMemberSession.id}`])
      .send({});

    expect(res.status).toBe(403);

    await prisma.authSession.delete({ where: { id: nonMemberSession.id } });
    await prisma.user.delete({ where: { id: nonMemberUser.id } });
  });

  it('11. Protocol: Successful assignment broadcasts task.assigned WebSocket event post-commit', async () => {
    const url = `ws://127.0.0.1:${serverPort}/ws?projectId=${projectA.id}&token=${sessionA.id}`;
    const ws = new WebSocket(url);

    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT) resolve();
      });
    });

    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'WebSocket broadcast task',
        description: 'Expect task.assigned event',
      },
    });

    const assignedEventPromise = new Promise<any>((resolve) => {
      ws.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === AgentMeshMessageType.TASK_ASSIGNED) {
          resolve(parsed);
        }
      });
    });

    await coordinatorService.assignTask(projectA.id, task.id, userA.id);

    const event = await assignedEventPromise;
    expect(event.type).toBe(AgentMeshMessageType.TASK_ASSIGNED);
    expect(event.projectId).toBe(projectA.id);
    expect(event.payload.taskId).toBe(task.id);
    expect(event.payload.agentId).toBeDefined();

    ws.close();
  });

  it('12. Concurrency: Two simultaneous assignment requests result in exactly one assignment', async () => {
    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Concurrent task',
        description: 'Race condition test',
      },
    });

    const [res1, res2] = await Promise.all([
      coordinatorService.assignTask(projectA.id, task.id, userA.id),
      coordinatorService.assignTask(projectA.id, task.id, userA.id),
    ]);

    const assignedCount = [res1.assigned, res2.assigned].filter(Boolean).length;
    expect(assignedCount).toBe(1);

    const responsibilities = await prisma.taskResponsibility.findMany({
      where: { taskId: task.id },
    });
    expect(responsibilities.length).toBe(1);
  });

  it('13. Corrective Audit: Category-level capability scoring and categoryScores explanation', () => {
    const agentCaps = ['language:typescript', 'framework:react', 'tool:vite', 'domain:frontend', 'tasktype:ui'];
    const reqCaps = [
      'language:typescript',
      'language:rust', // 1 of 2 matched in languages -> (1/2)*40 = 20
      'framework:react', // 1 of 1 matched in frameworks -> (1/1)*25 = 25
      'tool:vite', // 1 of 1 matched in tools -> (1/1)*15 = 15
      'domain:backend', // 0 of 1 matched in domains -> 0
      'tasktype:ui', // 1 of 1 matched in taskTypes -> (1/1)*10 = 10
    ];

    const result = coordinatorService.scoreCapabilities(agentCaps, reqCaps);

    expect(result.categoryScores.languages).toBe(20);
    expect(result.categoryScores.frameworks).toBe(25);
    expect(result.categoryScores.tools).toBe(15);
    expect(result.categoryScores.domains).toBe(0);
    expect(result.categoryScores.taskTypes).toBe(10);

    const expectedTotal = 20 + 25 + 15 + 0 + 10;
    expect(result.score).toBe(expectedTotal);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('14. Corrective Audit: Occupied agent with IN_PROGRESS task is excluded from assignment pool', async () => {
    // Create an occupied agent (Agent A1 gets an IN_PROGRESS task)
    const occupiedTask = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Occupied Task',
        description: 'Currently IN_PROGRESS',
        status: 'IN_PROGRESS',
      },
    });

    const responsibility = await prisma.taskResponsibility.create({
      data: {
        taskId: occupiedTask.id,
        agentId: agentA1.id,
      },
    });

    const newTask = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'New Task for Unoccupied Agent',
        description: 'Should go to Agent A2 since A1 is occupied',
      },
    });

    const res = await coordinatorService.assignTask(projectA.id, newTask.id, userA.id);

    expect(res.assigned).toBe(true);
    if (res.assigned) {
      expect(res.agentId).toBe(agentA2.id); // Agent A2 selected because A1 is occupied
    }

    await prisma.taskResponsibility.delete({ where: { id: responsibility.id } });
    await prisma.task.delete({ where: { id: occupiedTask.id } });
    await prisma.task.delete({ where: { id: newTask.id } });
  });

  it('15. Corrective Audit: Concurrent assignments for DIFFERENT tasks in same project succeed without lock contention', async () => {
    const task1 = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Task 1 Concurrent',
        description: 'Target task 1',
        preferredAgentId: agentA1.id,
      },
    });

    const task2 = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Task 2 Concurrent',
        description: 'Target task 2',
        preferredAgentId: agentA2.id,
      },
    });

    const [res1, res2] = await Promise.all([
      coordinatorService.assignTask(projectA.id, task1.id, userA.id),
      coordinatorService.assignTask(projectA.id, task2.id, userA.id),
    ]);

    expect(res1.assigned).toBe(true);
    expect(res2.assigned).toBe(true);
    if (res1.assigned) expect(res1.agentId).toBe(agentA1.id);
    if (res2.assigned) expect(res2.agentId).toBe(agentA2.id);

    await prisma.taskResponsibility.deleteMany({
      where: { taskId: { in: [task1.id, task2.id] } },
    });
    await prisma.task.deleteMany({
      where: { id: { in: [task1.id, task2.id] } },
    });
  });

  it('16. Final Audit: Preferred agent occupancy check returns PREFERRED_AGENT_UNAVAILABLE without fallback', async () => {
    // Make Agent A1 occupied via RUNNING execution
    const occupiedTask = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Occupied Task for A1',
        description: 'Currently executing',
      },
    });

    const execution = await prisma.taskExecution.create({
      data: {
        taskId: occupiedTask.id,
        agentId: agentA1.id,
        status: 'RUNNING',
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Task preferring occupied Agent A1',
        description: 'Explicit preferredAgentId = agentA1.id',
        preferredAgentId: agentA1.id,
      },
    });

    const res = await coordinatorService.assignTask(projectA.id, task.id, userA.id);

    expect(res.assigned).toBe(false);
    if (!res.assigned) {
      expect(res.reason).toBe('PREFERRED_AGENT_UNAVAILABLE');
    }

    // Verify no TaskResponsibility was created
    const responsibilities = await prisma.taskResponsibility.findMany({
      where: { taskId: task.id },
    });
    expect(responsibilities.length).toBe(0);

    await prisma.taskExecution.delete({ where: { id: execution.id } });
    await prisma.task.delete({ where: { id: occupiedTask.id } });
    await prisma.task.delete({ where: { id: task.id } });
  });

  it('17. Final Audit: Cross-strategy concurrency (preferred vs capability match on SAME task)', async () => {
    const task = await prisma.task.create({
      data: {
        projectId: projectA.id,
        creatorId: userA.id,
        title: 'Cross-strategy concurrent task',
        description: 'Preferred vs Capability match race',
      },
    });

    const [res1, res2] = await Promise.all([
      coordinatorService.assignTask(projectA.id, task.id, userA.id, {
        preferredAgentId: agentA1.id,
      }),
      coordinatorService.assignTask(projectA.id, task.id, userA.id),
    ]);

    const assignedCount = [res1.assigned, res2.assigned].filter(Boolean).length;
    expect(assignedCount).toBe(1);

    const responsibilities = await prisma.taskResponsibility.findMany({
      where: { taskId: task.id },
    });
    expect(responsibilities.length).toBe(1);

    await prisma.taskResponsibility.deleteMany({ where: { taskId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
  });
});
