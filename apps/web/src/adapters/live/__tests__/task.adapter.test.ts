import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  liveTaskAdapter,
  taskErrorMessage,
  isFileConflict,
  errorCode,
} from '../task.adapter';
import type { LiveTask, TaskResponsibility, AssignmentResult } from '../task.adapter';
import { apiClient, ApiError } from '../../../services/api-client';

const sampleTask = (over: Partial<LiveTask> = {}): LiveTask => ({
  id: 'task_1',
  projectId: 'proj_1',
  creatorId: 'user_1',
  preferredAgentId: null,
  title: 'Wire payment API',
  description: 'Implement the checkout payment endpoint',
  status: 'TODO',
  priority: 'MEDIUM',
  filePaths: [],
  requiredCapabilities: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  responsibilities: [],
  dependencies: [],
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('liveTaskAdapter', () => {
  // ---- list: paginated { items, page, limit, total } ---------------------
  it('listTasks GETs /projects/:id/tasks and returns the paginated envelope', async () => {
    const result = { items: [sampleTask()], page: 1, limit: 20, total: 1 };
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(result);

    const out = await liveTaskAdapter.listTasks('proj_1');

    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks', { params: {} });
    expect(out).toEqual(result);
  });

  it('listTasks forwards status/priority/page/limit as query params', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ items: [], page: 2, limit: 10, total: 0 });
    await liveTaskAdapter.listTasks('proj_1', { status: 'IN_PROGRESS', priority: 'HIGH', page: 2, limit: 10 });
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks', {
      params: { status: 'IN_PROGRESS', priority: 'HIGH', page: 2, limit: 10 },
    });
  });

  it('listTasks URL-encodes the project id', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 });
    await liveTaskAdapter.listTasks('proj/1 x');
    expect(spy).toHaveBeenCalledWith('/projects/proj%2F1%20x/tasks', { params: {} });
  });

  // ---- listAllTasks: walks every page, past the server's single-page cap --
  it('listAllTasks makes one request when everything fits on the first page', async () => {
    const items = [sampleTask({ id: 'task_1' }), sampleTask({ id: 'task_2' })];
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ items, page: 1, limit: 100, total: 2 });

    const out = await liveTaskAdapter.listAllTasks('proj_1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks', { params: { page: 1, limit: 100 } });
    expect(out).toEqual(items);
  });

  it('listAllTasks keeps requesting subsequent pages until every task is collected', async () => {
    // Simulates a project with 25 tasks: the mock returns them 10 at a time
    // regardless of the limit the adapter actually requests, so this proves
    // the loop's termination condition (keep going until `total` is reached)
    // rather than assuming one large-limit request is always enough.
    const page1 = Array.from({ length: 10 }, (_, i) => sampleTask({ id: `task_${i}` }));
    const page2 = Array.from({ length: 10 }, (_, i) => sampleTask({ id: `task_${i + 10}` }));
    const page3 = Array.from({ length: 5 }, (_, i) => sampleTask({ id: `task_${i + 20}` }));
    const spy = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ items: page1, page: 1, limit: 100, total: 25 })
      .mockResolvedValueOnce({ items: page2, page: 2, limit: 100, total: 25 })
      .mockResolvedValueOnce({ items: page3, page: 3, limit: 100, total: 25 });

    const out = await liveTaskAdapter.listAllTasks('proj_1');

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenNthCalledWith(1, '/projects/proj_1/tasks', { params: { page: 1, limit: 100 } });
    expect(spy).toHaveBeenNthCalledWith(2, '/projects/proj_1/tasks', { params: { page: 2, limit: 100 } });
    expect(spy).toHaveBeenNthCalledWith(3, '/projects/proj_1/tasks', { params: { page: 3, limit: 100 } });
    expect(out).toHaveLength(25);
    expect(out).toEqual([...page1, ...page2, ...page3]);
  });

  it('listAllTasks returns an empty array for an empty project without looping', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ items: [], page: 1, limit: 100, total: 0 });
    const out = await liveTaskAdapter.listAllTasks('proj_1');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toEqual([]);
  });

  it('listAllTasks forwards status/priority filters on every page it requests', async () => {
    const spy = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ items: [sampleTask()], page: 1, limit: 100, total: 2 })
      .mockResolvedValueOnce({ items: [sampleTask({ id: 'task_2' })], page: 2, limit: 100, total: 2 });

    await liveTaskAdapter.listAllTasks('proj_1', { status: 'IN_PROGRESS', priority: 'HIGH' });

    expect(spy).toHaveBeenNthCalledWith(1, '/projects/proj_1/tasks', {
      params: { status: 'IN_PROGRESS', priority: 'HIGH', page: 1, limit: 100 },
    });
    expect(spy).toHaveBeenNthCalledWith(2, '/projects/proj_1/tasks', {
      params: { status: 'IN_PROGRESS', priority: 'HIGH', page: 2, limit: 100 },
    });
  });

  it('listAllTasks propagates a real ApiError from any page', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(500, 'Internal Server Error', 'boom'));
    await expect(liveTaskAdapter.listAllTasks('proj_1')).rejects.toBeInstanceOf(ApiError);
  });

  // ---- get ---------------------------------------------------------------
  it('getTask GETs /projects/:id/tasks/:taskId encoded', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(sampleTask());
    await liveTaskAdapter.getTask('proj_1', 'task 1');
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task%201');
  });

  // ---- create: server-derived creator ------------------------------------
  it('createTask POSTs title + description and returns the created task', async () => {
    const created = sampleTask({ id: 'task_new', title: 'New', description: 'Body' });
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(created);

    const out = await liveTaskAdapter.createTask('proj_1', { title: 'New', description: 'Body' });

    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks', { title: 'New', description: 'Body' });
    expect(out).toEqual(created);
  });

  it('createTask never forwards a client creatorId', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(sampleTask());
    await liveTaskAdapter.createTask('proj_1', {
      title: 'X',
      description: 'Y',
      // @ts-expect-error - proving a stray creatorId is not forwarded
      creatorId: 'attacker',
    });
    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toEqual({ title: 'X', description: 'Y' });
    expect(body).not.toHaveProperty('creatorId');
  });

  it('createTask includes optional fields only when provided', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(sampleTask());
    await liveTaskAdapter.createTask('proj_1', {
      title: 'X',
      description: 'Y',
      priority: 'CRITICAL',
      filePaths: ['a.ts'],
      requiredCapabilities: ['language:ts'],
      preferredAgentId: 'agent_9',
    });
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks', {
      title: 'X',
      description: 'Y',
      priority: 'CRITICAL',
      filePaths: ['a.ts'],
      preferredAgentId: 'agent_9',
      requiredCapabilities: ['language:ts'],
    });
  });

  // ---- update status -----------------------------------------------------
  it('updateTaskStatus PATCHes the status', async () => {
    const spy = vi.spyOn(apiClient, 'patch').mockResolvedValue(sampleTask({ status: 'IN_PROGRESS' }));
    const out = await liveTaskAdapter.updateTaskStatus('proj_1', 'task_1', 'IN_PROGRESS');
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1', { status: 'IN_PROGRESS' });
    expect(out.status).toBe('IN_PROGRESS');
  });

  // ---- manual claim (responsibility) -------------------------------------
  it('claimTask POSTs the agentId to /responsibilities', async () => {
    const resp: TaskResponsibility = {
      id: 'resp_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      role: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(resp);

    const out = await liveTaskAdapter.claimTask('proj_1', 'task_1', { agentId: 'agent_1' });

    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/responsibilities', { agentId: 'agent_1' });
    expect(out).toEqual(resp);
  });

  it('claimTask includes role only when non-empty', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue({});
    await liveTaskAdapter.claimTask('proj_1', 'task_1', { agentId: 'agent_1', role: 'reviewer' });
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/responsibilities', {
      agentId: 'agent_1',
      role: 'reviewer',
    });

    spy.mockClear();
    await liveTaskAdapter.claimTask('proj_1', 'task_1', { agentId: 'agent_1', role: '' });
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/responsibilities', { agentId: 'agent_1' });
  });

  it('claimTask propagates a 409 already-assigned ApiError', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(409, 'Conflict', 'CONFLICT', { error: 'CONFLICT', message: 'Agent is already assigned to this task' }),
    );
    await expect(
      liveTaskAdapter.claimTask('proj_1', 'task_1', { agentId: 'agent_1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('claimTask propagates a 409 file-conflict ApiError with conflicts', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(409, 'Conflict', 'FILE_CONFLICT', {
        error: 'FILE_CONFLICT',
        message: 'Task conflicts with an active task modifying the same workspace files.',
        conflicts: [{ taskId: 'task_2', filePaths: ['src/payment.ts'] }],
      }),
    );
    await expect(
      liveTaskAdapter.claimTask('proj_1', 'task_1', { agentId: 'agent_1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  // ---- dependencies + responsibilities read ------------------------------
  it('listDependencies GETs /dependencies', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue([]);
    await liveTaskAdapter.listDependencies('proj_1', 'task_1');
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/dependencies');
  });

  it('listResponsibilities GETs /responsibilities', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue([]);
    await liveTaskAdapter.listResponsibilities('proj_1', 'task_1');
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/responsibilities');
  });

  it('addDependency POSTs dependsOnTaskId and returns the created row', async () => {
    const row = {
      id: 'dep_1',
      projectId: 'proj_1',
      taskId: 'task_1',
      dependencyType: 'TASK_COMPLETION',
      dependsOnTaskId: 'task_2',
      artifactId: null,
      available: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(row);

    const result = await liveTaskAdapter.addDependency('proj_1', 'task_1', { dependsOnTaskId: 'task_2' });

    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/dependencies', { dependsOnTaskId: 'task_2' });
    expect(result).toEqual(row);
  });

  it('addDependency propagates a circular-dependency 400 ApiError', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(400, 'Bad Request', 'Circular task dependency detected', { error: 'BAD_REQUEST' }),
    );
    await expect(
      liveTaskAdapter.addDependency('proj_1', 'task_1', { dependsOnTaskId: 'task_2' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('removeDependency DELETEs by the dependency row id', async () => {
    const spy = vi.spyOn(apiClient, 'delete').mockResolvedValue(undefined);
    await liveTaskAdapter.removeDependency('proj_1', 'task_1', 'dep_1');
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/dependencies/dep_1');
  });

  // ---- coordinator auto-assign: 200 for BOTH outcomes --------------------
  it('autoAssign returns the success result (assigned: true)', async () => {
    const result: AssignmentResult = {
      assigned: true,
      taskId: 'task_1',
      agentId: 'agent_1',
      source: 'CAPABILITY_MATCH',
      score: 85,
    };
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(result);

    const out = await liveTaskAdapter.autoAssign('proj_1', 'task_1');

    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/assign', {});
    expect(out).toEqual(result);
  });

  it('autoAssign returns a decline result (assigned: false) WITHOUT throwing', async () => {
    const result: AssignmentResult = { assigned: false, taskId: 'task_1', reason: 'NO_ELIGIBLE_AGENT' };
    vi.spyOn(apiClient, 'post').mockResolvedValue(result);

    const out = await liveTaskAdapter.autoAssign('proj_1', 'task_1');

    expect(out.assigned).toBe(false);
    if (!out.assigned) expect(out.reason).toBe('NO_ELIGIBLE_AGENT');
  });

  it('autoAssign surfaces DEPENDENCIES_NOT_SATISFIED as a domain result', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ assigned: false, taskId: 'task_1', reason: 'DEPENDENCIES_NOT_SATISFIED' });
    const out = await liveTaskAdapter.autoAssign('proj_1', 'task_1');
    expect(out).toMatchObject({ assigned: false, reason: 'DEPENDENCIES_NOT_SATISFIED' });
  });

  it('autoAssign forwards a preferredAgentId when given', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue({ assigned: true, taskId: 'task_1', agentId: 'agent_9', source: 'HUMAN_PREFERENCE' });
    await liveTaskAdapter.autoAssign('proj_1', 'task_1', 'agent_9');
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/assign', { preferredAgentId: 'agent_9' });
  });

  it('autoAssign still rejects on a real transport/auth failure', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new ApiError(401, 'Unauthorized', 'UNAUTHORIZED'));
    await expect(liveTaskAdapter.autoAssign('proj_1', 'task_1')).rejects.toMatchObject({ status: 401 });
  });

  // ---- auth / failure propagation on reads -------------------------------
  it('listTasks propagates a 401 ApiError', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(401, 'Unauthorized', 'Authentication required'));
    await expect(liveTaskAdapter.listTasks('proj_1')).rejects.toMatchObject({ status: 401 });
  });

  it('listTasks propagates a 403 ApiError (not a member)', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(403, 'Forbidden', 'User is not a member of this project'));
    await expect(liveTaskAdapter.listTasks('proj_1')).rejects.toMatchObject({ status: 403 });
  });

  it('listTasks propagates a 500 ApiError and never an empty list', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(500, 'Internal Server Error', 'boom'));
    await expect(liveTaskAdapter.listTasks('proj_1')).rejects.toBeInstanceOf(ApiError);
  });

  it('listTasks propagates a network ApiError(0)', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(0, 'Network Error', 'Failed to fetch'));
    await expect(liveTaskAdapter.listTasks('proj_1')).rejects.toMatchObject({ status: 0 });
  });

  it('createTask surfaces the real server validation message via taskErrorMessage', async () => {
    // Stub the transport, not apiClient: a hand-written ApiError message would
    // only assert its own fixture. This is the exact envelope the server's error
    // middleware sends for a failed createTaskSchema.parse, run through the real
    // apiClient, so the assertion is what a user would actually see on screen.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: 'VALIDATION_ERROR',
              message: 'Invalid request data',
              details: [{ field: 'title', message: 'Title must be between 1 and 200 characters' }],
            }),
          ),
      }),
    );
    try {
      await liveTaskAdapter.createTask('proj_1', { title: '', description: 'Y' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(taskErrorMessage(err)).toBe('Title must be between 1 and 200 characters');
    }
  });
});

