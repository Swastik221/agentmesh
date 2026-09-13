/**
 * Shared task board: open offers, agent self-claim, and auto assignment.
 *
 * Exercises the real Express + Prisma stack rather than mocking the services,
 * because what matters here is that an offer ends in the same real
 * TaskResponsibility row every other assignment path produces.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { taskOfferService } from '../services/task-offer.service.js';

const OWNER_WALLET = '0x00000000000000000000000000000000000f0001';
const OUTSIDER_WALLET = '0x00000000000000000000000000000000000f0002';

describe('Shared task board offers', () => {
  const app = createApp();

  let ownerId = '';
  let outsiderId = '';
  let ownerCookie = '';
  let outsiderCookie = '';
  let projectId = '';
  const agents: Record<string, string> = {};

  const wipeWallets = async () => {
    for (const wallet of [OWNER_WALLET, OUTSIDER_WALLET]) {
      const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
      if (user) {
        await prisma.project.deleteMany({ where: { ownerId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }
  };

  beforeAll(async () => {
    await wipeWallets();

    const owner = await prisma.user.create({
      data: { walletAddress: OWNER_WALLET, displayName: 'Board Owner' },
    });
    ownerId = owner.id;
    ownerCookie = `agentmesh_session=${(await sessionService.createSession(ownerId)).id}`;

    const outsider = await prisma.user.create({ data: { walletAddress: OUTSIDER_WALLET } });
    outsiderId = outsider.id;
    outsiderCookie = `agentmesh_session=${(await sessionService.createSession(outsiderId)).id}`;

    const project = await request(app)
      .post('/projects')
      .set('Cookie', [ownerCookie])
      .send({ name: 'Board Project' });
    projectId = project.body.id;

    for (const name of ['alpha', 'beta', 'gamma']) {
      const created = await request(app)
        .post(`/projects/${projectId}/agents`)
        .set('Cookie', [ownerCookie])
        .send({ name, provider: 'claude' });
      agents[name] = created.body.id;
    }
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Every test starts with three online, idle agents and an empty board.
    await prisma.taskResponsibility.deleteMany({ where: { task: { projectId } } });
    await prisma.task.deleteMany({ where: { projectId } });
    await prisma.agent.updateMany({ where: { projectId }, data: { status: 'ONLINE' } });
  });

  const postOffer = (body: Record<string, unknown>) =>
    request(app).post(`/projects/${projectId}/tasks/offers`).set('Cookie', [ownerCookie]).send(body);

  it('posts a task to the board with an auto assign deadline and no owner', async () => {
    const res = await postOffer({ title: 'write the changelog', offerSeconds: 60 });

    expect(res.status).toBe(201);
    expect(res.body.offerExpiresAt).toBeTruthy();

    const stored = await prisma.task.findUnique({
      where: { id: res.body.id },
      include: { responsibilities: true },
    });
    expect(stored?.responsibilities).toHaveLength(0);
    expect(new Date(stored!.offerExpiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('announces the offer so connected agents are actually told about it', async () => {
    const res = await postOffer({ title: 'tell everyone', offerSeconds: 60 });

    const announcement = await prisma.activityEvent.findFirst({
      where: { projectId, taskId: res.body.id, type: 'task.offered' },
    });
    expect(announcement).not.toBeNull();
  });

  it('rejects an offer window outside the allowed range', async () => {
    await expect(postOffer({ title: 'too long', offerSeconds: 99999 })).resolves.toMatchObject({
      status: 400,
    });
    await expect(postOffer({ title: 'too short', offerSeconds: 1 })).resolves.toMatchObject({
      status: 400,
    });
  });

  it('rejects an empty title', async () => {
    const res = await postOffer({ title: '   ', offerSeconds: 30 });
    expect(res.status).toBe(400);
  });

  it('does not let a non-member post to the board', async () => {
    const res = await request(app)
      .post(`/projects/${projectId}/tasks/offers`)
      .set('Cookie', [outsiderCookie])
      .send({ title: 'not mine', offerSeconds: 30 });

    expect(res.status).toBe(403);
  });

  it('lets an agent take an open offer, and records it as self claimed', async () => {
    const offer = await postOffer({ title: 'claim me', offerSeconds: 60 });

    const claim = await request(app)
      .post(`/projects/${projectId}/tasks/${offer.body.id}/claim`)
      .set('Cookie', [ownerCookie])
      .send({ agentId: agents.beta });

    expect(claim.status).toBe(201);
    expect(claim.body.agentId).toBe(agents.beta);
    expect(claim.body.assignmentSource).toBe('SELF_CLAIMED');
  });

  it('closes the offer once it is claimed, so the sweeper cannot take it again', async () => {
    const offer = await postOffer({ title: 'closed after claim', offerSeconds: 60 });
    await request(app)
      .post(`/projects/${projectId}/tasks/${offer.body.id}/claim`)
      .set('Cookie', [ownerCookie])
      .send({ agentId: agents.alpha });

    const stored = await prisma.task.findUnique({ where: { id: offer.body.id } });
    expect(stored?.offerExpiresAt).toBeNull();

    const swept = await taskOfferService.sweepDueOffers(new Date(Date.now() + 600000));
    expect(swept.some((r) => r.taskId === offer.body.id)).toBe(false);
  });

  it('gives a task to exactly one agent when two claim it', async () => {
    const offer = await postOffer({ title: 'contested', offerSeconds: 60 });

    const first = await request(app)
      .post(`/projects/${projectId}/tasks/${offer.body.id}/claim`)
      .set('Cookie', [ownerCookie])
      .send({ agentId: agents.alpha });
    const second = await request(app)
      .post(`/projects/${projectId}/tasks/${offer.body.id}/claim`)
      .set('Cookie', [ownerCookie])
      .send({ agentId: agents.gamma });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);

    const owners = await prisma.taskResponsibility.findMany({ where: { taskId: offer.body.id } });
    expect(owners).toHaveLength(1);
    expect(owners[0].agentId).toBe(agents.alpha);
  });

  it('auto assigns an offer nobody claimed once its window has passed', async () => {
    const offer = await postOffer({ title: 'nobody wants it', offerSeconds: 5 });

    const swept = await taskOfferService.sweepDueOffers(new Date(Date.now() + 10000));
    const outcome = swept.find((r) => r.taskId === offer.body.id);

    expect(outcome?.assignedAgentId).toBeTruthy();
    const owners = await prisma.taskResponsibility.findMany({ where: { taskId: offer.body.id } });
    expect(owners).toHaveLength(1);
  });

  it('leaves an offer alone while its window is still open', async () => {
    const offer = await postOffer({ title: 'still open', offerSeconds: 300 });

    await taskOfferService.sweepDueOffers(new Date());

    const owners = await prisma.taskResponsibility.findMany({ where: { taskId: offer.body.id } });
    expect(owners).toHaveLength(0);
  });

  it('does not auto assign to an agent that already holds unfinished work', async () => {
    // alpha and gamma are busy: one with an unstarted task, one running.
    const held = await postOffer({ title: 'alpha is on this', offerSeconds: 60 });
    await request(app)
      .post(`/projects/${projectId}/tasks/${held.body.id}/claim`)
      .set('Cookie', [ownerCookie])
      .send({ agentId: agents.alpha });

    const running = await postOffer({ title: 'gamma is on this', offerSeconds: 60 });
    await request(app)
      .post(`/projects/${projectId}/tasks/${running.body.id}/claim`)
      .set('Cookie', [ownerCookie])
      .send({ agentId: agents.gamma });

    const offer = await postOffer({ title: 'only beta is free', offerSeconds: 5 });
    const swept = await taskOfferService.sweepDueOffers(new Date(Date.now() + 10000));

    expect(swept.find((r) => r.taskId === offer.body.id)?.assignedAgentId).toBe(agents.beta);
  });

  it('keeps an offer on the board when no agent is free, rather than dropping it', async () => {
    await prisma.agent.updateMany({ where: { projectId }, data: { status: 'OFFLINE' } });
    const offer = await postOffer({ title: 'nobody home', offerSeconds: 5 });

    const swept = await taskOfferService.sweepDueOffers(new Date(Date.now() + 10000));
    expect(swept.find((r) => r.taskId === offer.body.id)?.assignedAgentId).toBeUndefined();

    const stored = await prisma.task.findUnique({ where: { id: offer.body.id } });
    // Still an open offer, with its deadline pushed out for a later retry.
    expect(stored?.offerExpiresAt).not.toBeNull();
    expect(new Date(stored!.offerExpiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('spreads auto assignments across agents that are equally free', async () => {
    const picked = new Set<string>();

    for (let round = 0; round < 25; round += 1) {
      const offer = await postOffer({ title: `spread ${round}`, offerSeconds: 5 });
      const swept = await taskOfferService.sweepDueOffers(new Date(Date.now() + 10000));
      const chosen = swept.find((r) => r.taskId === offer.body.id)?.assignedAgentId;
      if (chosen) picked.add(chosen);
      // Free everyone again so each round draws from the same idle pool.
      await prisma.taskResponsibility.deleteMany({ where: { task: { projectId } } });
    }

    // With a uniform choice over three agents, 25 rounds landing on a single
    // agent has probability under one in a million, so this is not flaky in
    // any way that matters, and it fails loudly if the choice stops rotating.
    expect(picked.size).toBeGreaterThan(1);
  });

  it('reports which agents are free and which are busy', async () => {
    const held = await postOffer({ title: 'beta is on this', offerSeconds: 60 });
    await request(app)
      .post(`/projects/${projectId}/tasks/${held.body.id}/claim`)
      .set('Cookie', [ownerCookie])
      .send({ agentId: agents.beta });

    const res = await request(app)
      .get(`/projects/${projectId}/tasks/offers/candidates`)
      .set('Cookie', [ownerCookie]);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(
      (res.body as Array<{ id: string; busy: boolean }>).map((row) => [row.id, row.busy]),
    );
    expect(byId[agents.beta]).toBe(true);
    expect(byId[agents.alpha]).toBe(false);
  });

  it('does not let an agent from another project claim an offer', async () => {
    const otherProject = await request(app)
      .post('/projects')
      .set('Cookie', [outsiderCookie])
      .send({ name: 'Someone else' });
    const foreignAgent = await request(app)
      .post(`/projects/${otherProject.body.id}/agents`)
      .set('Cookie', [outsiderCookie])
      .send({ name: 'intruder', provider: 'claude' });

    const offer = await postOffer({ title: 'mine only', offerSeconds: 60 });
    const res = await request(app)
      .post(`/projects/${projectId}/tasks/${offer.body.id}/claim`)
      .set('Cookie', [ownerCookie])
      .send({ agentId: foreignAgent.body.id });

    expect(res.status).toBe(404);

    await prisma.project.delete({ where: { id: otherProject.body.id } });
  });

  it('does not let a non-member hand out an offer', async () => {
    const offer = await postOffer({ title: 'not yours to give', offerSeconds: 60 });

    const res = await request(app)
      .post(`/projects/${projectId}/tasks/${offer.body.id}/claim`)
      .set('Cookie', [outsiderCookie])
      .send({ agentId: agents.alpha });

    expect(res.status).toBe(403);
  });
});
