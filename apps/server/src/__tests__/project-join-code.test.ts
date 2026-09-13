/**
 * Workspace join codes: the owner shares one code, and everyone who redeems it
 * ends up in the same workspace and can work in it.
 *
 * The code is a credential, so the tests care as much about who cannot read it
 * as about the happy path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';

const OWNER_WALLET = '0x00000000000000000000000000000000000c0001';
const MATE_WALLET = '0x00000000000000000000000000000000000c0002';
const STRANGER_WALLET = '0x00000000000000000000000000000000000c0003';

describe('Workspace join codes', () => {
  const app = createApp();

  let ownerId = '';
  let mateId = '';
  let strangerId = '';
  let ownerCookie = '';
  let mateCookie = '';
  let strangerCookie = '';
  let projectId = '';

  beforeAll(async () => {
    for (const wallet of [OWNER_WALLET, MATE_WALLET, STRANGER_WALLET]) {
      const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
      if (user) {
        await prisma.project.deleteMany({ where: { ownerId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }

    const owner = await prisma.user.create({ data: { walletAddress: OWNER_WALLET } });
    ownerId = owner.id;
    ownerCookie = `agentmesh_session=${(await sessionService.createSession(ownerId)).id}`;

    const mate = await prisma.user.create({ data: { walletAddress: MATE_WALLET } });
    mateId = mate.id;
    mateCookie = `agentmesh_session=${(await sessionService.createSession(mateId)).id}`;

    const stranger = await prisma.user.create({ data: { walletAddress: STRANGER_WALLET } });
    strangerId = stranger.id;
    strangerCookie = `agentmesh_session=${(await sessionService.createSession(strangerId)).id}`;

    const project = await request(app)
      .post('/projects')
      .set('Cookie', [ownerCookie])
      .send({ name: 'Shared Workspace' });
    projectId = project.body.id;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { ownerId: { in: [ownerId, mateId, strangerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, mateId, strangerId] } } });
    await prisma.$disconnect();
  });

  const getCode = async (cookie: string) =>
    request(app).get(`/projects/${projectId}/join-code`).set('Cookie', [cookie]);

  it('never returns the join code in an ordinary project response', async () => {
    const created = await request(app)
      .post('/projects')
      .set('Cookie', [ownerCookie])
      .send({ name: 'Leak check' });
    expect(created.body).not.toHaveProperty('joinCode');

    const fetched = await request(app)
      .get(`/projects/${created.body.id}`)
      .set('Cookie', [ownerCookie]);
    expect(fetched.body).not.toHaveProperty('joinCode');

    const listed = await request(app).get('/projects').set('Cookie', [ownerCookie]);
    for (const row of listed.body.projects ?? listed.body) {
      expect(row).not.toHaveProperty('joinCode');
    }

    await prisma.project.delete({ where: { id: created.body.id } });
  });

  it('gives the owner a code, and the same code on a second read', async () => {
    const first = await getCode(ownerCookie);
    expect(first.status).toBe(200);
    expect(first.body.joinCode).toMatch(/^MESH-[A-Z0-9]+$/);

    const second = await getCode(ownerCookie);
    expect(second.body.joinCode).toBe(first.body.joinCode);
  });

  it('does not let a non-member read the code', async () => {
    const res = await getCode(strangerCookie);
    expect(res.status).toBe(403);
  });

  it('puts two people in the same workspace from one code', async () => {
    const code = (await getCode(ownerCookie)).body.joinCode;

    const joined = await request(app)
      .post('/projects/join')
      .set('Cookie', [mateCookie])
      .send({ code });

    expect(joined.status).toBe(200);
    expect(joined.body.project.id).toBe(projectId);

    const mateProjects = await request(app).get('/projects').set('Cookie', [mateCookie]);
    const rows = mateProjects.body.projects ?? mateProjects.body;
    expect(rows.some((p: { id: string }) => p.id === projectId)).toBe(true);
  });

  it('accepts the code regardless of case, and joining twice is not an error', async () => {
    const code: string = (await getCode(ownerCookie)).body.joinCode;

    const again = await request(app)
      .post('/projects/join')
      .set('Cookie', [mateCookie])
      .send({ code: code.toLowerCase() });

    expect(again.status).toBe(200);
    const memberships = await prisma.projectMember.findMany({
      where: { projectId, userId: mateId },
    });
    expect(memberships).toHaveLength(1);
  });

  it('lets someone who joined by code create an agent the owner can see', async () => {
    const created = await request(app)
      .post(`/projects/${projectId}/agents`)
      .set('Cookie', [mateCookie])
      .send({ name: 'mate-agent', provider: 'claude' });

    expect(created.status).toBe(201);

    const asOwner = await request(app)
      .get(`/projects/${projectId}/agents`)
      .set('Cookie', [ownerCookie]);
    const rows = asOwner.body.agents ?? asOwner.body;
    expect(rows.some((a: { id: string }) => a.id === created.body.id)).toBe(true);
  });

  it('rejects a code that matches no workspace', async () => {
    const res = await request(app)
      .post('/projects/join')
      .set('Cookie', [strangerCookie])
      .send({ code: 'MESH-NOTAREALCODE' });

    expect(res.status).toBe(404);
  });

  it('rejects an empty code', async () => {
    const res = await request(app)
      .post('/projects/join')
      .set('Cookie', [strangerCookie])
      .send({ code: '   ' });

    expect(res.status).toBe(400);
  });

  it('stops the old code working once the owner rotates it', async () => {
    const oldCode = (await getCode(ownerCookie)).body.joinCode;

    const rotated = await request(app)
      .post(`/projects/${projectId}/join-code/rotate`)
      .set('Cookie', [ownerCookie]);
    expect(rotated.status).toBe(200);
    expect(rotated.body.joinCode).not.toBe(oldCode);

    const stale = await request(app)
      .post('/projects/join')
      .set('Cookie', [strangerCookie])
      .send({ code: oldCode });
    expect(stale.status).toBe(404);

    const fresh = await request(app)
      .post('/projects/join')
      .set('Cookie', [strangerCookie])
      .send({ code: rotated.body.joinCode });
    expect(fresh.status).toBe(200);
  });

  it('does not let a plain member rotate the code', async () => {
    const res = await request(app)
      .post(`/projects/${projectId}/join-code/rotate`)
      .set('Cookie', [mateCookie]);

    expect(res.status).toBe(403);
  });
});
