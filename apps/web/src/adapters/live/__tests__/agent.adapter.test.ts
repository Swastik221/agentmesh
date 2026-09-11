import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveAgentAdapter } from '../agent.adapter';
import type { LiveAgent } from '../agent.adapter';
import { apiClient, ApiError } from '../../../services/api-client';

const sampleAgent = (over: Partial<LiveAgent> = {}): LiveAgent => ({
  id: 'agent_1',
  projectId: 'proj_1',
  ownerId: 'user_1',
  name: 'Orion',
  provider: 'Codex',
  status: 'OFFLINE',
  ensName: null,
  ensAddress: null,
  ensVerifiedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  capabilities: [],
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('liveAgentAdapter', () => {
  // ---- list: bare array (not wrapped) ------------------------------------
  it('listAgents GETs /projects/:id/agents and returns the bare array', async () => {
    const rows = [sampleAgent(), sampleAgent({ id: 'agent_2', status: 'ONLINE' })];
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(rows);

    const result = await liveAgentAdapter.listAgents('proj_1');

    expect(spy).toHaveBeenCalledWith('/projects/proj_1/agents');
    expect(result).toEqual(rows);
  });

  it('listAgents returns an empty array when the project has no agents', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue([]);
    await expect(liveAgentAdapter.listAgents('proj_1')).resolves.toEqual([]);
  });

  it('listAgents URL-encodes the project id', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue([]);
    await liveAgentAdapter.listAgents('proj/1 x');
    expect(spy).toHaveBeenCalledWith('/projects/proj%2F1%20x/agents');
  });

  // ---- get ---------------------------------------------------------------
  it('getAgent GETs /agents/:id encoded', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(sampleAgent());
    await liveAgentAdapter.getAgent('agent 1');
    expect(spy).toHaveBeenCalledWith('/agents/agent%201');
  });

  // ---- create: server-derived owner, real status -------------------------
  it('createAgent POSTs name + provider and returns the created agent', async () => {
    const created = sampleAgent({ id: 'agent_new', name: 'Vega', provider: 'Claude' });
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(created);

    const result = await liveAgentAdapter.createAgent('proj_1', { name: 'Vega', provider: 'Claude' });

    expect(spy).toHaveBeenCalledWith('/projects/proj_1/agents', { name: 'Vega', provider: 'Claude' });
    expect(result).toEqual(created);
    expect(result.status).toBe('OFFLINE');
  });

  it('createAgent never forwards a client ownerId or ens address', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(sampleAgent());
    await liveAgentAdapter.createAgent('proj_1', {
      name: 'X',
      provider: 'Codex',
      // @ts-expect-error - proving a stray ownerId is not forwarded
      ownerId: 'attacker',
      // @ts-expect-error - proving a stray ensAddress is not forwarded
      ensAddress: '0xfake',
    });
    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toEqual({ name: 'X', provider: 'Codex' });
    expect(body).not.toHaveProperty('ownerId');
    expect(body).not.toHaveProperty('ensAddress');
  });

  it('createAgent includes ensName only when provided', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(sampleAgent());
    await liveAgentAdapter.createAgent('proj_1', { name: 'X', provider: 'Codex', ensName: 'x.eth' });
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/agents', { name: 'X', provider: 'Codex', ensName: 'x.eth' });
  });

  // ---- identity ----------------------------------------------------------
  it('getAgentIdentity GETs /agents/:id/identity', async () => {
    const identity = { agentId: 'agent_1', ensName: 'orion.eth', ensAddress: '0xabc', verified: true, verifiedAt: '2026-01-01T00:00:00.000Z' };
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(identity);
    const result = await liveAgentAdapter.getAgentIdentity('agent_1');
    expect(spy).toHaveBeenCalledWith('/agents/agent_1/identity');
    expect(result).toEqual(identity);
  });

  // ---- auth / authz / failure propagation --------------------------------
  it('listAgents propagates a 401 ApiError', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(401, 'Unauthorized', 'Authentication required'));
    await expect(liveAgentAdapter.listAgents('proj_1')).rejects.toMatchObject({ status: 401 });
  });

  it('listAgents propagates a 403 ApiError (not a project member)', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(403, 'Forbidden', 'User is not a member of project'));
    await expect(liveAgentAdapter.listAgents('proj_1')).rejects.toMatchObject({ status: 403 });
  });

  it('listAgents propagates a 500 ApiError and never an empty list', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(500, 'Internal Server Error', 'boom'));
    await expect(liveAgentAdapter.listAgents('proj_1')).rejects.toBeInstanceOf(ApiError);
  });

  it('listAgents propagates a network ApiError(0)', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(0, 'Network Error', 'Failed to fetch'));
    await expect(liveAgentAdapter.listAgents('proj_1')).rejects.toMatchObject({ status: 0 });
  });

  it('createAgent surfaces the real server validation message', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new ApiError(400, 'Bad Request', 'Provider is required'));
    await expect(
      liveAgentAdapter.createAgent('proj_1', { name: 'X', provider: '' }),
    ).rejects.toThrow('Provider is required');
  });
});
