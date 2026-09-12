/**
 * PRD-34 ENS Identity Tests
 *
 * Covers test cases 26.1 – 26.14 as defined in the PRD.
 *
 * ENS service unit tests: viem's public client is mocked via vi.mock so that
 * no real RPC calls are made. The mock is reset per-test to keep cases isolated.
 *
 * Agent API integration tests: the ensService singleton is mocked to avoid
 * real RPC, while the full Express / Prisma stack is exercised.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { EnsService } from '../services/ens.service.js';
import { BadRequestError, ForbiddenError, NotFoundError, AppError } from '../errors/app-error.js';

// ──────────────────────────────────────────────────────────────────────────────
// Mock the viem public client used inside EnsService
// ──────────────────────────────────────────────────────────────────────────────

// These are module-level mocks. vi.mock is hoisted, so we cannot reference
// outer-scope let/const variables. Instead we declare them as vi.fn() at the
// top level so they exist when the factory runs.
const mockGetEnsAddress = vi.fn();
const mockGetEnsName = vi.fn();

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  // Note: we cannot reference mockGetEnsAddress/mockGetEnsName directly here
  // because vi.mock is hoisted above the variable declarations at runtime.
  // Instead, we return a factory that looks up the module-level fns lazily.
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      // These are evaluated lazily at call time, not at module parse time.
      getEnsAddress: (...args: unknown[]) => mockGetEnsAddress(...args),
      getEnsName: (...args: unknown[]) => mockGetEnsName(...args),
    })),
  };
});

// ──────────────────────────────────────────────────────────────────────────────
// 26.1 – 26.6 EnsService Unit Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('PRD-34 ENS Service Unit Tests', () => {
  let svc: EnsService;

  beforeEach(() => {
    mockGetEnsAddress.mockReset();
    mockGetEnsName.mockReset();
    svc = new EnsService();
  });

  // 26.1 — ENS normalization
  it('26.1 normalizeName: Alice.ETH normalizes to alice.eth', () => {
    expect(svc.normalizeName('Alice.ETH')).toBe('alice.eth');
  });

  it('26.1 normalizeName: mixed-case subname normalizes correctly', () => {
    expect(svc.normalizeName('Backend.Swastik.ETH')).toBe('backend.swastik.eth');
  });

  it('26.1 normalizeName: malformed name throws BadRequestError', () => {
    // A bare dot or double-dot is rejected by viem's UTS-46 normalize
    expect(() => svc.normalizeName('.')).toThrow(BadRequestError);
  });

  // 26.2 — Successful resolution
  it('26.2 resolveName: alice.eth → 0xABC returns checksummed address', async () => {
    mockGetEnsAddress.mockResolvedValueOnce('0xabc0000000000000000000000000000000000001');

    const result = await svc.resolveName('alice.eth');
    expect(result).toBe('0xABC0000000000000000000000000000000000001');
  });

  // 26.3 — No resolution
  it('26.3 resolveName: unknown.eth → null returns null safely', async () => {
    mockGetEnsAddress.mockResolvedValueOnce(null);

    const result = await svc.resolveName('unknown.eth');
    expect(result).toBeNull();
  });

  // 26.4 — Ownership verification success
  it('26.4 verifyNameOwnership: matching wallet → EnsIdentity returned', async () => {
    const wallet = '0xabc0000000000000000000000000000000000001';
    mockGetEnsAddress.mockResolvedValueOnce(wallet);

    const identity = await svc.verifyNameOwnership('alice.eth', wallet);
    expect(identity.name).toBe('alice.eth');
    expect(identity.address).toMatch(/0xABC/i);
  });

  // 26.5 — Ownership mismatch
  it('26.5 verifyNameOwnership: mismatched wallet → ForbiddenError', async () => {
    mockGetEnsAddress.mockResolvedValueOnce('0xdef0000000000000000000000000000000000002');

    await expect(
      svc.verifyNameOwnership('alice.eth', '0xabc0000000000000000000000000000000000001'),
    ).rejects.toThrow(ForbiddenError);
  });

  // 26.6 — Address case normalization
  it('26.6 normalizeAddress: 0xAbC... matches 0xabc...', () => {
    const a = svc.normalizeAddress('0xAbC0000000000000000000000000000000000001');
    const b = svc.normalizeAddress('0xabc0000000000000000000000000000000000001');
    expect(a).toBe(b);
  });

  it('26.6 verifyNameOwnership: mixed-case address comparison succeeds', async () => {
    mockGetEnsAddress.mockResolvedValueOnce('0xAbC0000000000000000000000000000000000001');

    const identity = await svc.verifyNameOwnership(
      'alice.eth',
      '0xabc0000000000000000000000000000000000001',
    );
    expect(identity).toBeDefined();
  });

  // 26.12 — Reverse resolution
  it('26.12 resolvePrimaryName: address → alice.eth', async () => {
    mockGetEnsName.mockResolvedValueOnce('alice.eth');

    const name = await svc.resolvePrimaryName('0xabc0000000000000000000000000000000000001');
    expect(name).toBe('alice.eth');
  });

  it('26.12 resolvePrimaryName: address with no primary name → null', async () => {
    mockGetEnsName.mockResolvedValueOnce(null);

    const name = await svc.resolvePrimaryName('0xabc0000000000000000000000000000000000001');
    expect(name).toBeNull();
  });

  // 26.13 — ENS provider failure
  it('26.13 resolveName: RPC failure → AppError 503', async () => {
    mockGetEnsAddress.mockRejectedValueOnce(new Error('network timeout'));

    await expect(svc.resolveName('alice.eth')).rejects.toThrow(AppError);
  });

  it('26.13 resolveName: RPC failure carries 503 statusCode', async () => {
    mockGetEnsAddress.mockRejectedValueOnce(new Error('network timeout'));

    await expect(svc.resolveName('alice.eth')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('26.13 verifyNameOwnership: unresolved name → NotFoundError', async () => {
    mockGetEnsAddress.mockResolvedValueOnce(null);

    await expect(
      svc.verifyNameOwnership('unresolved.eth', '0xabc0000000000000000000000000000000000001'),
    ).rejects.toThrow(NotFoundError);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 26.7 – 26.11 Agent API Integration Tests (ENS service mocked at module level)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * For API tests we mock the ensService singleton so no real RPC calls happen,
 * while the full Express + Prisma + auth stack is exercised.
 */

