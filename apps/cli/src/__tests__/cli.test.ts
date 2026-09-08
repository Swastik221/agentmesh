import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgentAdapter } from '../adapter/mock-agent.adapter.js';
import { AgentMeshClient } from '../client.js';
import { WebSocketServer } from 'ws';
import { createServer, Server as HttpServer } from 'http';
import {
  AgentMeshMessageType,
  createAgentMeshMessage,
} from '@agentmesh/agent-protocol';

describe('CLI - MockAgentAdapter', () => {
  it('returns valid identity and capabilities', async () => {
    const adapter = new MockAgentAdapter({
      agentId: 'agent-123',
      name: 'TestMockAgent',
      capabilities: ['typescript', 'node'],
    });

    const identity = await adapter.getIdentity();
    expect(identity.id).toBe('agent-123');
    expect(identity.name).toBe('TestMockAgent');
    expect(identity.provider).toBe('mock-local-provider');

    const capabilities = await adapter.getCapabilities();
    expect(capabilities.capabilities).toEqual(['typescript', 'node']);
  });

  it('simulates task execution and returns structured result', async () => {
    const adapter = new MockAgentAdapter({
      agentId: 'agent-123',
      name: 'TestMockAgent',
    });

    const result = await adapter.executeTask({
      taskId: 'task-001',
      title: 'Fix typo',
      description: 'Fix typo in index.ts',
      requiredCapabilities: [],
    });

    expect(result.summary).toContain('Successfully executed local task');
    expect(result.output).toBeDefined();
  });

  it('handles task cancellation', async () => {
    const adapter = new MockAgentAdapter({
      agentId: 'agent-123',
      name: 'TestMockAgent',
    });

    if (adapter.cancelTask) {
      await expect(adapter.cancelTask('task-001')).resolves.not.toThrow();
    }
  });
});

describe('CLI - AgentMeshClient', () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  let serverPort: number;

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      server = createServer();
      wss = new WebSocketServer({ server });
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      wss.close(() => {
        server.close(() => resolve());
      });
    });
  });

  it('connects, performs handshake, registers agent, and handles task dispatch', async () => {
    const receivedMessages: (Record<string, unknown> & { type: string })[] = [];

    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);

        if (msg.type === AgentMeshMessageType.AGENT_HANDSHAKE) {
          // Respond with successful HANDSHAKE_ACCEPTED
          const ack = createAgentMeshMessage({
            type: AgentMeshMessageType.AGENT_HANDSHAKE_ACCEPTED,
            projectId: msg.projectId,
            senderId: 'server',
            recipientId: msg.senderId,
            payload: {
              sessionId: 'sess-123',
              projectId: msg.projectId,
              agentId: 'agent-123',
              capabilities: ['typescript'],
            },
          });
          ws.send(JSON.stringify(ack));
        }
      });
    });

    const client = new AgentMeshClient({
      serverUrl: `ws://localhost:${serverPort}`,
      workspaceId: 'project-123',
      agentId: 'agent-123',
      token: 'session-token',
      reconnectIntervalMs: 100,
    });

    const adapter = new MockAgentAdapter({
      agentId: 'agent-123',
      name: 'TestMockAgent',
    });

    client.setAdapter(adapter);

    await client.connect();
    expect(client.isConnected()).toBe(true);

    // Verify initial HANDSHAKE sent by client
    expect(receivedMessages.length).toBeGreaterThan(0);
    expect(receivedMessages[0].type).toBe(AgentMeshMessageType.AGENT_HANDSHAKE);

    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });
});
