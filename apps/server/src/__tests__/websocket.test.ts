import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import {
  setupWebSocketServer,
  connectionManager,
  AgentMeshWebSocketServer,
} from '../websocket/index.js';

describe('PRD #6 WebSocket Infrastructure Integration Tests', () => {
  const app = createApp();
  let server: http.Server;
  let wsServer: AgentMeshWebSocketServer;
  let serverPort: number;

  const userWallet = '0xWSINFRA1111111111111111111111111111111';
  let userId: string;
  let project1Id: string;
  let project2Id: string;

  const connectWs = (urlPath: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const client = new WebSocket(`ws://localhost:${serverPort}${urlPath}`);
      client.on('open', () => resolve(client));
      client.on('error', (err) => reject(err));
    });
  };

  const waitForNextMessage = (ws: WebSocket): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for message')), 2000);
      ws.once('message', (data) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data.toString()));
        } catch {
          resolve(data.toString());
        }
      });
    });
  };

  beforeAll(async () => {
    // Clean up test data
    const existingUsers = await prisma.user.findMany({
      where: { walletAddress: userWallet },
    });
    for (const u of existingUsers) {
      const userProjects = await prisma.project.findMany({ where: { ownerId: u.id } });
      for (const p of userProjects) {
        await prisma.project.delete({ where: { id: p.id } });
      }
      await prisma.user.delete({ where: { id: u.id } });
    }

    // Create User
    const userRes = await request(app).post('/users').send({
      walletAddress: userWallet,
      displayName: 'WebSocket Tester',
    });
    userId = userRes.body.id;

    // Create Project 1
    const p1Res = await request(app).post('/projects').send({
      name: 'WS Project 1',
      description: 'First test project for WS',
      ownerId: userId,
    });
    project1Id = p1Res.body.id;

    // Create Project 2
    const p2Res = await request(app).post('/projects').send({
      name: 'WS Project 2',
      description: 'Second test project for WS',
      ownerId: userId,
    });
    project2Id = p2Res.body.id;

    // Start test HTTP & WebSocket server
    server = http.createServer(app);
    wsServer = setupWebSocketServer(server, 60000); // 60s default for standard tests

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (wsServer) {
      wsServer.close();
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (userId) {
      const userProjects = await prisma.project.findMany({ where: { ownerId: userId } });
      for (const p of userProjects) {
        await prisma.project.delete({ where: { id: p.id } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  describe('Connection Validation', () => {
    it('should connect successfully with valid projectId query parameter', async () => {
      const ws = await connectWs(`/ws?projectId=${project1Id}`);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      const activeConns = connectionManager.getProjectConnections(project1Id);
      expect(activeConns.length).toBeGreaterThanOrEqual(1);

      ws.close();
    });

    it('should reject connection when projectId query parameter is missing', async () => {
      await expect(connectWs('/ws')).rejects.toThrow();
    });

    it('should reject connection when projectId is empty', async () => {
      await expect(connectWs('/ws?projectId=')).rejects.toThrow();
    });

    it('should reject connection when project does not exist', async () => {
      await expect(connectWs('/ws?projectId=nonexistent-project-id')).rejects.toThrow();
    });
  });

  describe('Connection Manager & Project Rooms', () => {
    it('should register connection and remove it upon socket close', async () => {
      const ws = await connectWs(`/ws?projectId=${project1Id}`);
      const projectConnsBefore = connectionManager.getProjectConnections(project1Id);
      const connId = projectConnsBefore[0].connectionId;

      expect(connectionManager.getConnection(connId)).toBeDefined();

      // Close connection and wait for server to process close event
      ws.close();
      await new Promise((r) => setTimeout(r, 100));

      expect(connectionManager.getConnection(connId)).toBeUndefined();
    });

    it('should isolate connections by project and broadcast only to target project', async () => {
      const wsP1 = await connectWs(`/ws?projectId=${project1Id}`);
      const wsP2 = await connectWs(`/ws?projectId=${project2Id}`);

      const p1MsgPromise = waitForNextMessage(wsP1);
      let p2ReceivedMsg = false;
      wsP2.on('message', () => {
        p2ReceivedMsg = true;
      });

      const testPayload = { type: 'test_event', payload: { data: 'hello p1' } };
      connectionManager.broadcastToProject(project1Id, testPayload);

      const receivedMsg = await p1MsgPromise;
      expect(receivedMsg).toEqual(testPayload);

      // Small delay to verify P2 did not receive message
      await new Promise((r) => setTimeout(r, 100));
      expect(p2ReceivedMsg).toBe(false);

      wsP1.close();
      wsP2.close();
    });
  });

  describe('Transport Messages & Ping / Pong', () => {
    it('should respond to JSON ping message with JSON pong message', async () => {
      const ws = await connectWs(`/ws?projectId=${project1Id}`);

      const pongPromise = waitForNextMessage(ws);
      ws.send(JSON.stringify({ type: 'ping', payload: {} }));

      const response = await pongPromise;
      expect(response).toEqual({ type: 'pong', payload: {} });

      ws.close();
    });

    it('should accept valid JSON pong message without error', async () => {
      const ws = await connectWs(`/ws?projectId=${project1Id}`);

      ws.send(JSON.stringify({ type: 'pong', payload: {} }));
      await new Promise((r) => setTimeout(r, 100));

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('should return INVALID_MESSAGE error payload for malformed JSON and keep connection open', async () => {
      const ws = await connectWs(`/ws?projectId=${project1Id}`);

      const errorPromise = waitForNextMessage(ws);
      ws.send('invalid { json ...');

      const response = await errorPromise;
      expect(response).toEqual({
        type: 'error',
        payload: {
          code: 'INVALID_MESSAGE',
          message: 'Invalid WebSocket message',
        },
      });

      // Socket must remain open for ordinary malformed messages
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('should return INVALID_MESSAGE error payload for invalid envelope format', async () => {
      const ws = await connectWs(`/ws?projectId=${project1Id}`);

      const errorPromise = waitForNextMessage(ws);
      ws.send(JSON.stringify({ notType: 123 }));

      const response = await errorPromise;
      expect(response).toEqual({
        type: 'error',
        payload: {
          code: 'INVALID_MESSAGE',
          message: 'Invalid WebSocket message',
        },
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
  });

  describe('Heartbeat & Liveness Tracking', () => {
    it('should update connection liveness when heartbeat ping/pong is processed', async () => {
      // Set short heartbeat interval (100ms) for testing
      wsServer.startHeartbeat(100);

      const ws = await connectWs(`/ws?projectId=${project1Id}`);
      await new Promise((r) => setTimeout(r, 250));

      // Connection should remain alive as native WS automatically responds to ping frames
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
      wsServer.startHeartbeat(60000); // restore interval
    });
  });
});