const WALLET_A = '0x1111111111111111111111111111111111111111';
const WALLET_B = '0x2222222222222222222222222222222222222222';

describe('PRD-34 Agent ENS API Integration Tests', () => {
  const app = createApp();

  let userAId: string;
  let userBId: string;
  let cookieA: string;
  let cookieB: string;
  let projectAId: string;
  let projectBId: string;

  // The ensService is imported inside the modules; we spy on the singleton.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ensVerifySpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeAll(async () => {
    // Clean up
    for (const w of [WALLET_A, WALLET_B]) {
      const u = await prisma.user.findUnique({ where: { walletAddress: w } });
      if (u) {
        const ps = await prisma.project.findMany({ where: { ownerId: u.id } });
        for (const p of ps) await prisma.project.delete({ where: { id: p.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
    }

    // Users
    const uA = await prisma.user.create({
      data: { walletAddress: WALLET_A, displayName: 'Alice' },
    });
    userAId = uA.id;
    const sA = await sessionService.createSession(userAId);
    cookieA = `agentmesh_session=${sA.id}`;

    const uB = await prisma.user.create({
      data: { walletAddress: WALLET_B, displayName: 'Bob' },
    });
    userBId = uB.id;
    const sB = await sessionService.createSession(userBId);
    cookieB = `agentmesh_session=${sB.id}`;

    // Projects
    const pA = await request(app).post('/projects').set('Cookie', [cookieA]).send({ name: 'Project Alpha' });
    projectAId = pA.body.id;

    const pB = await request(app).post('/projects').set('Cookie', [cookieB]).send({ name: 'Project Beta' });
    projectBId = pB.body.id;
  });

  afterAll(async () => {
    for (const uid of [userAId, userBId].filter(Boolean)) {
      const ps = await prisma.project.findMany({ where: { ownerId: uid } });
      for (const p of ps) await prisma.project.delete({ where: { id: p.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const { ensService } = await import('../services/ens.service.js');
    ensVerifySpy = vi.spyOn(ensService, 'verifyNameOwnership');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 26.7 — Agent creation without ENS
  it('26.7 create agent without ENS: ENS fields are null', async () => {
    const res = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'Plain Agent', provider: 'claude' });

    expect(res.status).toBe(201);
    expect(res.body.ensName).toBeNull();
    expect(res.body.ensAddress).toBeNull();
    expect(res.body.ensVerifiedAt).toBeNull();
  });

  // 26.8 — Agent creation with valid ENS
  it('26.8 create agent with valid ENS: ENS identity persisted', async () => {
    const checksummedWallet = '0x1111111111111111111111111111111111111111';
    const { ensService } = await import('../services/ens.service.js');
    vi.spyOn(ensService, 'verifyNameOwnership').mockResolvedValueOnce({
      name: 'alice.eth',
      address: checksummedWallet,
    });

    const res = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'ENS Agent', provider: 'claude', ensName: 'alice.eth' });

    expect(res.status).toBe(201);
    expect(res.body.ensName).toBe('alice.eth');
    expect(res.body.ensAddress).toBe(checksummedWallet);
    expect(res.body.ensVerifiedAt).not.toBeNull();
  });

  // 26.9 — Agent creation with invalid ENS (ownership mismatch)
  it('26.9 create agent with mismatched ENS: rejected, no agent created', async () => {
    const { ensService } = await import('../services/ens.service.js');
    vi.spyOn(ensService, 'verifyNameOwnership').mockRejectedValueOnce(
      new ForbiddenError('ENS name "bob.eth" resolves to another wallet'),
    );

    const res = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'Bad ENS Agent', provider: 'claude', ensName: 'bob.eth' });

    expect(res.status).toBe(403);
    // Verify no agent was partially created
    const agents = await prisma.agent.findMany({ where: { name: 'Bad ENS Agent' } });
    expect(agents).toHaveLength(0);
  });

  // 26.9b — Unresolved ENS name → agent creation rejected
  it('26.9b create agent with unresolved ENS: rejected with 404', async () => {
    const { ensService } = await import('../services/ens.service.js');
    vi.spyOn(ensService, 'verifyNameOwnership').mockRejectedValueOnce(
      new NotFoundError('ENS name "unresolved.eth" does not resolve to an address'),
    );

    const res = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'Unresolved ENS Agent', provider: 'claude', ensName: 'unresolved.eth' });

    expect(res.status).toBe(404);
    const agents = await prisma.agent.findMany({ where: { name: 'Unresolved ENS Agent' } });
    expect(agents).toHaveLength(0);
  });

  // 26.10 — Cross-user agent modification
  it('26.10 cross-user ENS attachment: User B cannot modify User A agent', async () => {
    // Create an agent owned by User A
    const create = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'Alice Exclusive Agent', provider: 'claude' });
    const agentId = create.body.id;

    // Add User B as member of Project A so membership check passes, but agent ownership is still A's
    await request(app)
      .post(`/projects/${projectAId}/members`)
      .set('Cookie', [cookieA])
      .send({ userId: userBId, role: 'MEMBER' });

    // User B tries to attach ENS — ENS spy should NOT be called because B IS a member,
    // but the ENS resolves to B's wallet not A's
    const { ensService } = await import('../services/ens.service.js');
    vi.spyOn(ensService, 'verifyNameOwnership').mockRejectedValueOnce(
      new ForbiddenError('ENS resolves to a different wallet'),
    );

    const res = await request(app)
      .patch(`/agents/${agentId}`)
      .set('Cookie', [cookieB])
      .send({ ensName: 'bob.eth' });

    expect(res.status).toBe(403);

    // Agent ENS fields must remain unchanged
    const unchanged = await prisma.agent.findUnique({ where: { id: agentId } });
    expect(unchanged?.ensName).toBeNull();
  });

  // 26.11 — Cross-project attack
  it('26.11 cross-project ENS mutation: User A cannot modify Project B agent', async () => {
    const createB = await request(app)
      .post(`/projects/${projectBId}/agents`)
      .set('Cookie', [cookieB])
      .send({ name: 'Beta Agent', provider: 'gemini' });
    const betaAgentId = createB.body.id;

    const res = await request(app)
      .patch(`/agents/${betaAgentId}`)
      .set('Cookie', [cookieA])
      .send({ ensName: 'alice.eth' });

    expect(res.status).toBe(403);
    // ENS service should NOT have been called — authorization check fires first
    expect(ensVerifySpy).not.toHaveBeenCalled();
  });

  // GET /agents/:agentId/identity endpoint
  it('GET /agents/:agentId/identity: returns ENS fields correctly', async () => {
    const { ensService } = await import('../services/ens.service.js');
    vi.spyOn(ensService, 'verifyNameOwnership').mockResolvedValueOnce({
      name: 'identity.eth',
      address: '0x1111111111111111111111111111111111111111',
    });

    const createRes = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'Identity Agent', provider: 'claude', ensName: 'identity.eth' });

    const agentId = createRes.body.id;

    const identityRes = await request(app)
      .get(`/agents/${agentId}/identity`)
      .set('Cookie', [cookieA]);

    expect(identityRes.status).toBe(200);
    expect(identityRes.body.agentId).toBe(agentId);
    expect(identityRes.body.ensName).toBe('identity.eth');
    expect(identityRes.body.verified).toBe(true);
    expect(identityRes.body.verifiedAt).not.toBeNull();
  });

  it('GET /agents/:agentId/identity: no ENS → verified false, all null', async () => {
    const createRes = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'No Identity Agent', provider: 'claude' });
    const agentId = createRes.body.id;

    const identityRes = await request(app)
      .get(`/agents/${agentId}/identity`)
      .set('Cookie', [cookieA]);

    expect(identityRes.status).toBe(200);
    expect(identityRes.body.ensName).toBeNull();
    expect(identityRes.body.ensAddress).toBeNull();
    expect(identityRes.body.verified).toBe(false);
  });

  // ENS removal via PATCH
  it('PATCH ensName=null: removes ENS identity', async () => {
    const { ensService } = await import('../services/ens.service.js');
    vi.spyOn(ensService, 'verifyNameOwnership').mockResolvedValueOnce({
      name: 'remove.eth',
      address: '0x1111111111111111111111111111111111111111',
    });

    const createRes = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'Remove ENS Agent', provider: 'claude', ensName: 'remove.eth' });
    const agentId = createRes.body.id;
    expect(createRes.body.ensName).toBe('remove.eth');

    const patchRes = await request(app)
      .patch(`/agents/${agentId}`)
      .set('Cookie', [cookieA])
      .send({ ensName: null });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.ensName).toBeNull();
    expect(patchRes.body.ensAddress).toBeNull();
    expect(patchRes.body.ensVerifiedAt).toBeNull();
  });

  // ENS provider failure during agent creation
  it('26.13b ENS provider failure → 503, agent not created', async () => {
    const { ensService } = await import('../services/ens.service.js');
    vi.spyOn(ensService, 'verifyNameOwnership').mockRejectedValueOnce(
      new AppError('ENS resolution failed: provider unavailable', 503, 'ENS_UNAVAILABLE'),
    );

    const res = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'Timeout ENS Agent', provider: 'claude', ensName: 'timeout.eth' });

    expect(res.status).toBe(503);
    const agents = await prisma.agent.findMany({ where: { name: 'Timeout ENS Agent' } });
    expect(agents).toHaveLength(0);
  });

  // Client-supplied ensAddress must be silently ignored
  it('Client-supplied ensAddress is never used — always re-resolved', async () => {
    const { ensService } = await import('../services/ens.service.js');
    vi.spyOn(ensService, 'verifyNameOwnership').mockResolvedValueOnce({
      name: 'real.eth',
      address: '0x1111111111111111111111111111111111111111',
    });

    const res = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({
        name: 'Sneaky Agent',
        provider: 'claude',
        ensName: 'real.eth',
        ensAddress: '0xDeadBeef0000000000000000000000000000000', // should be stripped
        ensVerifiedAt: '2020-01-01T00:00:00.000Z', // should be stripped
      });

    expect(res.status).toBe(201);
    // Address comes from the spy mock, not from client
    expect(res.body.ensAddress).toBe('0x1111111111111111111111111111111111111111');
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // PRD-34-C1 Security Regression Tests
  // ──────────────────────────────────────────────────────────────────────────────

  // Test A — ownerId spoof attempt
  it('Test A: client-supplied ownerId is ignored; persisted ownerId always equals actorUserId', async () => {
    const res = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA]) // authenticated as User A
      .send({
        name: 'spoof-test',
        provider: 'test',
        ownerId: userBId, // attacker tries to impersonate User B
      });

    expect(res.status).toBe(201);
    // Must be User A's id, NOT User B's
    expect(res.body.ownerId).toBe(userAId);
    expect(res.body.ownerId).not.toBe(userBId);
  });

  // Test B — ENS spoof fields
  it('Test B: client-supplied ensAddress and ensVerifiedAt are always stripped', async () => {
    // No ENS name supplied — so ensService.verifyNameOwnership should NOT be called
    const res = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({
        name: 'ens-spoof-test',
        provider: 'test',
        ensAddress: '0xAttackerAddress000000000000000000000001',
        ensVerifiedAt: '2020-01-01T00:00:00.000Z',
      });

    expect(res.status).toBe(201);
    // Client-supplied ensAddress must NOT appear in the persisted record
    expect(res.body.ensAddress).toBeNull();
    expect(res.body.ensVerifiedAt).toBeNull();
    expect(res.body.ensName).toBeNull();
  });

  // Test C — cross-project ownership regression (existing behavior preserved)
  it('Test C: user not in project cannot modify another project\'s agent (403 preserved)', async () => {
    // Agent in Project A owned by User A (verifies Test A fix also holds here)
    const createResA = await request(app)
      .post(`/projects/${projectAId}/agents`)
      .set('Cookie', [cookieA])
      .send({ name: 'cross-user-c1-agent', provider: 'test' });
    expect(createResA.body.ownerId).toBe(userAId);

    // User B is NOT a member of projectA yet in this scenario —
    // but they WERE added in test 26.10. So use a third project approach:
    // Create a fresh project owned only by B and verify A cannot touch B's agents.
    const createBRes = await request(app)
      .post(`/projects/${projectBId}/agents`)
      .set('Cookie', [cookieB])
      .send({ name: 'b-only-agent', provider: 'test' });
    const bAgentId = createBRes.body.id;
    expect(createBRes.body.ownerId).toBe(userBId);

    // User A tries to modify User B's agent in Project B — A is not a member of B
    const res = await request(app)
      .patch(`/agents/${bAgentId}`)
      .set('Cookie', [cookieA])
      .send({ name: 'hacked' });

    expect(res.status).toBe(403);

    // Agent name must remain unchanged
    const unchanged = await prisma.agent.findUnique({ where: { id: bAgentId } });
    expect(unchanged?.name).toBe('b-only-agent');
  });
});

