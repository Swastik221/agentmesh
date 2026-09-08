import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';

const app = createApp();

describe('PRD-15 Artifact Service & APIs', () => {
  let ownerToken: string;
  let ownerUserId: string;
  let projectId: string;
  let agentId: string;
  let taskId: string;

  let otherToken: string;

  beforeEach(async () => {
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

    const owner = await prisma.user.create({
      data: {
        walletAddress: '0x1111111111111111111111111111111111111111',
        displayName: 'Owner User',
      },
    });
    ownerUserId = owner.id;
    const session1 = await sessionService.createSession(owner.id);
    ownerToken = session1.id;

    const project = await prisma.project.create({
      data: {
        name: 'Project Alpha',
        ownerId: owner.id,
        members: {
          create: {
            userId: owner.id,
            role: 'OWNER',
          },
        },
      },
    });
    projectId = project.id;

    const agent = await prisma.agent.create({
      data: {
        projectId,
        ownerId: owner.id,
        name: 'Producer Agent',
        provider: 'custom',
        status: 'ONLINE',
      },
    });
    agentId = agent.id;

    const task = await prisma.task.create({
      data: {
        projectId,
        creatorId: owner.id,
        title: 'Task Alpha',
        description: 'First task',
      },
    });
    taskId = task.id;

    // Create secondary user & project for cross-project isolation tests
    const otherUser = await prisma.user.create({
      data: {
        walletAddress: '0x2222222222222222222222222222222222222222',
        displayName: 'Other User',
      },
    });
    const session2 = await sessionService.createSession(otherUser.id);
    otherToken = session2.id;

    await prisma.project.create({
      data: {
        name: 'Project Beta',
        ownerId: otherUser.id,
        members: {
          create: {
            userId: otherUser.id,
            role: 'OWNER',
          },
        },
      },
    });
  });

  it('1. Authorized user creates artifact with version 1', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskId}/artifacts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'API_CONTRACT',
        name: 'Authentication API Contract',
        agentId,
        payload: {
          endpoints: [
            { method: 'POST', path: '/api/auth/login' },
          ],
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Authentication API Contract');
    expect(res.body.version).toBe(1);
    expect(res.body.projectId).toBe(projectId);
    expect(res.body.taskId).toBe(taskId);
    expect(res.body.agentId).toBe(agentId);
    expect(res.body.ownerUserId).toBe(ownerUserId);
  });

  it('2. Publishing an updated artifact creates version 2 without mutating version 1', async () => {
    // Create version 1
    const res1 = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskId}/artifacts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'API_CONTRACT',
        name: 'Auth Spec',
        agentId,
        payload: { version: 1 },
      });
    expect(res1.status).toBe(201);
    expect(res1.body.version).toBe(1);

    // Create version 2 with same name
    const res2 = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskId}/artifacts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'API_CONTRACT',
        name: 'Auth Spec',
        agentId,
        payload: { version: 2 },
      });
    expect(res2.status).toBe(201);
    expect(res2.body.version).toBe(2);

    // Both versions exist in database
    const artifacts = await prisma.artifact.findMany({
      where: { taskId, name: 'Auth Spec' },
      orderBy: { version: 'asc' },
    });
    expect(artifacts.length).toBe(2);
    expect(artifacts[0].version).toBe(1);
    expect(artifacts[1].version).toBe(2);
  });

  it('3. Payload exceeding maxArtifactPayloadBytes is rejected with 400', async () => {
    const largePayload = {
      data: 'x'.repeat(600000), // ~600KB exceeds 512KB limit
    };

    const res = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskId}/artifacts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        type: 'LARGE_DATA',
        name: 'Big Artifact',
        agentId,
        payload: largePayload,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds limit/i);
  });

  it('4. Cross-project user cannot access or create artifacts in another project', async () => {
    // Other user attempts to create artifact in Project Alpha
    const resCreate = await request(app)
      .post(`/api/projects/${projectId}/tasks/${taskId}/artifacts`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        type: 'SCHEMA',
        name: 'Forbidden Schema',
        agentId,
        payload: {},
      });
    expect(resCreate.status).toBe(403);

    // Create legitimate artifact in Project Alpha
    const artifact = await prisma.artifact.create({
      data: {
        projectId,
        taskId,
        agentId,
        ownerUserId,
        type: 'SCHEMA',
        name: 'Public Schema',
        version: 1,
        payload: {},
      },
    });

    // Other user attempts to get artifact in Project Alpha
    const resGet = await request(app)
      .get(`/api/projects/${projectId}/artifacts/${artifact.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(resGet.status).toBe(403);
  });

  it('5. Paginated listing of artifacts works', async () => {
    for (let i = 1; i <= 3; i++) {
      await prisma.artifact.create({
        data: {
          projectId,
          taskId,
          agentId,
          ownerUserId,
          type: 'DOCUMENT',
          name: `Doc ${i}`,
          version: 1,
          payload: { doc: i },
        },
      });
    }

    const res = await request(app)
      .get(`/api/projects/${projectId}/tasks/${taskId}/artifacts?page=1&limit=2`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(1);
  });
});
