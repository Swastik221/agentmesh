import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { Express } from 'express';

describe('INT-1 Integration Foundation Server Contracts', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('1. GET /health returns expected service status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('service', 'agentmesh-server');
  });

  it('2. GET /auth/nonce returns valid SIWE nonce string for AuthSessionService', async () => {
    const res = await request(app).get('/auth/nonce');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('nonce');
    expect(typeof res.body.nonce).toBe('string');
    expect(res.body.nonce.length).toBeGreaterThan(8);
  });

  it('3. GET /auth/me returns 401 unauthenticated when no session provided', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('4. GET /projects enforces auth boundary (401 unauthenticated)', async () => {
    const res = await request(app).get('/projects');
    expect(res.status).toBe(401);
  });

  it('5. GET /projects/:projectId/agents enforces auth boundary (401 unauthenticated)', async () => {
    const res = await request(app).get('/projects/p1/agents');
    expect(res.status).toBe(401);
  });

  it('6. GET /projects/:projectId/tasks enforces auth boundary (401 unauthenticated)', async () => {
    const res = await request(app).get('/projects/p1/tasks');
    expect(res.status).toBe(401);
  });

  it('7. GET /approvals enforces auth boundary (401 unauthenticated)', async () => {
    const res = await request(app).get('/approvals');
    expect(res.status).toBe(401);
  });
});
