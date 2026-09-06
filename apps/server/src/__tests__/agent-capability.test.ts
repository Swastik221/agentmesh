import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

describe('PRD #5 Agent Capabilities API Integration Tests', () => {
  const app = createApp();

  const userWallet = '0xCAPABILITY111111111111111111111111111111';

  let userId: string;
  let project1Id: string;
  let project2Id: string;

  let agent1Id: string; // Project 1 (Claude Backend)
  let agent2Id: string; // Project 1 (Gemini UI)
  let agent3Id: string; // Project 2 (Other Project Agent)

  beforeAll(async () => {
    // Clean up test data
    const existingUsers = await prisma.user.findMany({
      where: { walletAddress: userWallet },
    });
    for (const u of existingUsers) {
      const userProjects = await prisma.project.findMany({ where: { ownerId: u.id } });
      for (const p of userProjects) {
        await prisma.project.delete({ where: { id: p.id } });
      }
      await prisma.user.delete({ where: { id: u.id } });
    }

    // Create User
    const userRes = await request(app).post('/users').send({
      walletAddress: userWallet,
      displayName: 'Capability Owner',
    });
    userId = userRes.body.id;

    // Create Project 1
    const p1Res = await request(app).post('/projects').send({
      name: 'Project 1',
      description: 'First test project',
      ownerId: userId,
    });
    project1Id = p1Res.body.id;

    // Create Project 2
    const p2Res = await request(app).post('/projects').send({
      name: 'Project 2',
      description: 'Second test project',
      ownerId: userId,
    });
    project2Id = p2Res.body.id;

    // Create Agent 1 in Project 1
    const a1Res = await request(app).post(`/projects/${project1Id}/agents`).send({
      ownerId: userId,
      name: 'Claude Backend',
      provider: 'claude',
    });
    agent1Id = a1Res.body.id;

    // Create Agent 2 in Project 1
    const a2Res = await request(app).post(`/projects/${project1Id}/agents`).send({
      ownerId: userId,
      name: 'Gemini UI',
      provider: 'gemini',
    });
    agent2Id = a2Res.body.id;

    // Create Agent 3 in Project 2
    const a3Res = await request(app).post(`/projects/${project2Id}/agents`).send({
      ownerId: userId,
      name: 'Other Project Agent',
      provider: 'openai',
    });
    agent3Id = a3Res.body.id;
  });

  afterAll(async () => {
    if (userId) {
      const userProjects = await prisma.project.findMany({ where: { ownerId: userId } });
      for (const p of userProjects) {
        await prisma.project.delete({ where: { id: p.id } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('Add Capability (POST /agents/:agentId/capabilities)', () => {
    it('should add capability successfully and normalize uppercase/spaces', async () => {
      const res = await request(app).post(`/agents/${agent1Id}/capabilities`).send({
        capability: '  Backend ',
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.agentId).toBe(agent1Id);
      expect(res.body.capability).toBe('backend');
      expect(res.body.createdAt).toBeDefined();
    });

    it('should add multiple capabilities to the same agent and normalize format', async () => {
      const res1 = await request(app).post(`/agents/${agent1Id}/capabilities`).send({
        capability: 'Code-Review',
      });
      expect(res1.status).toBe(201);
      expect(res1.body.capability).toBe('code-review');

      const res2 = await request(app).post(`/agents/${agent1Id}/capabilities`).send({
        capability: 'debugging',
      });
      expect(res2.status).toBe(201);
      expect(res2.body.capability).toBe('debugging');
    });

    it('should return 409 Conflict when adding a duplicate capability', async () => {
      const res = await request(app).post(`/agents/${agent1Id}/capabilities`).send({
        capability: ' BACKEND ',
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('CONFLICT');
    });

    it('should return 400 Bad Request for invalid capability formats', async () => {
      // Too short (< 2 chars)
      const resShort = await request(app).post(`/agents/${agent1Id}/capabilities`).send({
        capability: 'a',
      });
      expect(resShort.status).toBe(400);

      // Invalid characters (spaces, special symbols)
      const resInvalid = await request(app).post(`/agents/${agent1Id}/capabilities`).send({
        capability: 'invalid capability!',
      });
      expect(resInvalid.status).toBe(400);
      expect(resInvalid.body.error).toBe('VALIDATION_ERROR');

      // Leading/trailing hyphen
      const resHyphen = await request(app).post(`/agents/${agent1Id}/capabilities`).send({
        capability: '-backend-',
      });
      expect(resHyphen.status).toBe(400);
    });

    it('should return 404 Not Found when agent does not exist', async () => {
      const res = await request(app).post('/agents/nonexistent-agent-id/capabilities').send({
        capability: 'testing',
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });
  });

  describe('List Capabilities (GET /agents/:agentId/capabilities)', () => {
    it('should list all capabilities attached to an agent', async () => {
      const res = await request(app).get(`/agents/${agent1Id}/capabilities`);

      expect(res.status).toBe(200);
      expect(res.body.agentId).toBe(agent1Id);
      expect(Array.isArray(res.body.capabilities)).toBe(true);
      expect(res.body.capabilities).toEqual(['backend', 'code-review', 'debugging']);
    });

    it('should return empty list when agent has no capabilities', async () => {
      const res = await request(app).get(`/agents/${agent2Id}/capabilities`);

      expect(res.status).toBe(200);
      expect(res.body.agentId).toBe(agent2Id);
      expect(res.body.capabilities).toEqual([]);
    });

    it('should return 404 Not Found for nonexistent agent', async () => {
      const res = await request(app).get('/agents/nonexistent-agent-id/capabilities');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });
  });

  describe('Remove Capability (DELETE /agents/:agentId/capabilities/:capability)', () => {
    beforeAll(async () => {
      await request(app).post(`/agents/${agent2Id}/capabilities`).send({
        capability: 'frontend',
      });
    });

    it('should remove capability successfully and handle URL parameter normalization', async () => {
      const res = await request(app).delete(`/agents/${agent2Id}/capabilities/ Frontend `);

      expect(res.status).toBe(204);

      // Verify removed
      const listRes = await request(app).get(`/agents/${agent2Id}/capabilities`);
      expect(listRes.body.capabilities).toEqual([]);
    });

    it('should return 404 Not Found when capability is not attached to agent', async () => {
      const res = await request(app).delete(`/agents/${agent2Id}/capabilities/backend`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('should return 404 Not Found when agent does not exist', async () => {
      const res = await request(app).delete('/agents/nonexistent-agent-id/capabilities/backend');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });
  });

  describe('Project Capability Discovery (GET /projects/:projectId/agents?capability=...)', () => {
    beforeAll(async () => {
      // Add capability to agent 3 in Project 2
      await request(app).post(`/agents/${agent3Id}/capabilities`).send({
        capability: ' Backend ',
      });
    });

    it('should filter project agents by capability (normalized query param)', async () => {
      const res = await request(app).get(`/projects/${project1Id}/agents?capability= BACKEND `);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(agent1Id);
      expect(res.body[0].name).toBe('Claude Backend');
    });

    it('should prevent cross-project leakage when filtering by capability', async () => {
      const resP1 = await request(app).get(`/projects/${project1Id}/agents?capability=backend`);
      expect(resP1.status).toBe(200);
      const p1Ids = resP1.body.map((a: { id: string }) => a.id);
      expect(p1Ids).toContain(agent1Id);
      expect(p1Ids).not.toContain(agent3Id);

      const resP2 = await request(app).get(`/projects/${project2Id}/agents?capability=backend`);
      expect(resP2.status).toBe(200);
      const p2Ids = resP2.body.map((a: { id: string }) => a.id);
      expect(p2Ids).toContain(agent3Id);
      expect(p2Ids).not.toContain(agent1Id);
    });

    it('should return 200 [] when no agents match capability query', async () => {
      const res = await request(app).get(
        `/projects/${project1Id}/agents?capability=smart-contracts`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return 404 when project does not exist', async () => {
      const res = await request(app).get(
        '/projects/nonexistent-project-id/agents?capability=backend',
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });
  });

  describe('Cascade Deletion', () => {
    it('should cascade delete capabilities when agent is deleted', async () => {
      // Create temporary agent
      const tempAgentRes = await request(app).post(`/projects/${project1Id}/agents`).send({
        ownerId: userId,
        name: 'Temp Agent',
        provider: 'claude',
      });
      const tempAgentId = tempAgentRes.body.id;

      // Add capability to temp agent
      await request(app).post(`/agents/${tempAgentId}/capabilities`).send({
        capability: 'testing',
      });

      // Verify capability exists in database
      const capInDb = await prisma.agentCapability.findUnique({
        where: {
          agentId_capability: {
            agentId: tempAgentId,
            capability: 'testing',
          },
        },
      });
      expect(capInDb).not.toBeNull();

      // Delete temp agent
      const deleteRes = await request(app).delete(`/agents/${tempAgentId}`);
      expect(deleteRes.status).toBe(204);

      // Verify capability was cascade deleted
      const capAfterDelete = await prisma.agentCapability.findUnique({
        where: {
          agentId_capability: {
            agentId: tempAgentId,
            capability: 'testing',
          },
        },
      });
      expect(capAfterDelete).toBeNull();
    });
  });
});
