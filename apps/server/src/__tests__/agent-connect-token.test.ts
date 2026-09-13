import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { agentConnectTokenService } from '../services/agent-connect-token.service.js';

describe('PRD-73-C1 Agent Connect Token Integration & Regression Tests', () => {
  const app = createApp();

  const ownerWallet = '0xtokenowner1111111111111111111111111111111';
  const memberWallet = '0xtokenmember2222222222222222222222222222';
  const strangerWallet = '0xtokenstranger3333333333333333333333333';

  let ownerId: string;
  let memberId: string;
  let strangerId: string;

  let ownerCookie: string;
  let memberCookie: string;
  let strangerCookie: string;

  let projectId: string;
  let agentId: string;

  beforeAll(async () => {
    // Clean up test data if existing
    await prisma.agentConnectToken.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.projectWorkspace.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany({
      where: { walletAddress: { in: [ownerWallet, memberWallet, strangerWallet] } },
    });

    // Create Owner User
    const owner = await prisma.user.create({
      data: { walletAddress: ownerWallet, displayName: 'Token Owner' },
    });
    ownerId = owner.id;
    const sessOwner = await sessionService.createSession(ownerId);
    ownerCookie = `agentmesh_session=${sessOwner.id}`;

    // Create Member User
    const member = await prisma.user.create({
      data: { walletAddress: memberWallet, displayName: 'Project Member' },
    });
    memberId = member.id;
    const sessMember = await sessionService.createSession(memberId);
    memberCookie = `agentmesh_session=${sessMember.id}`;

    // Create Stranger User
    const stranger = await prisma.user.create({
      data: { walletAddress: strangerWallet, displayName: 'Stranger' },
    });
    strangerId = stranger.id;
    const sessStranger = await sessionService.createSession(strangerId);
    strangerCookie = `agentmesh_session=${sessStranger.id}`;

    // Create Project owned by Owner
    const project = await prisma.project.create({
      data: {
        name: 'Connect Token Project',
        ownerId,
        members: {
          create: [
            { userId: ownerId, role: 'OWNER' },
            { userId: memberId, role: 'MEMBER' },
          ],
        },
      },
    });
    projectId = project.id;

    // Create Agent owned by Owner
    const agent = await prisma.agent.create({
      data: {
        projectId,
        ownerId,
        name: 'Swastik Codex',
        provider: 'Codex',
        status: 'OFFLINE',
      },
    });
    agentId = agent.id;
  });

  afterAll(async () => {
    await prisma.agentConnectToken.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.projectWorkspace.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany({
      where: { walletAddress: { in: [ownerWallet, memberWallet, strangerWallet] } },
    });
  });

  it('Test 1 — Owner can mint connect token', async () => {
    const res = await request(app)
      .post(`/agents/${agentId}/connect-token`)
      .set('Cookie', ownerCookie)
      .send({})
      .expect(201);

    expect(res.body.token).toBeDefined();
    expect(res.body.token).toMatch(/^amct_/);
    expect(res.body.agentId).toBe(agentId);
    expect(res.body.projectId).toBe(projectId);
    expect(res.body.expiresAt).toBeDefined();

    const expiresAt = new Date(res.body.expiresAt);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('Test 2 — Non-owner project member cannot mint connect token', async () => {
    const res = await request(app)
      .post(`/agents/${agentId}/connect-token`)
      .set('Cookie', memberCookie)
      .send({})
      .expect(403);

    expect(res.body.message).toContain('not owned by the authenticated user');
  });

  it('Test 2b — Non-project member cannot mint connect token', async () => {
    await request(app)
      .post(`/agents/${agentId}/connect-token`)
      .set('Cookie', strangerCookie)
      .send({})
      .expect(403);
  });

  it('Test 3 — Unknown agent returns 404', async () => {
    const res = await request(app)
      .post('/agents/nonexistent_agent_999/connect-token')
      .set('Cookie', ownerCookie)
      .send({})
      .expect(404);

    expect(res.body.message).toContain('not found');
  });

  it('Test 4 — Token is persisted as SHA-256 hash in database', async () => {
    const mintRes = await request(app)
      .post(`/agents/${agentId}/connect-token`)
      .set('Cookie', ownerCookie)
      .send({})
      .expect(201);

    const plaintextToken = mintRes.body.token;
    const expectedHash = crypto.createHash('sha256').update(plaintextToken, 'utf8').digest('hex');

    // Query database directly
    const dbRecord = await prisma.agentConnectToken.findUnique({
      where: { tokenHash: expectedHash },
    });

    expect(dbRecord).not.toBeNull();
    expect(dbRecord?.agentId).toBe(agentId);
    expect(dbRecord?.projectId).toBe(projectId);
    expect(dbRecord?.issuedByUserId).toBe(ownerId);

    // Verify raw plaintext token is NOT stored anywhere in database
    const allRecords = await prisma.agentConnectToken.findMany({
      where: { agentId },
    });
    const foundPlaintext = allRecords.some((r) => r.tokenHash === plaintextToken);
    expect(foundPlaintext).toBe(false);
  });

  it('Test 5 — Token resolves successfully via service', async () => {
    const mintRes = await request(app)
      .post(`/agents/${agentId}/connect-token`)
      .set('Cookie', ownerCookie)
      .send({})
      .expect(201);

    const resolved = await agentConnectTokenService.resolve(mintRes.body.token);
    expect(resolved.agentId).toBe(agentId);
    expect(resolved.projectId).toBe(projectId);
    expect(resolved.issuedByUserId).toBe(ownerId);
  });

  it('Test 6 — Full Workboard flow simulation: register agent -> connect token -> command string format', async () => {
    // 1. Register agent
    const regRes = await request(app)
      .post(`/projects/${projectId}/agents`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Workboard Agent', provider: 'Claude' })
      .expect(201);

    const newAgentId = regRes.body.id;

    // 2. Issue connect token
    const tokenRes = await request(app)
      .post(`/agents/${newAgentId}/connect-token`)
      .set('Cookie', ownerCookie)
      .send({})
      .expect(201);

    // 3. Format command as rendered in AgentConnectPanel
    const command = `npx agentmesh connect --workspace ${tokenRes.body.projectId} --agent ${tokenRes.body.agentId} --connect-token ${tokenRes.body.token}`;

    expect(command).toContain(`--workspace ${projectId}`);
    expect(command).toContain(`--agent ${newAgentId}`);
    expect(command).toContain(`--connect-token ${tokenRes.body.token}`);
  });
});
