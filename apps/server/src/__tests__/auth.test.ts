import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SiweMessage } from 'siwe';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';

describe('PRD #8 Wallet Identity & SIWE Integration Tests', () => {
  const app = createApp();

  const testAccountA = privateKeyToAccount(generatePrivateKey());
  const walletAddressA = testAccountA.address;

  const testAccountB = privateKeyToAccount(generatePrivateKey());
  const walletAddressB = testAccountB.address;

  let sessionCookieA: string;
  let sessionIdA: string;
  let userAId: string;

  beforeAll(async () => {
    // Clean up test data if present
    const users = await prisma.user.findMany({
      where: {
        walletAddress: {
          in: [walletAddressA.toLowerCase(), walletAddressB.toLowerCase()],
        },
      },
    });
    for (const u of users) {
      await prisma.project.deleteMany({ where: { ownerId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  afterAll(async () => {
    const userIds = [userAId].filter(Boolean);
    for (const uid of userIds) {
      await prisma.project.deleteMany({ where: { ownerId: uid } }).catch(() => {});
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('GET /auth/nonce', () => {
    it('should generate a valid single-use SIWE nonce', async () => {
      const res = await request(app).get('/auth/nonce');

      expect(res.status).toBe(200);
      expect(res.body.nonce).toBeDefined();
      expect(typeof res.body.nonce).toBe('string');
      expect(res.body.nonce.length).toBeGreaterThanOrEqual(8);

      // Verify stored in DB
      const dbNonce = await prisma.siweNonce.findUnique({
        where: { nonce: res.body.nonce },
      });
      expect(dbNonce).not.toBeNull();
      expect(dbNonce?.nonce).toBe(res.body.nonce);
    });
  });

  describe('POST /auth/verify', () => {
    it('should verify valid SIWE signature, normalize address, create user & set HTTP-only session cookie', async () => {
      const nonceRes = await request(app).get('/auth/nonce');
      const nonce = nonceRes.body.nonce;

      const siweMsg = new SiweMessage({
        domain: config.siweDomain,
        address: walletAddressA, // e.g. Mixed-Case Address
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: config.siweUri,
        version: '1',
        chainId: config.siweChainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageStr = siweMsg.prepareMessage();
      const signature = await testAccountA.signMessage({ message: messageStr });

      const res = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBeDefined();
      expect(res.body.user.walletAddress).toBe(walletAddressA.toLowerCase());

      userAId = res.body.user.id;

      // Verify HTTP-only session cookie
      const cookies = res.get('Set-Cookie');
      expect(cookies).toBeDefined();
      expect(cookies && cookies[0]).toContain('agentmesh_session=');

      sessionCookieA = cookies ? cookies[0].split(';')[0] : '';
      sessionIdA = sessionCookieA.replace('agentmesh_session=', '');

      // Verify nonce consumed
      const dbNonce = await prisma.siweNonce.findUnique({ where: { nonce } });
      expect(dbNonce).toBeNull();
    });

    it('should reject reused nonce with 401 Unauthorized', async () => {
      const nonceRes = await request(app).get('/auth/nonce');
      const nonce = nonceRes.body.nonce;

      const siweMsg = new SiweMessage({
        domain: config.siweDomain,
        address: walletAddressA,
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: config.siweUri,
        version: '1',
        chainId: config.siweChainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageStr = siweMsg.prepareMessage();
      const signature = await testAccountA.signMessage({ message: messageStr });

      // First verification consumes nonce
      const firstRes = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });
      expect(firstRes.status).toBe(200);

      // Reused nonce verification fails
      const reuseRes = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });
      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.error).toBe('UNAUTHORIZED');
    });

    it('should reject signature from wrong wallet with 401 Unauthorized', async () => {
      const nonceRes = await request(app).get('/auth/nonce');
      const nonce = nonceRes.body.nonce;

      const siweMsg = new SiweMessage({
        domain: config.siweDomain,
        address: walletAddressA, // Claims to be Wallet A
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: config.siweUri,
        version: '1',
        chainId: config.siweChainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageStr = siweMsg.prepareMessage();
      // Signed by Wallet B instead of Wallet A
      const signature = await testAccountB.signMessage({ message: messageStr });

      const res = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('should reject domain mismatch with 401 Unauthorized', async () => {
      const nonceRes = await request(app).get('/auth/nonce');
      const nonce = nonceRes.body.nonce;

      const siweMsg = new SiweMessage({
        domain: 'malicious-domain.com', // Wrong domain
        address: walletAddressA,
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: config.siweUri,
        version: '1',
        chainId: config.siweChainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageStr = siweMsg.prepareMessage();
      const signature = await testAccountA.signMessage({ message: messageStr });

      const res = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });

      expect(res.status).toBe(401);
    });

    it('should reject chain ID mismatch with 401 Unauthorized', async () => {
      const nonceRes = await request(app).get('/auth/nonce');
      const nonce = nonceRes.body.nonce;

      const siweMsg = new SiweMessage({
        domain: config.siweDomain,
        address: walletAddressA,
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: config.siweUri,
        version: '1',
        chainId: 1, // Mainnet (1) instead of Sepolia (11155111)
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageStr = siweMsg.prepareMessage();
      const signature = await testAccountA.signMessage({ message: messageStr });

      const res = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });

      expect(res.status).toBe(401);
    });

    it('should return 400 for malformed SIWE message', async () => {
      const res = await request(app).post('/auth/verify').send({
        message: 'invalid siwe string',
        signature: '0x123',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
    });
  });

  describe('GET /auth/me & Session Verification', () => {
    it('should return authenticated user when session cookie is provided', async () => {
      const res = await request(app).get('/auth/me').set('Cookie', [sessionCookieA]);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(userAId);
      expect(res.body.user.walletAddress).toBe(walletAddressA.toLowerCase());
    });

    it('should return authenticated user when Bearer token is provided', async () => {
      const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${sessionIdA}`);

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(userAId);
    });

    it('should return 401 Unauthorized when unauthenticated (no cookie/token)', async () => {
      const res = await request(app).get('/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('should return 401 Unauthorized for expired or invalid session ID', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Cookie', ['agentmesh_session=nonexistent-session-id']);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /auth/logout', () => {
    it('should invalidate current session and clear cookie on logout', async () => {
      const logoutRes = await request(app).post('/auth/logout').set('Cookie', [sessionCookieA]);

      expect(logoutRes.status).toBe(204);

      // Verify session deleted from database
      const dbSession = await prisma.authSession.findUnique({
        where: { id: sessionIdA },
      });
      expect(dbSession).toBeNull();

      // Subsequent /auth/me fails
      const meRes = await request(app).get('/auth/me').set('Cookie', [sessionCookieA]);
      expect(meRes.status).toBe(401);
    });
  });

  describe('Security & Impersonation Prevention', () => {
    it('should enforce that project creation derives ownerId from session context', async () => {
      // Login User B
      const nonceRes = await request(app).get('/auth/nonce');
      const nonce = nonceRes.body.nonce;

      const siweMsg = new SiweMessage({
        domain: config.siweDomain,
        address: walletAddressB,
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: config.siweUri,
        version: '1',
        chainId: config.siweChainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageStr = siweMsg.prepareMessage();
      const signature = await testAccountB.signMessage({ message: messageStr });

      const verifyRes = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });

      const userBId = verifyRes.body.user.id;
      const cookiesB = verifyRes.get('Set-Cookie');

      // Attempt to create a project while logged in as User B, but passing ownerId = userAId (impersonation attempt)
      const projectRes = await request(app)
        .post('/projects')
        .set('Cookie', cookiesB || [])
        .send({
          name: 'Security Test Project',
          description: 'Testing ownerId derivation',
          ownerId: userAId, // Attempted impersonation
        });

      expect(projectRes.status).toBe(201);
      // Project owner must be User B (from session context), ignoring client-supplied userAId!
      expect(projectRes.body.ownerId).toBe(userBId);
      expect(projectRes.body.ownerId).not.toBe(userAId);

      // Clean up test project
      await prisma.project.delete({ where: { id: projectRes.body.id } });
      await prisma.user.delete({ where: { id: userBId } });
    });
  });
});