describe('task error helpers', () => {
  it('taskErrorMessage returns ApiError.message verbatim, never reaching into .data itself', () => {
    // apiClient already picked the best text (field details > message > code >
    // status line) before this error was ever thrown, so taskErrorMessage has
    // nothing left to do. A .data.message that disagrees with .message must be
    // ignored: message is what apiClient decided, not a candidate to override.
    const err = new ApiError(409, 'Conflict', 'Title must be between 1 and 200 characters', {
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
    });
    expect(taskErrorMessage(err)).toBe('Title must be between 1 and 200 characters');
  });

  it('taskErrorMessage handles an ApiError with no data at all', () => {
    const err = new ApiError(500, 'Internal Server Error', 'boom');
    expect(taskErrorMessage(err)).toBe('boom');
  });

  it('taskErrorMessage handles plain errors and unknowns', () => {
    expect(taskErrorMessage(new Error('nope'))).toBe('nope');
    expect(taskErrorMessage('weird')).toBe('Something went wrong');
  });

  it('isFileConflict is true only for a 409 FILE_CONFLICT', () => {
    expect(isFileConflict(new ApiError(409, 'Conflict', 'FILE_CONFLICT', { error: 'FILE_CONFLICT' }))).toBe(true);
    expect(isFileConflict(new ApiError(409, 'Conflict', 'CONFLICT', { error: 'CONFLICT' }))).toBe(false);
    expect(isFileConflict(new ApiError(400, 'Bad Request', 'X', { error: 'FILE_CONFLICT' }))).toBe(false);
    expect(isFileConflict(new Error('x'))).toBe(false);
  });

  it('errorCode reads the server code from the body', () => {
    expect(errorCode(new ApiError(409, 'Conflict', 'CONFLICT', { error: 'CONFLICT' }))).toBe('CONFLICT');
    expect(errorCode(new ApiError(0, 'Network Error', 'x'))).toBeNull();
    expect(errorCode('nope')).toBeNull();
  });
});
