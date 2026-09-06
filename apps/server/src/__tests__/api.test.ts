import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { ProjectRole } from '@prisma/client';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

describe('PRD #3 User + Project System API Integration Tests', () => {
  const app = createApp();

  const userAWallet = '0xA111111111111111111111111111111111111111';
  const userBWallet = '0xB222222222222222222222222222222222222222';

  let userAId: string;
  let userBId: string;
  let projectId: string;

  beforeAll(async () => {
    // Clean up test data if present
    const users = await prisma.user.findMany({
      where: { walletAddress: { in: [userAWallet, userBWallet] } },
    });
    for (const u of users) {
      const userProjects = await prisma.project.findMany({ where: { ownerId: u.id } });
      for (const p of userProjects) {
        await prisma.project.delete({ where: { id: p.id } });
      }
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  afterAll(async () => {
    if (userAId || userBId) {
      const userIds = [userAId, userBId].filter(Boolean);
      for (const uid of userIds) {
        const userProjects = await prisma.project.findMany({ where: { ownerId: uid } });
        for (const p of userProjects) {
          await prisma.project.delete({ where: { id: p.id } });
        }
        await prisma.user.delete({ where: { id: uid } }).catch(() => {});
      }
    }
    await prisma.$disconnect();
  });

  describe('User API', () => {
    it('POST /users -> should create a new user', async () => {
      const res = await request(app).post('/users').send({
        walletAddress: userAWallet,
        displayName: 'User Alice',
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.walletAddress).toBe(userAWallet);
      expect(res.body.displayName).toBe('User Alice');

      userAId = res.body.id;
    });

    it('POST /users -> should create a secondary user', async () => {
      const res = await request(app).post('/users').send({
        walletAddress: userBWallet,
        displayName: 'User Bob',
      });

      expect(res.status).toBe(201);
      userBId = res.body.id;
    });

    it('POST /users -> should return 409 Conflict for duplicate walletAddress', async () => {
      const res = await request(app).post('/users').send({
        walletAddress: userAWallet,
        displayName: 'Duplicate Alice',
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('CONFLICT');
    });

    it('GET /users/:userId -> should return user by ID', async () => {
      const res = await request(app).get(`/users/${userAId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userAId);
      expect(res.body.displayName).toBe('User Alice');
    });

    it('GET /users/:userId -> should return 404 for non-existent user', async () => {
      const res = await request(app).get('/users/non-existent-user-id');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('GET /users/wallet/:walletAddress -> should return matching user', async () => {
      const res = await request(app).get(`/users/wallet/${userAWallet}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userAId);
      expect(res.body.walletAddress).toBe(userAWallet);
    });

    it('GET /users/wallet/:walletAddress -> should return 404 for unknown wallet', async () => {
      const res = await request(app).get(
        '/users/wallet/0x0000000000000000000000000000000000000000',
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('PATCH /users/:userId -> should update display name', async () => {
      const res = await request(app).patch(`/users/${userAId}`).send({
        displayName: 'Alice Updated',
      });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Alice Updated');
    });

    it('PATCH /users/:userId -> should return 404 for updating non-existent user', async () => {
      const res = await request(app).patch('/users/non-existent-user-id').send({
        displayName: 'Ghost',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('Project API', () => {
    it('POST /projects -> should create project and automatically assign owner membership in transaction', async () => {
      const res = await request(app).post('/projects').send({
        name: 'AgentMesh Workspace',
        description: 'Multiplayer AI workspace',
        ownerId: userAId,
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('AgentMesh Workspace');
      expect(res.body.ownerId).toBe(userAId);

      projectId = res.body.id;

      // Verify ProjectMember record was created with role OWNER
      const member = await prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
            userId: userAId,
          },
        },
      });

      expect(member).not.toBeNull();
      expect(member?.role).toBe(ProjectRole.OWNER);
    });

    it('POST /projects -> should return 404 if ownerId does not exist', async () => {
      const res = await request(app).post('/projects').send({
        name: 'Ghost Project',
        ownerId: 'non-existent-owner-id',
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('GET /projects/:projectId -> should return project with owner, members, agents', async () => {
      const res = await request(app).get(`/projects/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(projectId);
      expect(res.body.owner.id).toBe(userAId);
      expect(res.body.members).toHaveLength(1);
      expect(res.body.agents).toBeDefined();
    });

    it('GET /projects/:projectId -> should return 404 for non-existent project', async () => {
      const res = await request(app).get('/projects/non-existent-project-id');

      expect(res.status).toBe(404);
    });

    it('GET /users/:userId/projects -> should return projects where user is a member', async () => {
      const res = await request(app).get(`/users/${userAId}/projects`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].id).toBe(projectId);
      expect(res.body[0].role).toBe('OWNER');
    });

    it('GET /users/:userId/projects -> should return 404 if user does not exist', async () => {
      const res = await request(app).get('/users/non-existent-user-id/projects');

      expect(res.status).toBe(404);
    });

    it('PATCH /projects/:projectId -> should update project name and description', async () => {
      const res = await request(app).patch(`/projects/${projectId}`).send({
        name: 'Updated Workspace Name',
        description: 'New Description',
      });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Workspace Name');
      expect(res.body.description).toBe('New Description');
    });

    it('PATCH /projects/:projectId -> should return 404 for non-existent project', async () => {
      const res = await request(app).patch('/projects/non-existent-project-id').send({
        name: 'Ghost',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('Project Membership API', () => {
    it('POST /projects/:projectId/members -> should add userB as MEMBER', async () => {
      const res = await request(app).post(`/projects/${projectId}/members`).send({
        userId: userBId,
        role: 'MEMBER',
      });

      expect(res.status).toBe(201);
      expect(res.body.projectId).toBe(projectId);
      expect(res.body.userId).toBe(userBId);
      expect(res.body.role).toBe('MEMBER');
    });

    it('POST /projects/:projectId/members -> should return 409 Conflict for duplicate membership', async () => {
      const res = await request(app).post(`/projects/${projectId}/members`).send({
        userId: userBId,
        role: 'MEMBER',
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('CONFLICT');
    });

    it('GET /projects/:projectId/members -> should list all members with user details', async () => {
      const res = await request(app).get(`/projects/${projectId}/members`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('PATCH /projects/:projectId/members/:userId -> should promote userB to OWNER', async () => {
      const res = await request(app)
        .patch(`/projects/${projectId}/members/${userBId}`)
        .send({ role: 'OWNER' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('OWNER');
    });

    it('PATCH /projects/:projectId/members/:userId -> should demote userB back to MEMBER', async () => {
      const res = await request(app)
        .patch(`/projects/${projectId}/members/${userBId}`)
        .send({ role: 'MEMBER' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('MEMBER');
    });

    it('PATCH /projects/:projectId/members/:userId -> should prevent demoting the only OWNER', async () => {
      const res = await request(app)
        .patch(`/projects/${projectId}/members/${userAId}`)
        .send({ role: 'MEMBER' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('CONFLICT');
      expect(res.body.message).toContain('only project OWNER');
    });

    it('DELETE /projects/:projectId/members/:userId -> should prevent removing the only OWNER', async () => {
      const res = await request(app).delete(`/projects/${projectId}/members/${userAId}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('CONFLICT');
      expect(res.body.message).toContain('only project OWNER');
    });

    it('DELETE /projects/:projectId/members/:userId -> should remove userB from project', async () => {
      const res = await request(app).delete(`/projects/${projectId}/members/${userBId}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Member removed successfully');
    });

    it('DELETE /projects/:projectId/members/:userId -> should return 404 for removing non-existent member', async () => {
      const res = await request(app).delete(`/projects/${projectId}/members/${userBId}`);

      expect(res.status).toBe(404);
    });
  });

  describe('OWNER Invariant Concurrency Tests', () => {
    it('should atomically prevent concurrent demotions resulting in 0 OWNERs', async () => {
      // Re-add userB as OWNER so there are 2 OWNERs: userA and userB
      await request(app).post(`/projects/${projectId}/members`).send({
        userId: userBId,
        role: 'OWNER',
      });

      // Issue concurrent requests demoting userA and userB simultaneously
      const [resA, resB] = await Promise.all([
        request(app)
          .patch(`/projects/${projectId}/members/${userAId}`)
          .send({ role: 'MEMBER' }),
        request(app)
          .patch(`/projects/${projectId}/members/${userBId}`)
          .send({ role: 'MEMBER' }),
      ]);

      const statuses = [resA.status, resB.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      // Verify that exactly 1 OWNER remains in the database
      const ownerCount = await prisma.projectMember.count({
        where: {
          projectId,
          role: ProjectRole.OWNER,
        },
      });

      expect(ownerCount).toBe(1);
    });

    it('should atomically prevent concurrent removals resulting in 0 OWNERs', async () => {
      // Ensure both userA and userB are OWNERs so there are 2 OWNERs
      await request(app)
        .patch(`/projects/${projectId}/members/${userAId}`)
        .send({ role: 'OWNER' });

      const memberB = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: userBId } },
      });
      if (!memberB) {
        await request(app).post(`/projects/${projectId}/members`).send({
          userId: userBId,
          role: 'OWNER',
        });
      } else {
        await request(app)
          .patch(`/projects/${projectId}/members/${userBId}`)
          .send({ role: 'OWNER' });
      }

      const ownerCountBefore = await prisma.projectMember.count({
        where: { projectId, role: ProjectRole.OWNER },
      });
      expect(ownerCountBefore).toBe(2);

      // Issue concurrent removal requests for both userA and userB
      const [resA, resB] = await Promise.all([
        request(app).delete(`/projects/${projectId}/members/${userAId}`),
        request(app).delete(`/projects/${projectId}/members/${userBId}`),
      ]);

      const statuses = [resA.status, resB.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      // Verify that exactly 1 OWNER remains in the database
      const ownerCountAfter = await prisma.projectMember.count({
        where: {
          projectId,
          role: ProjectRole.OWNER,
        },
      });

      expect(ownerCountAfter).toBe(1);
    });
  });

  describe('Project Delete API', () => {
    it('DELETE /projects/:projectId -> should delete project and cascade members', async () => {
      const res = await request(app).delete(`/projects/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Project deleted successfully');

      const checkProject = await prisma.project.findUnique({ where: { id: projectId } });
      expect(checkProject).toBeNull();
    });

    it('DELETE /projects/:projectId -> should return 404 for non-existent project', async () => {
      const res = await request(app).delete(`/projects/${projectId}`);

      expect(res.status).toBe(404);
    });
  });
});
