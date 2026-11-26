import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { AgentMeshMessageType, CoordinationMessageType, PROTOCOL_VERSION, type WorkspaceContext } from '@agentmesh/agent-protocol';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sessionService } from '../auth/session.service.js';
import { setupWebSocketServer, AgentMeshWebSocketServer } from '../websocket/index.js';
import { agentConnectTokenService } from '../services/agent-connect-token.service.js';
import { terminalService } from '../terminals/terminal.service.js';

/**
 * The shared-canvas scenario end to end, against the real server: two
 * developers in one workspace, each with their own agent; terminals that are
 * private by default and read-only when shared; and agents that can discover
 * each other's work before starting their own.
 *
 * Alice owns the project and runs "Claude". Bob is a member and runs "Codex".
 * Eve is signed in but not a member.
 */

type Frame = Record<string, unknown> & { type: string; payload: Record<string, unknown> };

/** Collects every frame a socket receives so tests can wait for one. */
class Inbox {
  frames: Frame[] = [];
  constructor(public ws: WebSocket) {
    ws.on('message', (data) => {
      try {
        this.frames.push(JSON.parse(data.toString()) as Frame);
      } catch {
        /* ignore non-JSON */
      }
    });
  }
  async waitFor(pred: (f: Frame) => boolean, timeoutMs = 4000): Promise<Frame> {
    const start = Date.now();
    for (;;) {
      const hit = this.frames.find(pred);
      if (hit) {
        this.frames.splice(this.frames.indexOf(hit), 1);
        return hit;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out; saw: ${this.frames.map((f) => f.type).join(', ')}`);
      }
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  /** Resolves true if no matching frame arrives within `ms`. */
  async never(pred: (f: Frame) => boolean, ms = 300): Promise<boolean> {
    await new Promise((r) => setTimeout(r, ms));
    return !this.frames.some(pred);
  }
  send(type: string, payload: unknown, projectId: string, id: string = randomUUID()): string {
    this.ws.send(
      JSON.stringify({ id, protocolVersion: PROTOCOL_VERSION, projectId, senderId: 'client', timestamp: new Date().toISOString(), type, payload }),
    );
    return id;
  }
}

describe('Shared development canvas: terminals and agent awareness', () => {
  const app = createApp();
  const request = supertest(app);
  let server: http.Server;
  let wsServer: AgentMeshWebSocketServer;
  let port: number;
  const open: WebSocket[] = [];

  let alice: { id: string; cookie: string; sessionId: string };
  let bob: { id: string; cookie: string; sessionId: string };
  let eve: { id: string; cookie: string; sessionId: string };
  let projectId: string;
  let claudeId: string;
  let codexId: string;

  const connect = (headers: Record<string, string>, query = ''): Promise<Inbox> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?projectId=${projectId}${query}`, { headers });
      open.push(ws);
      const inbox = new Inbox(ws);
      ws.on('open', () => resolve(inbox));
      ws.on('error', reject);
    });

  /** A browser tab: session cookie, user client. */
  const viewer = async (user: { sessionId: string }) => {
    const inbox = await connect({ Cookie: `agentmesh_session=${user.sessionId}` }, '&clientType=user');
    await inbox.waitFor((f) => f.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);
    return inbox;
  };

  /** An agent process authenticating with a connect token, in a given role. */
  const agent = async (agentId: string, issuer: string, role: 'executor' | 'terminal' | 'observer', token?: string) => {
    const t = token ?? (await agentConnectTokenService.issue(agentId, issuer)).token;
    const inbox = await connect({ 'x-agent-connect-token': t });
    inbox.send(AgentMeshMessageType.AGENT_HANDSHAKE, { agentId, clientVersion: 'test', connectionRole: role }, projectId);
    const reply = await inbox.waitFor((f) => f.type.startsWith('agent.handshake.'));
    expect(reply.type).toBe(AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);
    return { inbox, resumeToken: reply.payload.resumeToken as string };
  };

