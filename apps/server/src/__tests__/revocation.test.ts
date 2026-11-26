import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { WebSocket } from 'ws';
import { AgentMeshMessageType, CoordinationMessageType } from '@agentmesh/agent-protocol';
import { prisma } from '../lib/prisma.js';
import { terminalService } from '../terminals/terminal.service.js';
import { MCP_TOKEN_TTL_MS } from '../services/agent-connect-token.service.js';
import {
  startTestServer,
  connect,
  connectAgent,
  connectViewer,
  clearDatabase,
  makeUser,
  type TestServer,
} from './helpers/ws-harness.js';

/** Access that is withdrawn ends immediately, not at the next reconnect. */
describe('Revocation: agent credentials and membership', () => {
  let srv: TestServer;
  let alice: { id: string; cookie: string; sessionId: string };
  let bob: { id: string; cookie: string; sessionId: string };
  let projectId: string;
  let claudeId: string;
  let codexId: string;

  const closed = (ws: WebSocket) =>
    new Promise<number>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) return resolve(-1);
      ws.once('close', (code) => resolve(code));
    });

  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterAll(async () => {
    await srv.close();
  });
  beforeEach(async () => {
    await clearDatabase();
    terminalService.reset();
    alice = await makeUser('0xd000000000000000000000000000000000000001', 'Alice');
    bob = await makeUser('0xd000000000000000000000000000000000000002', 'Bob');
    projectId = (
      await prisma.project.create({
        data: { name: 'P', ownerId: alice.id, members: { create: [{ userId: alice.id, role: 'OWNER' }, { userId: bob.id, role: 'MEMBER' }] } },
      })
    ).id;
    claudeId = (await prisma.agent.create({ data: { projectId, ownerId: alice.id, name: 'Claude', provider: 'claude-code' } })).id;
    codexId = (await prisma.agent.create({ data: { projectId, ownerId: bob.id, name: 'Codex', provider: 'codex' } })).id;
  });
  afterEach(async () => {
    for (const ws of srv.sockets.splice(0)) ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('an MCP token lives 30 days; an ordinary connect token 10 minutes', async () => {
    const mcp = await supertest(srv.app).post(`/agents/${claudeId}/connect-token`).set('Cookie', alice.cookie).send({ purpose: 'mcp' }).expect(201);
    const plain = await supertest(srv.app).post(`/agents/${claudeId}/connect-token`).set('Cookie', alice.cookie).send({}).expect(201);
    const mcpTtl = new Date(mcp.body.expiresAt).getTime() - Date.now();
    const plainTtl = new Date(plain.body.expiresAt).getTime() - Date.now();
    expect(mcpTtl).toBeGreaterThan(MCP_TOKEN_TTL_MS - 60_000);
    expect(plainTtl).toBeLessThanOrEqual(10 * 60 * 1000);
    // Only the owner can mint one.
    await supertest(srv.app).post(`/agents/${claudeId}/connect-token`).set('Cookie', bob.cookie).send({ purpose: 'mcp' }).expect(403);
  });

  it("revoking an agent's tokens disconnects it now and its token stops working", async () => {
    const mcp = await supertest(srv.app).post(`/agents/${claudeId}/connect-token`).set('Cookie', alice.cookie).send({ purpose: 'mcp' }).expect(201);
    const inbox = await connect(srv, projectId, { 'x-agent-connect-token': mcp.body.token });
    inbox.send(AgentMeshMessageType.AGENT_HANDSHAKE, { agentId: claudeId, connectionRole: 'observer' }, projectId);
    await inbox.waitFor((f) => f.type === AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);

    await supertest(srv.app).delete(`/agents/${claudeId}/connect-tokens`).set('Cookie', bob.cookie).expect(403);
    const gone = closed(inbox.ws);
    const res = await supertest(srv.app).delete(`/agents/${claudeId}/connect-tokens`).set('Cookie', alice.cookie).expect(200);
    expect(res.body.disconnected).toBe(1);
    expect(await gone).toBe(4003);

    // The upgrade itself is now refused.
    await expect(connect(srv, projectId, { 'x-agent-connect-token': mcp.body.token })).rejects.toThrow(/401/);
  });

  it("removing a member closes their tabs, their terminal subscriptions and their agents' connections", async () => {
    const { inbox: term } = await connectAgent(srv, projectId, claudeId, alice.id, 'terminal');
    const opened = await term.request(CoordinationMessageType.TERMINAL_OPEN, { name: 'claude', visibility: 'SHARED' }, projectId, CoordinationMessageType.TERMINAL_OPENED);
    const terminalId = opened.payload.terminalId as string;

    const bobTab = await connectViewer(srv, projectId, bob.sessionId);
    bobTab.send(CoordinationMessageType.TERMINAL_SUBSCRIBE, { terminalId }, projectId);
    await bobTab.waitFor((f) => f.type === CoordinationMessageType.TERMINAL_SNAPSHOT);
    const { inbox: codex } = await connectAgent(srv, projectId, codexId, bob.id, 'executor');

    const tabClosed = closed(bobTab.ws);
    const agentClosed = closed(codex.ws);
    await supertest(srv.app).delete(`/projects/${projectId}/members/${bob.id}`).set('Cookie', alice.cookie).expect(200);
    expect(await tabClosed).toBe(4003);
    expect(await agentClosed).toBe(4003);

    // Alice's terminal keeps streaming; Bob receives nothing more.
    term.send(CoordinationMessageType.TERMINAL_OUTPUT, { terminalId, data: 'after removal\r\n' }, projectId);
    expect(await bobTab.never((f) => f.type === CoordinationMessageType.TERMINAL_OUTPUT)).toBe(true);

    // And cannot come back in.
    await expect(connectViewer(srv, projectId, bob.sessionId)).rejects.toThrow();
  });
});
