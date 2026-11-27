import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { CoordinationMessageType, type WorkspaceContext } from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { terminalService } from '../terminals/terminal.service.js';
import {
  startTestServer,
  connectAgent,
  clearDatabase,
  makeUser,
  type TestServer,
  type Inbox,
} from './helpers/ws-harness.js';

/**
 * Agent-to-agent coordination end to end: Claude (Alice's agent) needs the
 * auth API contract that Codex (Bob's agent) owns. Claude asks, Codex answers
 * or publishes a handoff, Claude gets it in its context, and everything is
 * recorded. Covers offline queuing, deduplication, permissions and the
 * targeted context-change notifications.
 */
describe('Agent coordination: messages, handoffs and context notifications', () => {
  let srv: TestServer;
  let alice: { id: string; cookie: string };
  let bob: { id: string; cookie: string };
  let eve: { id: string; cookie: string };
  let projectId: string;
  let otherProjectId: string;
  let claudeId: string;
  let codexId: string;
  let outsiderAgentId: string;
  let apiTaskId: string;
  let uiTaskId: string;

  const contextOf = async (inbox: Inbox, focus?: Record<string, unknown>) => {
    const f = await inbox.request(CoordinationMessageType.WORKSPACE_CONTEXT_REQUEST, focus ? { focus } : {}, projectId, CoordinationMessageType.WORKSPACE_CONTEXT);
    expect(f.type).toBe(CoordinationMessageType.WORKSPACE_CONTEXT);
    return f.payload.context as WorkspaceContext;
  };

  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterAll(async () => {
    await srv.close();
  });

  beforeEach(async () => {
    await clearDatabase();
    terminalService.reset();
    alice = await makeUser('0xc000000000000000000000000000000000000001', 'Alice');
    bob = await makeUser('0xc000000000000000000000000000000000000002', 'Bob');
    eve = await makeUser('0xc000000000000000000000000000000000000003', 'Eve');
    projectId = (
      await prisma.project.create({
        data: { name: 'Checkout', ownerId: alice.id, members: { create: [{ userId: alice.id, role: 'OWNER' }, { userId: bob.id, role: 'MEMBER' }] } },
      })
    ).id;
    otherProjectId = (
      await prisma.project.create({ data: { name: 'Other', ownerId: eve.id, members: { create: [{ userId: eve.id, role: 'OWNER' }] } } })
    ).id;
    claudeId = (await prisma.agent.create({ data: { projectId, ownerId: alice.id, name: 'Claude', provider: 'claude-code' } })).id;
    codexId = (await prisma.agent.create({ data: { projectId, ownerId: bob.id, name: 'Codex', provider: 'codex' } })).id;
    outsiderAgentId = (await prisma.agent.create({ data: { projectId: otherProjectId, ownerId: eve.id, name: 'Eve-bot', provider: 'x' } })).id;

    apiTaskId = (
      await prisma.task.create({
        data: { projectId, creatorId: bob.id, title: 'Auth API', description: 'POST /auth/login', status: 'IN_PROGRESS', filePaths: ['api/auth.ts'] },
      })
    ).id;
    uiTaskId = (
      await prisma.task.create({ data: { projectId, creatorId: alice.id, title: 'Login UI', description: 'form', filePaths: ['web/login.tsx'] } })
    ).id;
    await prisma.taskResponsibility.create({ data: { taskId: apiTaskId, agentId: codexId } });
    await prisma.taskResponsibility.create({ data: { taskId: uiTaskId, agentId: claudeId } });
    await prisma.taskDependency.create({ data: { projectId, taskId: uiTaskId, dependsOnTaskId: apiTaskId } });
  });

  afterEach(async () => {
    for (const ws of srv.sockets.splice(0)) ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('ASK to an offline agent is queued, delivered on connect, answered, and the exchange is recorded', async () => {
    const { inbox: claude } = await connectAgent(srv, projectId, claudeId, alice.id, 'executor');

    // Claude discovers who owns the upstream work, then asks for the contract.
    const ctx = await contextOf(claude);
    expect(ctx.overlaps).toContainEqual(expect.objectContaining({ kind: 'TASK', taskId: apiTaskId, agentName: 'Codex' }));

    const accepted = await claude.request(
      CoordinationMessageType.AGENT_COORDINATE,
      { recipientAgentId: codexId, taskId: apiTaskId, intent: 'ASK', subject: 'Login API contract?', body: 'What does POST /auth/login return?' },
      projectId,
      CoordinationMessageType.AGENT_COORDINATE_ACCEPTED,
    );
    expect(accepted.payload).toMatchObject({ delivered: 0, queued: 1 });
    const askId = (accepted.payload.messageIds as string[])[0];

    // Codex comes online (as an MCP-style observer) and gets the queued message.
    const { inbox: codex } = await connectAgent(srv, projectId, codexId, bob.id, 'observer');
    const delivered = await codex.waitFor((f) => f.type === CoordinationMessageType.AGENT_COORDINATE_DELIVERY);
    expect(delivered.payload).toMatchObject({ messageId: askId, intent: 'ASK', from: { name: 'Claude' }, subject: 'Login API contract?' });
    expect((await prisma.agentMessage.findUnique({ where: { id: askId } }))?.deliveryState).toBe('DELIVERED');

    // Codex answers with structured data.
    const answer = await codex.request(
      CoordinationMessageType.AGENT_COORDINATE,
      {
        recipientAgentId: claudeId,
        taskId: apiTaskId,
        intent: 'ANSWER',
        subject: 'Re: Login API contract?',
        body: '200 with a session cookie',
        data: { contract: { method: 'POST', path: '/auth/login', response: { userId: 'string' } } },
        inReplyTo: askId,
      },
      projectId,
      CoordinationMessageType.AGENT_COORDINATE_ACCEPTED,
    );
    expect(answer.payload).toMatchObject({ delivered: 1, queued: 0 });

    const reply = await claude.waitFor((f) => f.type === CoordinationMessageType.AGENT_COORDINATE_DELIVERY);
    expect(reply.payload).toMatchObject({ intent: 'ANSWER', inReplyTo: askId, data: { contract: { path: '/auth/login' } } });
    expect((await prisma.agentMessage.findUnique({ where: { id: askId } }))?.deliveryState).toBe('ACKNOWLEDGED');

    const activity = await prisma.activityEvent.findMany({ where: { projectId, type: 'agent.coordination' } });
    expect(activity).toHaveLength(2);

    // Claude's inbox still lists the answer until it acknowledges it.
    const inbox = await claude.request(CoordinationMessageType.AGENT_INBOX_REQUEST, {}, projectId, CoordinationMessageType.AGENT_INBOX);
    expect((inbox.payload.messages as unknown[]).length).toBe(1);
    claude.send(CoordinationMessageType.AGENT_COORDINATE_ACK, { messageId: reply.payload.messageId }, projectId);
    await new Promise((r) => setTimeout(r, 100));
    const after = await claude.request(CoordinationMessageType.AGENT_INBOX_REQUEST, {}, projectId, CoordinationMessageType.AGENT_INBOX);
    expect(after.payload.messages).toEqual([]);
  });

  it('a resent envelope is stored once; cross-project, oversized and self-addressed messages are refused', async () => {
    const { inbox: claude } = await connectAgent(srv, projectId, claudeId, alice.id, 'executor');
    const payload = { recipientAgentId: codexId, intent: 'PROPOSE', subject: 'Use JWT?' };
    const id = 'fixed-envelope-id';
    claude.send(CoordinationMessageType.AGENT_COORDINATE, payload, projectId, id);
    await claude.waitFor((f) => f.type === CoordinationMessageType.AGENT_COORDINATE_ACCEPTED);
    // The connection drops exact replays; a second connection resending is deduplicated in the DB.
    const { inbox: claude2 } = await connectAgent(srv, projectId, claudeId, alice.id, 'observer');
    claude2.send(CoordinationMessageType.AGENT_COORDINATE, payload, projectId, id);
    await claude2.waitFor((f) => f.type === CoordinationMessageType.AGENT_COORDINATE_ACCEPTED);
    expect(await prisma.agentMessage.count({ where: { clientMessageId: id } })).toBe(1);

    const cross = await claude.request(
      CoordinationMessageType.AGENT_COORDINATE,
      { recipientAgentId: outsiderAgentId, intent: 'ASK', subject: 'hi' },
      projectId,
      CoordinationMessageType.AGENT_COORDINATE_ACCEPTED,
    );
    expect(cross.payload.code).toBe('NOT_FOUND');

    const big = await claude.request(
      CoordinationMessageType.AGENT_COORDINATE,
      { recipientAgentId: codexId, intent: 'ASK', subject: 'big', data: { blob: 'x'.repeat(20_000) } },
      projectId,
      CoordinationMessageType.AGENT_COORDINATE_ACCEPTED,
    );
    expect(big.payload.code).toBe('BAD_REQUEST');

    const toSelfTask = await claude.request(
      CoordinationMessageType.AGENT_COORDINATE,
      { taskId: uiTaskId, intent: 'ASK', subject: 'only me here' },
      projectId,
      CoordinationMessageType.AGENT_COORDINATE_ACCEPTED,
    );
    expect(toSelfTask.payload.code).toBe('BAD_REQUEST');
  });

  it('a handoff becomes an artifact, notifies agents on dependent tasks, and shows up in their context', async () => {
    const { inbox: claude } = await connectAgent(srv, projectId, claudeId, alice.id, 'executor');
    const { inbox: codex } = await connectAgent(srv, projectId, codexId, bob.id, 'observer');

    const published = await codex.request(
      CoordinationMessageType.HANDOFF_PUBLISH,
      {
        taskId: apiTaskId,
        note: {
          summary: 'Login endpoint is done',
          filesModified: ['api/auth.ts'],
          apiContracts: [{ name: 'POST /auth/login', spec: '{ wallet, signature } -> 200 + Set-Cookie' }],
          openQuestions: ['Refresh tokens?'],
          validation: ['unit tests pass'],
        },
      },
      projectId,
      CoordinationMessageType.HANDOFF_PUBLISHED,
    );
    expect(published.type).toBe(CoordinationMessageType.HANDOFF_PUBLISHED);
    expect(published.payload.notified).toBe(1);
    const artifactId = published.payload.artifactId as string;
    expect((await prisma.artifact.findUnique({ where: { id: artifactId } }))?.type).toBe('handoff');

    const msg = await claude.waitFor((f) => f.type === CoordinationMessageType.AGENT_COORDINATE_DELIVERY);
    expect(msg.payload).toMatchObject({ intent: 'HANDOFF', data: { artifactId } });
    const changed = await claude.waitFor((f) => f.type === CoordinationMessageType.WORKSPACE_CONTEXT_CHANGED);
    expect(changed.payload).toMatchObject({ reason: 'HANDOFF', taskId: apiTaskId });

    const ctx = await contextOf(claude);
    expect(ctx.handoffs[0]).toMatchObject({ artifactId, taskTitle: 'Auth API', from: { name: 'Codex' } });
    expect(ctx.handoffs[0].note.apiContracts[0].name).toBe('POST /auth/login');
    expect(ctx.pendingMessages).toBe(1);

    const art = await claude.request(CoordinationMessageType.ARTIFACT_GET_REQUEST, { artifactId }, projectId, CoordinationMessageType.ARTIFACT_DETAILS);
    expect((art.payload.artifact as { payload: { summary: string } }).payload.summary).toBe('Login endpoint is done');

    const details = await claude.request(CoordinationMessageType.TASK_DETAILS_REQUEST, { taskId: uiTaskId }, projectId, CoordinationMessageType.TASK_DETAILS);
    expect((details.payload.task as { dependsOn: Array<{ taskTitle: string }> }).dependsOn[0].taskTitle).toBe('Auth API');
  });

  it('a handoff respects artifact policy: with approval required, no artifact is created', async () => {
    await prisma.policy.create({ data: { projectId, name: 'Review writes', action: 'artifact.write', decision: 'APPROVAL_REQUIRED' } });
    const { inbox: codex } = await connectAgent(srv, projectId, codexId, bob.id, 'observer');
    const res = await codex.request(
      CoordinationMessageType.HANDOFF_PUBLISH,
      { taskId: apiTaskId, note: { summary: 'done' } },
      projectId,
      CoordinationMessageType.HANDOFF_PUBLISHED,
    );
    expect(res.payload.code).toBe('APPROVAL_REQUIRED');
    expect(await prisma.artifact.count({ where: { type: 'handoff' } })).toBe(0);
  });

  it('agents may move only their own tasks, never to COMPLETED; BLOCKED notifies dependent agents', async () => {
    const { inbox: claude } = await connectAgent(srv, projectId, claudeId, alice.id, 'executor');
    const { inbox: codex } = await connectAgent(srv, projectId, codexId, bob.id, 'executor');

    const notMine = await claude.request(CoordinationMessageType.TASK_STATUS_UPDATE, { taskId: apiTaskId, status: 'BLOCKED' }, projectId, CoordinationMessageType.TASK_STATUS_UPDATED);
    expect(notMine.payload.code).toBe('FORBIDDEN');

    const complete = await codex.request(CoordinationMessageType.TASK_STATUS_UPDATE, { taskId: apiTaskId, status: 'COMPLETED' }, projectId, CoordinationMessageType.TASK_STATUS_UPDATED);
    expect(complete.payload.code).toBe('INVALID_MESSAGE');

    const blocked = await codex.request(
      CoordinationMessageType.TASK_STATUS_UPDATE,
      { taskId: apiTaskId, status: 'BLOCKED', reason: 'waiting on DB schema' },
      projectId,
      CoordinationMessageType.TASK_STATUS_UPDATED,
    );
    expect(blocked.payload).toMatchObject({ status: 'BLOCKED' });
    const note = await claude.waitFor((f) => f.type === CoordinationMessageType.WORKSPACE_CONTEXT_CHANGED && f.payload.reason === 'TASK_BLOCKED');
    expect(note.payload.summary).toContain('waiting on DB schema');
  });

  it('reported file activity surfaces overlaps to both agents', async () => {
    const { inbox: claude } = await connectAgent(srv, projectId, claudeId, alice.id, 'executor');
    const { inbox: codex } = await connectAgent(srv, projectId, codexId, bob.id, 'executor');
    const res = await claude.request(
      CoordinationMessageType.FILE_ACTIVITY_REPORT,
      { taskId: uiTaskId, filePaths: ['api/auth.ts'] },
      projectId,
      CoordinationMessageType.FILE_ACTIVITY_RECORDED,
    );
    expect(res.type, JSON.stringify(res.payload)).toBe(CoordinationMessageType.FILE_ACTIVITY_RECORDED);
    expect(res.payload.overlaps).toContainEqual(expect.objectContaining({ kind: 'FILE', agentName: 'Codex', filePaths: ['api/auth.ts'] }));
    const conflict = await codex.waitFor((f) => f.type === CoordinationMessageType.WORKSPACE_CONTEXT_CHANGED && f.payload.reason === 'CONFLICT');
    expect(conflict.payload.taskId).toBe(uiTaskId);
  });

  it('assignment and disconnect notify only the agents concerned', async () => {
    const { inbox: claude } = await connectAgent(srv, projectId, claudeId, alice.id, 'executor');
    const codexConn = await connectAgent(srv, projectId, codexId, bob.id, 'executor');

    const task = await supertest(srv.app)
      .post(`/projects/${projectId}/tasks`)
      .set('Cookie', bob.cookie)
      .send({ title: 'Rate limit login', description: 'd' })
      .expect(201);
    await supertest(srv.app)
      .post(`/projects/${projectId}/tasks/${task.body.id}/responsibilities`)
      .set('Cookie', bob.cookie)
      .send({ agentId: codexId })
      .expect(201);
    const assigned = await codexConn.inbox.waitFor((f) => f.type === CoordinationMessageType.WORKSPACE_CONTEXT_CHANGED && f.payload.reason === 'TASK_ASSIGNED');
    expect(assigned.payload.taskId).toBe(task.body.id);
    expect(await claude.never((f) => f.type === CoordinationMessageType.WORKSPACE_CONTEXT_CHANGED && f.payload.reason === 'TASK_ASSIGNED')).toBe(true);

    codexConn.inbox.ws.close();
    const gone = await claude.waitFor((f) => f.type === CoordinationMessageType.WORKSPACE_CONTEXT_CHANGED && f.payload.reason === 'AGENT_DISCONNECTED');
    expect(gone.payload).toMatchObject({ taskId: apiTaskId, agentId: codexId });
  });
});