  const openTerminal = async (inbox: Inbox, payload: Record<string, unknown>) => {
    const id = inbox.send(CoordinationMessageType.TERMINAL_OPEN, payload, projectId);
    const opened = await inbox.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_OPENED && f.correlationId === id);
    return opened.payload as { terminalId: string; visibility: string; resumed: boolean };
  };

  const requestContext = async (inbox: Inbox, focus?: Record<string, unknown>) => {
    const id = inbox.send(CoordinationMessageType.WORKSPACE_CONTEXT_REQUEST, focus ? { focus } : {}, projectId);
    const frame = await inbox.waitFor(
      (f) => (f.type === CoordinationMessageType.WORKSPACE_CONTEXT || f.type === 'error') && f.correlationId === id,
    );
    expect(frame.type).toBe(CoordinationMessageType.WORKSPACE_CONTEXT);
    return frame.payload.context as WorkspaceContext;
  };

  beforeAll(async () => {
    server = http.createServer(app);
    wsServer = setupWebSocketServer(server);
    await new Promise<void>((resolve) =>
      server.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      }),
    );
  });

  afterAll(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const clearDb = async () => {
    await prisma.terminalSession.deleteMany();
    await prisma.agentConnectToken.deleteMany();
    await prisma.activityEvent.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.policy.deleteMany();
    await prisma.gitWorktree.deleteMany();
    await prisma.taskExecution.deleteMany();
    await prisma.taskDependency.deleteMany();
    await prisma.taskResponsibility.deleteMany();
    await prisma.artifact.deleteMany();
    await prisma.task.deleteMany();
    await prisma.agentCapability.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.projectBrainEntry.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.projectWorkspace.deleteMany();
    await prisma.project.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  };

  const makeUser = async (wallet: string, name: string) => {
    const u = await prisma.user.create({ data: { walletAddress: wallet, displayName: name } });
    const s = await sessionService.createSession(u.id);
    return { id: u.id, sessionId: s.id, cookie: `agentmesh_session=${s.id}` };
  };

  beforeEach(async () => {
    await clearDb();
    terminalService.reset();
    alice = await makeUser('0xb000000000000000000000000000000000000001', 'Alice');
    bob = await makeUser('0xb000000000000000000000000000000000000002', 'Bob');
    eve = await makeUser('0xb000000000000000000000000000000000000003', 'Eve');
    const project = await prisma.project.create({
      data: {
        name: 'Checkout',
        ownerId: alice.id,
        members: { create: [{ userId: alice.id, role: 'OWNER' }, { userId: bob.id, role: 'MEMBER' }] },
      },
    });
    projectId = project.id;
    claudeId = (
      await prisma.agent.create({
        data: { projectId, ownerId: alice.id, name: 'Claude', provider: 'claude-code', capabilities: { create: [{ capability: 'backend' }] } },
      })
    ).id;
    codexId = (
      await prisma.agent.create({
        data: { projectId, ownerId: bob.id, name: 'Codex', provider: 'codex', capabilities: { create: [{ capability: 'frontend' }] } },
      })
    ).id;
  });

  afterEach(async () => {
    for (const ws of open.splice(0)) ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  describe('agent awareness', () => {
    it("lets Claude discover Codex, its owner, its task and files before starting, and flags the overlap", async () => {
      const { inbox: codex } = await agent(codexId, bob.id, 'executor');
      const { inbox: claude } = await agent(claudeId, alice.id, 'executor');

      // Bob gives Codex the login UI, which needs an auth API contract.
      const loginTask = await request
        .post(`/projects/${projectId}/tasks`)
        .set('Cookie', bob.cookie)
        .send({ title: 'Frontend login flow', description: 'Login form calling POST /auth/login', filePaths: ['web/src/login.tsx', 'api/contracts/auth.ts'] })
        .expect(201);
      await request
        .post(`/projects/${projectId}/tasks/${loginTask.body.id}/responsibilities`)
        .set('Cookie', bob.cookie)
        .send({ agentId: codexId })
        .expect(201);

      const ctx = await requestContext(claude, { filePaths: ['api/contracts'] });

      expect(ctx.self.name).toBe('Claude');
      const seenCodex = ctx.agents.find((a) => a.agentId === codexId)!;
      expect(seenCodex).toMatchObject({ name: 'Codex', online: true, owner: { displayName: 'Bob' }, capabilities: ['frontend'] });
      expect(seenCodex.currentTasks[0]).toMatchObject({ title: 'Frontend login flow', filePaths: ['web/src/login.tsx', 'api/contracts/auth.ts'] });

      const overlap = ctx.overlaps.find((o) => o.kind === 'FILE')!;
      expect(overlap).toMatchObject({ agentName: 'Codex', taskTitle: 'Frontend login flow', filePaths: ['api/contracts/auth.ts'] });
      expect(overlap.explanation).toContain('Codex');
      codex.ws.close();
    });

    it('reports a handoff when my task depends on unfinished work held by another agent', async () => {
      const { inbox: claude } = await agent(claudeId, alice.id, 'executor');
      const api = await prisma.task.create({ data: { projectId, creatorId: alice.id, title: 'Auth API', description: 'd', status: 'IN_PROGRESS' } });
      const ui = await prisma.task.create({ data: { projectId, creatorId: alice.id, title: 'Wire login UI', description: 'd' } });
      await prisma.taskResponsibility.create({ data: { taskId: api.id, agentId: codexId } });
      await prisma.taskResponsibility.create({ data: { taskId: ui.id, agentId: claudeId } });
      await prisma.taskDependency.create({ data: { projectId, taskId: ui.id, dependsOnTaskId: api.id } });

      const ctx = await requestContext(claude);
      const mine = ctx.tasks.find((t) => t.taskId === ui.id)!;
      expect(mine.blocked).toBe(true);
      expect(mine.dependsOn[0]).toMatchObject({ taskTitle: 'Auth API', satisfied: false });
      expect(ctx.overlaps).toContainEqual(expect.objectContaining({ kind: 'TASK', taskId: api.id, agentName: 'Codex' }));
    });

    it('a terminal or observer connection never counts as the agent being online or receives tasks', async () => {
      await agent(claudeId, alice.id, 'terminal');
      await agent(claudeId, alice.id, 'observer');
      const { inbox: codex } = await agent(codexId, bob.id, 'executor');

      const ctx = await requestContext(codex);
      expect(ctx.agents.find((a) => a.agentId === claudeId)?.online).toBe(false);
      const claude = await prisma.agent.findUnique({ where: { id: claudeId } });
      expect(claude?.status).toBe('OFFLINE');
    });

    it('an outsider cannot read an agent context over REST', async () => {
      await request.get(`/projects/${projectId}/agents/${claudeId}/context`).set('Cookie', eve.cookie).expect(403);
      const res = await request.get(`/projects/${projectId}/agents/${claudeId}/context`).set('Cookie', bob.cookie).expect(200);
      expect(res.body.context.self.name).toBe('Claude');
    });
  });

  describe('connected terminals', () => {
    it('is private by default: only the owner can list, watch or tail it', async () => {
      const { inbox: term } = await agent(claudeId, alice.id, 'terminal');
      const { terminalId, visibility } = await openTerminal(term, {
        name: 'claude',
        command: 'claude --api-key sk-ant-abcdefghijklmnopqrstuvwxyz',
        cwd: '~/checkout',
      });
      expect(visibility).toBe('PRIVATE');

      const bobList = await request.get(`/projects/${projectId}/terminals`).set('Cookie', bob.cookie).expect(200);
      expect(bobList.body.sessions).toHaveLength(0);
      const aliceList = await request.get(`/projects/${projectId}/terminals`).set('Cookie', alice.cookie).expect(200);
      expect(aliceList.body.sessions[0]).toMatchObject({ terminalId, owner: { displayName: 'Alice' }, agent: { name: 'Claude' }, cwd: '~/checkout' });
      // The command line is shown to viewers, so it is redacted like output.
      expect(aliceList.body.sessions[0].command).toBe('claude --api-key [redacted]');

      const bobTab = await viewer(bob);
      bobTab.send(CoordinationMessageType.TERMINAL_SUBSCRIBE, { terminalId }, projectId);
      const denied = await bobTab.waitFor((f) => f.type === 'error');
      expect(denied.payload.code).toBe('NOT_FOUND');

      await request.get(`/projects/${projectId}/terminals/${terminalId}/output`).set('Cookie', bob.cookie).expect(404);

      const aliceTab = await viewer(alice);
      aliceTab.send(CoordinationMessageType.TERMINAL_SUBSCRIBE, { terminalId }, projectId);
      await aliceTab.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_SNAPSHOT);
      term.send(CoordinationMessageType.TERMINAL_OUTPUT, { terminalId, data: 'npm test\r\n' }, projectId);
      const out = await aliceTab.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_OUTPUT);
      expect(out.payload.data).toBe('npm test\r\n');
      expect(await bobTab.never((f) => f.type === CoordinationMessageType.TERMINAL_OUTPUT)).toBe(true);
    });

    it('when shared, teammates watch read-only; making it private revokes them at once', async () => {
      const { inbox: term } = await agent(claudeId, alice.id, 'terminal');
      const { terminalId } = await openTerminal(term, { name: 'claude' });
      term.send(CoordinationMessageType.TERMINAL_OUTPUT, { terminalId, data: 'export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\r\n' }, projectId);
      await new Promise((r) => setTimeout(r, 50));

      await request.patch(`/projects/${projectId}/terminals/${terminalId}`).set('Cookie', bob.cookie).send({ visibility: 'SHARED' }).expect(404);
      await request.patch(`/projects/${projectId}/terminals/${terminalId}`).set('Cookie', alice.cookie).send({ visibility: 'SHARED' }).expect(200);
      // The owner's CLI is told the UI changed visibility.
      await term.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_UPDATE && f.payload.visibility === 'SHARED');

      const bobTab = await viewer(bob);
      bobTab.send(CoordinationMessageType.TERMINAL_SUBSCRIBE, { terminalId }, projectId);
      const snap = await bobTab.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_SNAPSHOT);
      expect(snap.payload.data).toContain('OPENAI_API_KEY=[redacted]');
      expect(snap.payload.data).not.toContain('sk-abcdefghij');

      term.send(CoordinationMessageType.TERMINAL_OUTPUT, { terminalId, data: 'tests passed\r\n' }, projectId);
      expect((await bobTab.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_OUTPUT)).payload.data).toBe('tests passed\r\n');

      // Read-only is enforced server-side: no input, and no writing as someone else.
      bobTab.send(CoordinationMessageType.TERMINAL_INPUT, { terminalId, data: 'rm -rf /\r' }, projectId);
      expect((await bobTab.waitFor((f) => f.type === 'error')).payload.code).toBe('TERMINAL_INPUT_FORBIDDEN');
      bobTab.send(CoordinationMessageType.TERMINAL_OUTPUT, { terminalId, data: 'spoofed' }, projectId);
      expect((await bobTab.waitFor((f) => f.type === 'error')).payload.code).toBe('UNAUTHORIZED');
      const { inbox: codexTerm } = await agent(codexId, bob.id, 'terminal');
      codexTerm.send(CoordinationMessageType.TERMINAL_OUTPUT, { terminalId, data: 'spoofed' }, projectId);
      expect((await codexTerm.waitFor((f) => f.type === 'error')).payload.code).toBe('FORBIDDEN');

      // Other agents may read a shared terminal's recent output.
      const tailId = codexTerm.send(CoordinationMessageType.TERMINAL_TAIL_REQUEST, { terminalId }, projectId);
      const tail = await codexTerm.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_TAIL && f.correlationId === tailId);
      expect(tail.payload.data).toContain('tests passed');

      await request.patch(`/projects/${projectId}/terminals/${terminalId}`).set('Cookie', alice.cookie).send({ visibility: 'PRIVATE' }).expect(200);
      const revoked = await bobTab.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_REVOKED);
      expect(revoked.payload).toMatchObject({ terminalId, reason: 'UNSHARED' });
      term.send(CoordinationMessageType.TERMINAL_OUTPUT, { terminalId, data: 'secret plans\r\n' }, projectId);
      expect(await bobTab.never((f) => f.type === CoordinationMessageType.TERMINAL_OUTPUT)).toBe(true);

      const activity = await prisma.activityEvent.findMany({ where: { projectId, type: { in: ['terminal.shared', 'terminal.unshared'] } } });
      expect(activity.map((a) => a.type).sort()).toEqual(['terminal.shared', 'terminal.unshared']);
    });

    it('survives a disconnect: the session is marked DISCONNECTED and the CLI resumes it with its resume token', async () => {
      const first = await agent(claudeId, alice.id, 'terminal');
      const { terminalId } = await openTerminal(first.inbox, { name: 'claude', visibility: 'SHARED' });
      first.inbox.send(CoordinationMessageType.TERMINAL_OUTPUT, { terminalId, data: 'before drop\r\n' }, projectId);
      await new Promise((r) => setTimeout(r, 50));
      first.inbox.ws.close();
      await new Promise((r) => setTimeout(r, 150));
      expect((await prisma.terminalSession.findUnique({ where: { id: terminalId } }))?.status).toBe('DISCONNECTED');

      // The original connect token could have expired by now; the resume token is enough.
      const second = await agent(claudeId, alice.id, 'terminal', first.resumeToken);
      const resumed = await openTerminal(second.inbox, { terminalId, name: 'claude' });
      expect(resumed).toMatchObject({ terminalId, resumed: true, visibility: 'SHARED' });

      const bobTab = await viewer(bob);
      bobTab.send(CoordinationMessageType.TERMINAL_SUBSCRIBE, { terminalId }, projectId);
      const snap = await bobTab.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_SNAPSHOT);
      expect(snap.payload.data).toContain('before drop');
      expect((snap.payload.session as { status: string }).status).toBe('ACTIVE');
    });

    it("cannot resume someone else's session; that just opens a new one", async () => {
      const { inbox: aliceTerm } = await agent(claudeId, alice.id, 'terminal');
      const { terminalId } = await openTerminal(aliceTerm, { name: 'claude' });
      const { inbox: bobTerm } = await agent(codexId, bob.id, 'terminal');
      const hijack = await openTerminal(bobTerm, { terminalId, name: 'codex' });
      expect(hijack.resumed).toBe(false);
      expect(hijack.terminalId).not.toBe(terminalId);
    });

    it('the owner can disconnect a session from the UI; viewers are revoked and the CLI is told', async () => {
      const { inbox: term } = await agent(claudeId, alice.id, 'terminal');
      const { terminalId } = await openTerminal(term, { name: 'claude', visibility: 'SHARED' });
      const bobTab = await viewer(bob);
      bobTab.send(CoordinationMessageType.TERMINAL_SUBSCRIBE, { terminalId }, projectId);
      await bobTab.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_SNAPSHOT);

      await request.delete(`/projects/${projectId}/terminals/${terminalId}`).set('Cookie', bob.cookie).expect(403);
      await request.delete(`/projects/${projectId}/terminals/${terminalId}`).set('Cookie', alice.cookie).expect(204);
      await term.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_CLOSE);
      expect((await bobTab.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_REVOKED)).payload.reason).toBe('CLOSED');
      const list = await request.get(`/projects/${projectId}/terminals`).set('Cookie', bob.cookie).expect(200);
      expect(list.body.sessions).toHaveLength(0);
    });

    it('an outsider cannot list terminals; malformed and duplicate frames are rejected or dropped', async () => {
      await request.get(`/projects/${projectId}/terminals`).set('Cookie', eve.cookie).expect(403);

      const { inbox: term } = await agent(claudeId, alice.id, 'terminal');
      term.send(CoordinationMessageType.TERMINAL_OPEN, { name: '' }, projectId);
      expect((await term.waitFor((f) => f.type === 'error')).payload.code).toBe('INVALID_MESSAGE');

      const id = randomUUID();
      term.send(CoordinationMessageType.TERMINAL_OPEN, { name: 'once' }, projectId, id);
      term.send(CoordinationMessageType.TERMINAL_OPEN, { name: 'once' }, projectId, id);
      await term.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_OPENED);
      expect(await term.never((f) => f.type === CoordinationMessageType.TERMINAL_OPENED)).toBe(true);
      expect(await prisma.terminalSession.count({ where: { name: 'once' } })).toBe(1);
    });
  });
});
