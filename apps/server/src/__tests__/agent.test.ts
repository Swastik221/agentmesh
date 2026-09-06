import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

describe('PRD #4 Agent Registry API Integration Tests', () => {
  const app = createApp();

  const userAWallet = '0xAGENT1111111111111111111111111111111111';
  const userBWallet = '0xAGENT2222222222222222222222222222222222';
  const userCWallet = '0xAGENT3333333333333333333333333333333333';

  let userAId: string;
  let userBId: string;
  let userCId: string;
  let projectAId: string;
  let projectBId: string;

  let createdAgentId: string;

  beforeAll(async () => {
    // Clean up any test users if already existing
    const users = await prisma.user.findMany({
      where: { walletAddress: { in: [userAWallet, userBWallet, userCWallet] } },
    });
    for (const u of users) {
      const userProjects = await prisma.project.findMany({ where: { ownerId: u.id } });
      for (const p of userProjects) {
        await prisma.project.delete({ where: { id: p.id } });
      }
      await prisma.user.delete({ where: { id: u.id } });
    }

    // Create User A (Owner of Project A)
    const userARes = await request(app).post('/users').send({
      walletAddress: userAWallet,
      displayName: 'Alice Agent Owner',
    });
    userAId = userARes.body.id;

    // Create User B (Member of Project A, Owner of Project B)
    const userBRes = await request(app).post('/users').send({
      walletAddress: userBWallet,
      displayName: 'Bob Agent Member',
    });
    userBId = userBRes.body.id;

    // Create User C (Not a member of Project A)
    const userCRes = await request(app).post('/users').send({
      walletAddress: userCWallet,
      displayName: 'Charlie Outsider',
    });
    userCId = userCRes.body.id;

    // Create Project A (owned by User A)
    const projectARes = await request(app).post('/projects').send({
      name: 'Project Alpha',
      description: 'Alpha test project',
      ownerId: userAId,
    });
    projectAId = projectARes.body.id;

    // Add User B as member of Project A
    await request(app).post(`/projects/${projectAId}/members`).send({
      userId: userBId,
      role: 'MEMBER',
    });

    // Create Project B (owned by User B)
    const projectBRes = await request(app).post('/projects').send({
      name: 'Project Beta',
      description: 'Beta test project',
      ownerId: userBId,
    });
    projectBId = projectBRes.body.id;
  });

  afterAll(async () => {
    // Clean up created projects & users
    const userIds = [userAId, userBId, userCId].filter(Boolean);
    for (const uid of userIds) {
      const userProjects = await prisma.project.findMany({ where: { ownerId: uid } });
      for (const p of userProjects) {
        await prisma.project.delete({ where: { id: p.id } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('Agent Registration (POST /projects/:projectId/agents)', () => {
    it('should create an agent successfully and default to OFFLINE', async () => {
      const res = await request(app).post(`/projects/${projectAId}/agents`).send({
        ownerId: userAId,
        name: 'Claude Dev',
        provider: 'claude',
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.projectId).toBe(projectAId);
      expect(res.body.ownerId).toBe(userAId);
      expect(res.body.name).toBe('Claude Dev');
      expect(res.body.provider).toBe('claude');
      expect(res.body.status).toBe('OFFLINE');

      createdAgentId = res.body.id;
    });

    it('should create an agent when owner is a project member', async () => {
      const res = await request(app).post(`/projects/${projectAId}/agents`).send({
        ownerId: userBId,
        name: 'Codex Helper',
        provider: 'openai',
      });

      expect(res.status).toBe(201);
      expect(res.body.ownerId).toBe(userBId);
      expect(res.body.status).toBe('OFFLINE');
    });

    it('should return 404 when registering against nonexistent project', async () => {
      const res = await request(app).post('/projects/nonexistent-project-id/agents').send({
        ownerId: userAId,
        name: 'Ghost Agent',
        provider: 'claude',
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('should return 404 when owner user does not exist', async () => {
      const res = await request(app).post(`/projects/${projectAId}/agents`).send({
        ownerId: 'nonexistent-user-id',
        name: 'Orphan Agent',
        provider: 'claude',
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('should return 403 when owner is not a project member', async () => {
      const res = await request(app).post(`/projects/${projectAId}/agents`).send({
        ownerId: userCId,
        name: 'Intruder Agent',
        provider: 'claude',
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('should return 400 for invalid payload (missing name)', async () => {
      const res = await request(app).post(`/projects/${projectAId}/agents`).send({
        ownerId: userAId,
        provider: 'claude',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid payload (empty provider)', async () => {
      const res = await request(app).post(`/projects/${projectAId}/agents`).send({
        ownerId: userAId,
        name: 'No Provider Agent',
        provider: '',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('Agent Retrieval (GET /projects/:projectId/agents & GET /agents/:agentId)', () => {
    it('GET /projects/:projectId/agents -> list project agents', async () => {
      const res = await request(app).get(`/projects/${projectAId}/agents`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      const ids = res.body.map((a: { id: string }) => a.id);
      expect(ids).toContain(createdAgentId);
    });

    it('GET /projects/:projectId/agents -> return 404 for nonexistent project', async () => {
      const res = await request(app).get('/projects/nonexistent-project-id/agents');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('GET /agents/:agentId -> return individual agent details', async () => {
      const res = await request(app).get(`/agents/${createdAgentId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdAgentId);
      expect(res.body.name).toBe('Claude Dev');
      expect(res.body.provider).toBe('claude');
      expect(res.body.status).toBe('OFFLINE');
    });

    it('GET /agents/:agentId -> return 404 for nonexistent agent', async () => {
      const res = await request(app).get('/agents/nonexistent-agent-id');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });
  });

  describe('Agent Update (PATCH /agents/:agentId)', () => {
    it('should update name', async () => {
      const res = await request(app).patch(`/agents/${createdAgentId}`).send({
        name: 'Claude Backend',
      });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Claude Backend');
      expect(res.body.provider).toBe('claude');
    });

    it('should update provider', async () => {
      const res = await request(app).patch(`/agents/${createdAgentId}`).send({
        provider: 'anthropic-claude',
      });

      expect(res.status).toBe(200);
      expect(res.body.provider).toBe('anthropic-claude');
    });

    it('should update status to ONLINE and BUSY', async () => {
      const onlineRes = await request(app).patch(`/agents/${createdAgentId}`).send({
        status: 'ONLINE',
      });
      expect(onlineRes.status).toBe(200);
      expect(onlineRes.body.status).toBe('ONLINE');

      const busyRes = await request(app).patch(`/agents/${createdAgentId}`).send({
        status: 'BUSY',
      });
      expect(busyRes.status).toBe(200);
      expect(busyRes.body.status).toBe('BUSY');
    });

    it('should return 400 for invalid status', async () => {
      const res = await request(app).patch(`/agents/${createdAgentId}`).send({
        status: 'SUPER_ACTIVE',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for empty update body', async () => {
      const res = await request(app).patch(`/agents/${createdAgentId}`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for nonexistent agent', async () => {
      const res = await request(app).patch('/agents/nonexistent-agent-id').send({
        name: 'Ghost',
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });
  });

  describe('Cross-Project Isolation', () => {
    let agentBetaId: string;

    beforeAll(async () => {
      const res = await request(app).post(`/projects/${projectBId}/agents`).send({
        ownerId: userBId,
        name: 'Beta Worker',
        provider: 'gemini',
      });
      agentBetaId = res.body.id;
    });

    it('Project A agents list should not contain Project B agents', async () => {
      const resA = await request(app).get(`/projects/${projectAId}/agents`);
      expect(resA.status).toBe(200);
      const idsA = resA.body.map((a: { id: string }) => a.id);
      expect(idsA).not.toContain(agentBetaId);

      const resB = await request(app).get(`/projects/${projectBId}/agents`);
      expect(resB.status).toBe(200);
      const idsB = resB.body.map((a: { id: string }) => a.id);
      expect(idsB).toContain(agentBetaId);
      expect(idsB).not.toContain(createdAgentId);
    });
  });

  describe('Agent Deletion (DELETE /agents/:agentId)', () => {
    it('should delete agent successfully and return 204', async () => {
      const res = await request(app).delete(`/agents/${createdAgentId}`);

      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      // Verify it is gone
      const getRes = await request(app).get(`/agents/${createdAgentId}`);
      expect(getRes.status).toBe(404);
    });

    it('should return 404 when deleting nonexistent agent', async () => {
      const res = await request(app).delete('/agents/nonexistent-agent-id');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });
  });
});
