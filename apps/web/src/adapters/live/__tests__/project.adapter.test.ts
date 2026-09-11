import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveProjectAdapter } from '../project.adapter';
import type { Project } from '../project.adapter';
import { apiClient, ApiError } from '../../../services/api-client';

const sampleProject = (over: Partial<Project> = {}): Project => ({
  id: 'proj_1',
  name: 'Checkout Protocol',
  description: 'Shared payment work',
  ownerId: 'user_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  owner: { id: 'user_1', displayName: 'Anand', walletAddress: '0xabc' },
  role: 'OWNER',
  joinedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('liveProjectAdapter', () => {
  // ---- positive: list ----------------------------------------------------
  it('listProjects GETs /projects and unwraps the { projects } envelope', async () => {
    const rows = [sampleProject(), sampleProject({ id: 'proj_2', name: 'Second', role: 'MEMBER' })];
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ projects: rows });

    const result = await liveProjectAdapter.listProjects();

    expect(spy).toHaveBeenCalledWith('/projects');
    expect(result).toEqual(rows);
  });

  it('listProjects returns an empty array for an empty project set', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ projects: [] });
    await expect(liveProjectAdapter.listProjects()).resolves.toEqual([]);
  });

  // ---- positive: get -----------------------------------------------------
  it('getProject GETs /projects/:id with the id URL-encoded', async () => {
    const proj = sampleProject({ id: 'proj/with space' });
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(proj);

    const result = await liveProjectAdapter.getProject('proj/with space');

    expect(spy).toHaveBeenCalledWith('/projects/proj%2Fwith%20space');
    expect(result).toEqual(proj);
  });

  // ---- positive + security: create --------------------------------------
  it('createProject POSTs name + description and returns the created project', async () => {
    const created = sampleProject({ id: 'proj_new', name: 'New', description: 'd' });
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(created);

    const result = await liveProjectAdapter.createProject({ name: 'New', description: 'd' });

    expect(spy).toHaveBeenCalledWith('/projects', { name: 'New', description: 'd' });
    expect(result).toEqual(created);
  });

  it('createProject never sends a client-side ownerId (identity is server-side)', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(sampleProject());

    await liveProjectAdapter.createProject({
      name: 'X',
      // @ts-expect-error - proving a stray ownerId is not forwarded even if passed
      ownerId: 'attacker-supplied',
    });

    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('ownerId');
    expect(body).toEqual({ name: 'X' });
  });

  it('createProject omits description entirely when not provided', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(sampleProject());
    await liveProjectAdapter.createProject({ name: 'Only name' });
    expect(spy).toHaveBeenCalledWith('/projects', { name: 'Only name' });
  });

  // ---- auth: 401 ---------------------------------------------------------
  it('listProjects propagates a 401 ApiError instead of swallowing it', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiError(401, 'Unauthorized', 'Authentication required'),
    );
    await expect(liveProjectAdapter.listProjects()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });
  });

  // ---- authorization: 403 -----------------------------------------------
  it('getProject propagates a 403 ApiError (not your project) without falling back', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiError(403, 'Forbidden', 'User is not a member of this project'),
    );
    await expect(liveProjectAdapter.getProject('someone-elses')).rejects.toMatchObject({
      status: 403,
    });
  });

  // ---- failure: 500 ------------------------------------------------------
  it('listProjects propagates a 500 ApiError and never returns an empty list', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiError(500, 'Internal Server Error', 'Database exploded'),
    );
    await expect(liveProjectAdapter.listProjects()).rejects.toBeInstanceOf(ApiError);
  });

  // ---- failure: network --------------------------------------------------
  it('listProjects propagates a network ApiError(0)', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiError(0, 'Network Error', 'Failed to fetch'),
    );
    await expect(liveProjectAdapter.listProjects()).rejects.toMatchObject({ status: 0 });
  });

  // ---- create validation error is surfaced verbatim ----------------------
  it('createProject propagates the real server validation message', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(400, 'Bad Request', 'Project name is required'),
    );
    await expect(liveProjectAdapter.createProject({ name: '' })).rejects.toThrow(
      'Project name is required',
    );
  });
});
