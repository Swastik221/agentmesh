import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';

describe('PRD #11 Project Brain API Integration Tests', () => {
  const app = createApp();

  const walletOwner = '0xBRAINOWNER111111111111111111111111111111';
  const walletMember = '0xBRAINMEMBER2222222222222222222222222222';
  const walletNonMember = '0xBRAINOUTSIDER33333333333333333333333333';

  let ownerUser: { id: string };
  let memberUser: { id: string };
  let outsiderUser: { id: string };

  let ownerSession: { id: string };
  let memberSession: { id: string };
  let outsiderSession: { id: string };

  let project1: { id: string };
  let project2: { id: string };

  beforeAll(async () => {
    // Cleanup prior test data if existing
    const existingUsers = await prisma.user.findMany({
      where: { walletAddress: { in: [walletOwner, walletMember, walletNonMember] } },
    });

    for (const u of existingUsers) {
      await prisma.projectBrainEntry.deleteMany({ where: { authorId: u.id } }).catch(() => {});
      const userProjects = await prisma.project.findMany({ where: { ownerId: u.id } });
      for (const p of userProjects) {
        await prisma.projectBrainEntry.deleteMany({ where: { projectId: p.id } }).catch(() => {});
        await prisma.projectMember.deleteMany({ where: { projectId: p.id } }).catch(() => {});
        await prisma.project.delete({ where: { id: p.id } }).catch(() => {});
      }
      await prisma.projectMember.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.authSession.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    }

    // Create users
    ownerUser = await prisma.user.create({
      data: { walletAddress: walletOwner, displayName: 'Project Owner' },
    });
    memberUser = await prisma.user.create({
      data: { walletAddress: walletMember, displayName: 'Project Member' },
    });
    outsiderUser = await prisma.user.create({
      data: { walletAddress: walletNonMember, displayName: 'Outsider User' },
    });

    // Create sessions
    ownerSession = await sessionService.createSession(ownerUser.id);
    memberSession = await sessionService.createSession(memberUser.id);
    outsiderSession = await sessionService.createSession(outsiderUser.id);

    // Create Project 1 (Owned by ownerUser, memberUser added as MEMBER)
    project1 = await prisma.project.create({
      data: {
        name: 'Brain Project 1',
        description: 'First project for Brain tests',
        ownerId: ownerUser.id,
        members: {
          create: [
            { userId: ownerUser.id, role: 'OWNER' },
            { userId: memberUser.id, role: 'MEMBER' },
          ],
        },
      },
    });

    // Create Project 2 (Owned by outsiderUser)
    project2 = await prisma.project.create({
      data: {
        name: 'Brain Project 2',
        description: 'Second project for Brain tests',
        ownerId: outsiderUser.id,
        members: {
          create: [{ userId: outsiderUser.id, role: 'OWNER' }],
        },
      },
    });
  });

  afterAll(async () => {
    if (project1?.id || project2?.id) {
      await prisma.projectBrainEntry
        .deleteMany({
          where: { projectId: { in: [project1?.id, project2?.id].filter(Boolean) } },
        })
        .catch(() => {});
      await prisma.projectMember
        .deleteMany({
          where: { projectId: { in: [project1?.id, project2?.id].filter(Boolean) } },
        })
        .catch(() => {});
      await prisma.project
        .deleteMany({
          where: { id: { in: [project1?.id, project2?.id].filter(Boolean) } },
        })
        .catch(() => {});
    }

    if (ownerUser?.id || memberUser?.id || outsiderUser?.id) {
      const userIds = [ownerUser?.id, memberUser?.id, outsiderUser?.id].filter(Boolean);
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    }
  });

  describe('Authentication & Authorization', () => {
    it('returns 401 Unauthorized when no session cookie or token is provided', async () => {
      const res = await request(app).get(`/api/projects/${project1.id}/brain/entries`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('returns 403 Forbidden when non-member tries to access project brain entries', async () => {
      const res = await request(app)
        .get(`/api/projects/${project1.id}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${outsiderSession.id}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('not a member');
    });

    it('returns 404 Not Found when attempting to access a non-existent project', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/projects/${nonExistentId}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('always assigns authorId strictly from SIWE session and ignores client-provided authorId', async () => {
      const fakeAuthorId = outsiderUser.id;
      const res = await request(app)
        .post(`/api/projects/${project1.id}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${memberSession.id}`])
        .send({
          type: 'DECISION',
          title: 'Architecture Decision',
          content: 'We use SIWE identity exclusively.',
          authorId: fakeAuthorId,
        });

      expect(res.status).toBe(201);
      expect(res.body.authorId).toBe(memberUser.id);
      expect(res.body.authorId).not.toBe(fakeAuthorId);
    });
  });

  describe('Validation', () => {
    it('rejects creation with missing required fields', async () => {
      const res = await request(app)
        .post(`/api/projects/${project1.id}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          title: 'Only Title',
        });

      expect(res.status).toBe(400);
    });

    it('rejects creation with invalid type enum', async () => {
      const res = await request(app)
        .post(`/api/projects/${project1.id}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          type: 'INVALID_TYPE',
          title: 'Valid Title',
          content: 'Valid content',
        });

      expect(res.status).toBe(400);
    });

    it('rejects creation with empty or whitespace-only title', async () => {
      const res = await request(app)
        .post(`/api/projects/${project1.id}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          type: 'NOTE',
          title: '   ',
          content: 'Valid content',
        });

      expect(res.status).toBe(400);
    });

    it('rejects creation with title exceeding 200 characters', async () => {
      const longTitle = 'a'.repeat(201);
      const res = await request(app)
        .post(`/api/projects/${project1.id}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          type: 'REQUIREMENT',
          title: longTitle,
          content: 'Valid content',
        });

      expect(res.status).toBe(400);
    });

    it('rejects update with empty payload', async () => {
      // First create an entry
      const createRes = await request(app)
        .post(`/api/projects/${project1.id}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          type: 'NOTE',
          title: 'Sample Note',
          content: 'Sample Content',
        });

      const entryId = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/projects/${project1.id}/brain/entries/${entryId}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({});

      expect(updateRes.status).toBe(400);
    });
  });

  describe('CRUD Operations', () => {
    let createdEntryId: string;

    it('creates a Project Brain entry (POST /api/projects/:projectId/brain/entries)', async () => {
      const res = await request(app)
        .post(`/api/projects/${project1.id}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`])
        .send({
          type: 'REQUIREMENT',
          title: 'Real-Time Sync Requirement',
          content: 'Must maintain sub-100ms synchronization across project nodes.',
          tags: ['performance', 'realtime'],
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.projectId).toBe(project1.id);
      expect(res.body.authorId).toBe(ownerUser.id);
      expect(res.body.type).toBe('REQUIREMENT');
      expect(res.body.title).toBe('Real-Time Sync Requirement');
      expect(res.body.content).toBe('Must maintain sub-100ms synchronization across project nodes.');
      expect(res.body.tags).toEqual(['performance', 'realtime']);
      expect(res.body.author).toBeDefined();
      expect(res.body.author.id).toBe(ownerUser.id);

      createdEntryId = res.body.id;
    });

    it('gets a single Project Brain entry by ID (GET /api/projects/:projectId/brain/entries/:entryId)', async () => {
      const res = await request(app)
        .get(`/api/projects/${project1.id}/brain/entries/${createdEntryId}`)
        .set('Cookie', [`agentmesh_session=${memberSession.id}`]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdEntryId);
      expect(res.body.title).toBe('Real-Time Sync Requirement');
    });

    it('returns 404 when trying to access entry from another project using wrong projectId path', async () => {
      const res = await request(app)
        .get(`/api/projects/${project2.id}/brain/entries/${createdEntryId}`)
        .set('Cookie', [`agentmesh_session=${outsiderSession.id}`]);

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('updates a Project Brain entry (PUT /api/projects/:projectId/brain/entries/:entryId)', async () => {
      const res = await request(app)
        .put(`/api/projects/${project1.id}/brain/entries/${createdEntryId}`)
        .set('Cookie', [`agentmesh_session=${memberSession.id}`])
        .send({
          title: 'Updated Sync Requirement',
          tags: ['performance', 'realtime', 'v2'],
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Sync Requirement');
      expect(res.body.tags).toEqual(['performance', 'realtime', 'v2']);
      // Unchanged fields remain intact
      expect(res.body.type).toBe('REQUIREMENT');
      expect(res.body.content).toBe('Must maintain sub-100ms synchronization across project nodes.');
    });

    it('deletes a Project Brain entry (DELETE /api/projects/:projectId/brain/entries/:entryId)', async () => {
      const deleteRes = await request(app)
        .delete(`/api/projects/${project1.id}/brain/entries/${createdEntryId}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toBe('Project Brain entry deleted successfully');

      // Subsequent GET should return 404
      const getRes = await request(app)
        .get(`/api/projects/${project1.id}/brain/entries/${createdEntryId}`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(getRes.status).toBe(404);
    });
  });

  describe('Filtering, Search & Pagination', () => {
    beforeAll(async () => {
      // Seed entries in project1
      const entriesToCreate = [
        {
          projectId: project1.id,
          authorId: ownerUser.id,
          type: 'CONSTRAINT' as const,
          title: 'PostgreSQL Database Requirement',
          content: 'Must use Prisma ORM and PostgreSQL strictly.',
          tags: ['database', 'architecture'],
        },
        {
          projectId: project1.id,
          authorId: memberUser.id,
          type: 'DECISION' as const,
          title: 'SIWE Authentication Standard',
          content: 'We use EIP-4361 for wallet-based agent mesh authentication.',
          tags: ['security', 'auth'],
        },
        {
          projectId: project1.id,
          authorId: ownerUser.id,
          type: 'NOTE' as const,
          title: 'Meeting Notes on Protocol v0.1',
          content: 'Discussed JSON schema validation using Zod for WebSocket frames.',
          tags: ['protocol', 'meeting'],
        },
        {
          projectId: project1.id,
          authorId: memberUser.id,
          type: 'CONSTRAINT' as const,
          title: 'Zero Direct Database Access for Agents',
          content: 'Agents communicate strictly via WebSocket and GraphQL/REST APIs.',
          tags: ['security', 'architecture'],
        },
      ];

      for (const data of entriesToCreate) {
        await prisma.projectBrainEntry.create({ data });
      }
    });

    it('filters entries by type (type=CONSTRAINT)', async () => {
      const res = await request(app)
        .get(`/api/projects/${project1.id}/brain/entries?type=CONSTRAINT`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBeGreaterThanOrEqual(2);
      expect(res.body.entries.every((e: { type: string }) => e.type === 'CONSTRAINT')).toBe(true);
    });

    it('filters entries by tag (tag=architecture)', async () => {
      const res = await request(app)
        .get(`/api/projects/${project1.id}/brain/entries?tag=architecture`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBeGreaterThanOrEqual(2);
      expect(
        res.body.entries.every((e: { tags: string[] }) => e.tags.includes('architecture')),
      ).toBe(true);
    });

    it('searches entries by term across title and content (case-insensitive search=Zod)', async () => {
      const res = await request(app)
        .get(`/api/projects/${project1.id}/brain/entries?search=zod`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBe(1);
      expect(res.body.entries[0].title).toBe('Meeting Notes on Protocol v0.1');
    });

    it('paginates results with page and limit params', async () => {
      const res = await request(app)
        .get(`/api/projects/${project1.id}/brain/entries?page=1&limit=2`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBe(2);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(2);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(4);
      expect(res.body.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Project Brain Aggregated View', () => {
    it('returns aggregated brain view with type breakdown stats (GET /api/projects/:projectId/brain)', async () => {
      const res = await request(app)
        .get(`/api/projects/${project1.id}/brain`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(res.body.projectId).toBe(project1.id);
      expect(Array.isArray(res.body.entries)).toBe(true);
      expect(res.body.stats).toBeDefined();
      expect(res.body.stats.total).toBeGreaterThanOrEqual(4);
      expect(typeof res.body.stats.requirements).toBe('number');
      expect(typeof res.body.stats.decisions).toBe('number');
      expect(typeof res.body.stats.notes).toBe('number');
      expect(typeof res.body.stats.constraints).toBe('number');
    });
  });

  describe('Dual Path Mounting Verification', () => {
    it('supports route without /api prefix (/projects/:projectId/brain/entries)', async () => {
      const res = await request(app)
        .get(`/projects/${project1.id}/brain/entries`)
        .set('Cookie', [`agentmesh_session=${ownerSession.id}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.entries)).toBe(true);
    });
  });
});
