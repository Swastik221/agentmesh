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

    it('should NOT consume a valid nonce when signature verification fails', async () => {
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
      const invalidSignature = await testAccountB.signMessage({ message: messageStr });

      const res = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature: invalidSignature,
      });

      expect(res.status).toBe(401);

      // Verify nonce is NOT consumed when signature is invalid
      const dbNonce = await prisma.siweNonce.findUnique({
        where: { nonce },
      });
      expect(dbNonce).not.toBeNull();
      expect(dbNonce?.nonce).toBe(nonce);
    });

    it('should consume a valid nonce exactly once upon successful signature verification', async () => {
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

      // First verification succeeds
      const firstRes = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });
      expect(firstRes.status).toBe(200);

      // Nonce is deleted in DB
      const dbNonce = await prisma.siweNonce.findUnique({ where: { nonce } });
      expect(dbNonce).toBeNull();

      // Second verification attempt with same nonce fails
      const secondRes = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });
      expect(secondRes.status).toBe(401);
      expect(secondRes.body.error).toBe('UNAUTHORIZED');
    });

    it('should atomically handle concurrent verification attempts using the same nonce (exactly 1 succeeds and 1 fails)', async () => {
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

      // Fire two concurrent verification requests with exact same payload
      const [res1, res2] = await Promise.all([
        request(app).post('/auth/verify').send({ message: messageStr, signature }),
        request(app).post('/auth/verify').send({ message: messageStr, signature }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one 200 (Success) and one 401 (Unauthorized)
      expect(statuses).toEqual([200, 401]);

      // Nonce is consumed
      const dbNonce = await prisma.siweNonce.findUnique({ where: { nonce } });
      expect(dbNonce).toBeNull();
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

  describe('SIWE Extended Validation & Concurrent Login', () => {
    it('should reject URI mismatch with 401 Unauthorized', async () => {
      const nonceRes = await request(app).get('/auth/nonce');
      const nonce = nonceRes.body.nonce;

      const siweMsg = new SiweMessage({
        domain: config.siweDomain,
        address: walletAddressA,
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: 'https://malicious-uri.com/login', // Wrong URI
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

    it('should reject expired SIWE nonce with 401 Unauthorized', async () => {
      const nonceRes = await request(app).get('/auth/nonce');
      const nonce = nonceRes.body.nonce;

      // Manually set expiresAt in past
      await prisma.siweNonce.update({
        where: { nonce },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

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

      const res = await request(app).post('/auth/verify').send({
        message: messageStr,
        signature,
      });

      expect(res.status).toBe(401);
    });

    it('should safely handle concurrent first login for the same wallet (creates exactly one User)', async () => {
      const newAccount = privateKeyToAccount(generatePrivateKey());
      const newWallet = newAccount.address;

      const [nonceRes1, nonceRes2] = await Promise.all([
        request(app).get('/auth/nonce'),
        request(app).get('/auth/nonce'),
      ]);

      const siweMsg1 = new SiweMessage({
        domain: config.siweDomain,
        address: newWallet,
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: config.siweUri,
        version: '1',
        chainId: config.siweChainId,
        nonce: nonceRes1.body.nonce,
        issuedAt: new Date().toISOString(),
      });
      const siweMsg2 = new SiweMessage({
        domain: config.siweDomain,
        address: newWallet,
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: config.siweUri,
        version: '1',
        chainId: config.siweChainId,
        nonce: nonceRes2.body.nonce,
        issuedAt: new Date().toISOString(),
      });

      const msgStr1 = siweMsg1.prepareMessage();
      const msgStr2 = siweMsg2.prepareMessage();
      const sig1 = await newAccount.signMessage({ message: msgStr1 });
      const sig2 = await newAccount.signMessage({ message: msgStr2 });

      const [res1, res2] = await Promise.all([
        request(app).post('/auth/verify').send({ message: msgStr1, signature: sig1 }),
        request(app).post('/auth/verify').send({ message: msgStr2, signature: sig2 }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.user.id).toBe(res2.body.user.id);

      // Verify database contains exactly 1 user for this wallet
      const count = await prisma.user.count({
        where: { walletAddress: newWallet.toLowerCase() },
      });
      expect(count).toBe(1);

      await prisma.user.delete({ where: { id: res1.body.user.id } });
    });

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
      const setCookiesB = verifyRes.get('Set-Cookie');
      const cookieBVal = setCookiesB ? setCookiesB[0].split(';')[0] : '';

      // Attempt to create a project while logged in as User B, but passing ownerId = userAId (impersonation attempt)
      const projectRes = await request(app)
        .post('/projects')
        .set('Cookie', [cookieBVal])
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

  describe('Cross-Project Authorization Enforcement', () => {
    let projectAId: string;
    let projectBId: string;
    let userBId: string;
    let cookieB: string;

    let cookieA: string;

    beforeAll(async () => {
      // User A logs in
      const nonceResA = await request(app).get('/auth/nonce');
      const siweMsgA = new SiweMessage({
        domain: config.siweDomain,
        address: walletAddressA,
        statement: 'Sign in with Ethereum to AgentMesh.',
        uri: config.siweUri,
        version: '1',
        chainId: config.siweChainId,
        nonce: nonceResA.body.nonce,
        issuedAt: new Date().toISOString(),
      });
      const msgStrA = siweMsgA.prepareMessage();
      const sigA = await testAccountA.signMessage({ message: msgStrA });
      const verifyResA = await request(app).post('/auth/verify').send({
        message: msgStrA,
        signature: sigA,
      });
      const setCookieA = verifyResA.get('Set-Cookie');
      cookieA = setCookieA ? setCookieA[0].split(';')[0] : '';

      // User A creates Project A
      const projA = await request(app)
        .post('/projects')
        .set('Cookie', [cookieA])
        .send({ name: 'Project A Auth Test' });
      projectAId = projA.body.id;

      // User B logs in and creates Project B
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
      const msgStr = siweMsg.prepareMessage();
      const sig = await testAccountB.signMessage({ message: msgStr });
      const verifyRes = await request(app).post('/auth/verify').send({
        message: msgStr,
        signature: sig,
      });

      userBId = verifyRes.body.user.id;
      const setCookieB = verifyRes.get('Set-Cookie');
      cookieB = setCookieB ? setCookieB[0].split(';')[0] : '';

      const projB = await request(app)
        .post('/projects')
        .set('Cookie', [cookieB])
        .send({ name: 'Project B Auth Test' });
      projectBId = projB.body.id;
    });

    afterAll(async () => {
      if (projectAId) await prisma.project.delete({ where: { id: projectAId } }).catch(() => {});
      if (projectBId) await prisma.project.delete({ where: { id: projectBId } }).catch(() => {});
      if (userBId) await prisma.user.delete({ where: { id: userBId } }).catch(() => {});
    });

    it('should allow User A to access Project A, but reject User B with 403 Forbidden', async () => {
      const resA = await request(app).get(`/projects/${projectAId}`).set('Cookie', [cookieA]);
      expect(resA.status).toBe(200);

      const resB = await request(app).get(`/projects/${projectAId}`).set('Cookie', [cookieB]);
      expect(resB.status).toBe(403);
    });

    it('should reject unauthenticated request to /projects/:projectId with 401 Unauthorized', async () => {
      const res = await request(app).get(`/projects/${projectAId}`);
      expect(res.status).toBe(401);
    });

    it('should reject User B creating an agent in User A Project A with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/projects/${projectAId}/agents`)
        .set('Cookie', [cookieB])
        .send({
          name: 'Unauthorized Agent',
          provider: 'openai',
        });
      expect(res.status).toBe(403);
    });
  });
});
