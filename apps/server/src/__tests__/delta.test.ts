import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { deltaSequencerService } from '../services/delta-sequencer.service.js';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';

const app = createApp();

describe('PRD-16 Delta-State Broadcast & Resynchronization Tests', () => {
  let userToken: string;
  let projectId: string;
  let taskId: string;

  beforeEach(async () => {
    deltaSequencerService.clearReplayBuffer();
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
        walletAddress: '0x9999999999999999999999999999999999999999',
        displayName: 'Delta User',
      },
    });
    const session = await sessionService.createSession(user.id);
    userToken = session.id;

    const project = await prisma.project.create({
      data: {
        name: 'Delta Test Workspace',
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

    const task = await prisma.task.create({
      data: {
        projectId,
        creatorId: user.id,
        title: 'Delta Task 1',
        description: 'First task for delta testing',
      },
    });
    taskId = task.id;
  });

  afterEach(() => {
    deltaSequencerService.clearReplayBuffer();
  });

  it('1. Monotonic sequence allocation per workspace', async () => {
    const seq1 = await deltaSequencerService.allocateNextSequence(projectId);
    const seq2 = await deltaSequencerService.allocateNextSequence(projectId);
    const seq3 = await deltaSequencerService.allocateNextSequence(projectId);

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
    expect(seq3).toBe(3);

    const currentSeq = await deltaSequencerService.getCurrentSequence(projectId);
    expect(currentSeq).toBe(3);
  });

  it('2. Concurrency test: 10 simultaneous sequence allocations yield 10 unique monotonic numbers', async () => {
    const promises = Array.from({ length: 10 }, () =>
      deltaSequencerService.allocateNextSequence(projectId),
    );

    const results = await Promise.all(promises);
    results.sort((a, b) => a - b);

    expect(results).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('3. Cross-project sequence isolation: Project A sequences do not affect Project B', async () => {
    const user2 = await prisma.user.create({
      data: {
        walletAddress: '0x8888888888888888888888888888888888888888',
        displayName: 'User 2',
      },
    });

    const projectB = await prisma.project.create({
      data: {
        name: 'Project B Workspace',
        ownerId: user2.id,
      },
    });

    const seqA1 = await deltaSequencerService.allocateNextSequence(projectId);
    const seqA2 = await deltaSequencerService.allocateNextSequence(projectId);

    const seqB1 = await deltaSequencerService.allocateNextSequence(projectB.id);

    expect(seqA1).toBe(1);
    expect(seqA2).toBe(2);
    expect(seqB1).toBe(1);

    const currentA = await deltaSequencerService.getCurrentSequence(projectId);
    const currentB = await deltaSequencerService.getCurrentSequence(projectB.id);

    expect(currentA).toBe(2);
    expect(currentB).toBe(1);
  });

  it('4. Real-time delta broadcast on task creation & status change', async () => {
    // Record delta on task status update
    const deltaMsg = await deltaSequencerService.recordAndBroadcastDelta(projectId, [
      {
        entity: 'task',
        entityId: taskId,
        operation: 'updated',
        fields: { status: 'IN_PROGRESS' },
      },
    ]);

    expect(deltaMsg.type).toBe(AgentMeshMessageType.WORKSPACE_DELTA);
    expect(deltaMsg.payload.sequence).toBe(1);
    expect(deltaMsg.payload.changes[0].entity).toBe('task');
    expect(deltaMsg.payload.changes[0].fields?.status).toBe('IN_PROGRESS');
  });

  it('5. REST API task creation triggers workspace.delta event', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        title: 'New Delta Task',
        description: 'Testing task creation delta',
        priority: 'HIGH',
      });

    expect(res.status).toBe(201);
    const currentSeq = await deltaSequencerService.getCurrentSequence(projectId);
    expect(currentSeq).toBe(1);
  });
});
