import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';

const app = createApp();
const request = supertest(app);

describe('PRD-53 User API Security Hardening Integration Tests', () => {
  let userA: { id: string; walletAddress: string };
  let userB: { id: string; walletAddress: string };
  let sessionAId: string;
  let sessionCookieA: string;

  beforeEach(async () => {
    // Clean database tables
    await prisma.payment.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.policy.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.projectWorkspace.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();

    // Create User A & session
    const uA = await prisma.user.create({
      data: {
        walletAddress: '0x1111111111111111111111111111111111111111',
        displayName: 'User Alice',
      },
    });
    userA = { id: uA.id, walletAddress: uA.walletAddress! };
    const sessA = await sessionService.createSession(userA.id);
    sessionAId = sessA.id;
    sessionCookieA = `agentmesh_session=${sessionAId}`;

    // Create User B & session
    const uB = await prisma.user.create({
      data: {
        walletAddress: '0x2222222222222222222222222222222222222222',
        displayName: 'User Bob',
      },
    });
    userB = { id: uB.id, walletAddress: uB.walletAddress! };
    await sessionService.createSession(userB.id);
  });

  afterEach(async () => {
    await prisma.payment.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.policy.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.projectWorkspace.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('1. Unauthenticated Route Boundary Tests (401)', () => {
    it('POST /users without session -> returns 401 Unauthorized', async () => {
      const res = await request.post('/users').send({ displayName: 'Attacker' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('GET /users/:userId without session -> returns 401 Unauthorized', async () => {
      const res = await request.get(`/users/${userA.id}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('GET /users/wallet/:walletAddress without session -> returns 401 Unauthorized', async () => {
      const res = await request.get(`/users/wallet/${userA.walletAddress}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('PATCH /users/:userId without session -> returns 401 Unauthorized', async () => {
      const res = await request.patch(`/users/${userA.id}`).send({ displayName: 'Hacked' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('GET /users/:userId/projects without session -> returns 401 Unauthorized', async () => {
      const res = await request.get(`/users/${userA.id}/projects`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });
  });

  describe('2. Cross-User Authorization Boundary Tests (403)', () => {
    it('User A querying GET /users/:userBId -> returns 403 Forbidden when not sharing a project', async () => {
      const res = await request
        .get(`/users/${userB.id}`)
        .set('Cookie', [sessionCookieA]);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('User A querying GET /users/wallet/:userBWallet -> returns 403 Forbidden when not sharing a project', async () => {
      const res = await request
        .get(`/users/wallet/${userB.walletAddress}`)
        .set('Cookie', [sessionCookieA]);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('User A attempting PATCH /users/:userBId -> returns 403 Forbidden', async () => {
      const res = await request
        .patch(`/users/${userB.id}`)
        .set('Cookie', [sessionCookieA])
        .send({ displayName: 'Malicious Update' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('User A attempting GET /users/:userBId/projects -> returns 403 Forbidden', async () => {
      const res = await request
        .get(`/users/${userB.id}/projects`)
        .set('Cookie', [sessionCookieA]);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });
  });

  describe('3. Identity Spoofing & Server Authority Tests', () => {
    it('User A sending POST /users with User B walletAddress -> returns 403 Forbidden', async () => {
      const res = await request
        .post('/users')
        .set('Cookie', [sessionCookieA])
        .send({
          walletAddress: userB.walletAddress,
          displayName: 'Spoofed Bob',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    });

    it('User A sending PATCH /users/:userAId with spoofed body payload (userId/ownerId) -> updates only User A profile', async () => {
      const res = await request
        .patch(`/users/${userA.id}`)
        .set('Cookie', [sessionCookieA])
        .send({
          displayName: 'Alice Updated',
          userId: userB.id,
          ownerId: userB.id,
          walletAddress: userB.walletAddress,
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userA.id);
      expect(res.body.displayName).toBe('Alice Updated');
      expect(res.body.walletAddress).toBe(userA.walletAddress);

      // Verify User B remained unmodified in database
      const dbB = await prisma.user.findUnique({ where: { id: userB.id } });
      expect(dbB?.displayName).toBe('User Bob');
    });
  });

  describe('4. Legitimate Authenticated Workflows', () => {
    it('User A querying own GET /users/:userAId -> returns 200 OK with User A profile', async () => {
      const res = await request
        .get(`/users/${userA.id}`)
        .set('Cookie', [sessionCookieA]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userA.id);
      expect(res.body.displayName).toBe('User Alice');
    });

    it('User A querying own GET /users/wallet/:userAWallet -> returns 200 OK with User A profile', async () => {
      const res = await request
        .get(`/users/wallet/${userA.walletAddress}`)
        .set('Cookie', [sessionCookieA]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userA.id);
    });

    it('User A updating own profile via PATCH /users/:userAId -> returns 200 OK', async () => {
      const res = await request
        .patch(`/users/${userA.id}`)
        .set('Cookie', [sessionCookieA])
        .send({ displayName: 'Alice Updated' });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Alice Updated');
    });

    it('User A listing own projects via GET /users/:userAId/projects -> returns 200 OK', async () => {
      const project = await prisma.project.create({
        data: {
          name: 'Alice Project',
          ownerId: userA.id,
          members: {
            create: { userId: userA.id, role: 'OWNER' },
          },
        },
      });

      const res = await request
        .get(`/users/${userA.id}/projects`)
        .set('Cookie', [sessionCookieA]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((p: { id: string }) => p.id === project.id)).toBe(true);
    });

    it('User A and User B sharing a project -> User A can view User B profile via GET /users/:userBId', async () => {
      await prisma.project.create({
        data: {
          name: 'Shared Project',
          ownerId: userA.id,
          members: {
            createMany: {
              data: [
                { userId: userA.id, role: 'OWNER' },
                { userId: userB.id, role: 'MEMBER' },
              ],
            },
          },
        },
      });

      const res = await request
        .get(`/users/${userB.id}`)
        .set('Cookie', [sessionCookieA]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userB.id);
      expect(res.body.displayName).toBe('User Bob');
    });
  });
});
