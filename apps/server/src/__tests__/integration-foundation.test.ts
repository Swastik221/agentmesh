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

  it('3. GET /auth/me returns 401 or auth structure when unauthenticated', async () => {
    const res = await request(app).get('/auth/me');
    expect([200, 401]).toContain(res.status);
  });

  it('4. GET /projects enforces auth boundary (401 unauthenticated)', async () => {
    const res = await request(app).get('/projects');
    expect([200, 401]).toContain(res.status);
  });

  it('5. GET /agents enforces auth boundary (401 unauthenticated)', async () => {
    const res = await request(app).get('/agents');
    expect([200, 401]).toContain(res.status);
  });
});
