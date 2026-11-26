import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { AgentMeshMessageType, PROTOCOL_VERSION } from '@agentmesh/agent-protocol';
import { expect } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { sessionService } from '../../auth/session.service.js';
import { setupWebSocketServer, type AgentMeshWebSocketServer } from '../../websocket/index.js';
import { agentConnectTokenService } from '../../services/agent-connect-token.service.js';

/**
 * Shared harness for multi-user / multi-agent WebSocket integration tests:
 * a real HTTP + WS server on an ephemeral port, and an Inbox per socket that
 * records every frame so tests can wait for one.
 */

export type Frame = Record<string, unknown> & { type: string; payload: Record<string, unknown> };

export class Inbox {
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

  /** Sends a request and waits for the reply (or error) correlated to it. */
  async request(type: string, payload: unknown, projectId: string, replyType: string): Promise<Frame> {
    const id = this.send(type, payload, projectId);
    return this.waitFor((f) => (f.type === replyType || f.type === 'error') && f.correlationId === id);
  }
}

export interface TestServer {
  app: ReturnType<typeof createApp>;
  port: number;
  sockets: WebSocket[];
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const app = createApp();
  const server = http.createServer(app);
  const wsServer: AgentMeshWebSocketServer = setupWebSocketServer(server);
  const port = await new Promise<number>((resolve) =>
    server.listen(0, () => resolve((server.address() as { port: number }).port)),
  );
  return {
    app,
    port,
    sockets: [],
    close: async () => {
      wsServer.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function connect(srv: TestServer, projectId: string, headers: Record<string, string>, query = ''): Promise<Inbox> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws?projectId=${projectId}${query}`, { headers });
    srv.sockets.push(ws);
    const inbox = new Inbox(ws);
    ws.on('open', () => resolve(inbox));
    ws.on('error', reject);
  });
}

/** A browser tab: session cookie, user client, waits for the snapshot. */
export async function connectViewer(srv: TestServer, projectId: string, sessionId: string): Promise<Inbox> {
  const inbox = await connect(srv, projectId, { Cookie: `agentmesh_session=${sessionId}` }, '&clientType=user');
  await inbox.waitFor((f) => f.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT);
  return inbox;
}

/** An agent process with a connect token, in a given role. */
export async function connectAgent(
  srv: TestServer,
  projectId: string,
  agentId: string,
  ownerUserId: string,
  role: 'executor' | 'terminal' | 'observer',
): Promise<{ inbox: Inbox; resumeToken: string }> {
  const { token } = await agentConnectTokenService.issue(agentId, ownerUserId);
  const inbox = await connect(srv, projectId, { 'x-agent-connect-token': token });
  inbox.send(AgentMeshMessageType.AGENT_HANDSHAKE, { agentId, clientVersion: 'test', connectionRole: role }, projectId);
  const reply = await inbox.waitFor((f) => f.type.startsWith('agent.handshake.'));
  expect(reply.type).toBe(AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED);
  return { inbox, resumeToken: reply.payload.resumeToken as string };
}

export async function clearDatabase(): Promise<void> {
  await prisma.agentMessage.deleteMany();
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
}

export async function makeUser(wallet: string, name: string): Promise<{ id: string; sessionId: string; cookie: string }> {
  const u = await prisma.user.create({ data: { walletAddress: wallet, displayName: name } });
  const s = await sessionService.createSession(u.id);
  return { id: u.id, sessionId: s.id, cookie: `agentmesh_session=${s.id}` };
}
