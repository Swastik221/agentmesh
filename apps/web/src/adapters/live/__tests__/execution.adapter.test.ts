import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveExecutionAdapter, executionErrorMessage } from '../execution.adapter';
import type { LiveExecution } from '../execution.adapter';
import { apiClient, ApiError } from '../../../services/api-client';

const sampleExecution = (over: Partial<LiveExecution> = {}): LiveExecution => ({
  id: 'exec_1',
  taskId: 'task_1',
  agentId: 'agent_1',
  status: 'QUEUED',
  input: null,
  output: null,
  error: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('liveExecutionAdapter', () => {
  // ---- list: paginated { items, page, limit, total } ---------------------
  it('listExecutions GETs the paginated envelope', async () => {
    const result = { items: [sampleExecution()], page: 1, limit: 20, total: 1 };
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(result);

    const out = await liveExecutionAdapter.listExecutions('proj_1', 'task_1');

    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/executions', { params: {} });
    expect(out).toEqual(result);
  });

  it('listExecutions forwards page and limit', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ items: [], page: 2, limit: 10, total: 0 });
    await liveExecutionAdapter.listExecutions('proj_1', 'task_1', { page: 2, limit: 10 });
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/executions', { params: { page: 2, limit: 10 } });
  });

  it('listExecutions URL-encodes project and task ids', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 });
    await liveExecutionAdapter.listExecutions('proj/1 x', 'task/1 y');
    expect(spy).toHaveBeenCalledWith('/projects/proj%2F1%20x/tasks/task%2F1%20y/executions', { params: {} });
  });

  // ---- get -----------------------------------------------------------------
  it('getExecution GETs /executions/:id encoded', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(sampleExecution());
    await liveExecutionAdapter.getExecution('proj_1', 'task_1', 'exec 1');
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/executions/exec%201');
  });

  // ---- create: the real 201 shape -------------------------------------------
  it('createExecution POSTs agentId and returns { kind: "created" } on a real 201', async () => {
    const created = sampleExecution({ id: 'exec_new' });
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(created);

    const result = await liveExecutionAdapter.createExecution('proj_1', 'task_1', { agentId: 'agent_1' });

    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/executions', { agentId: 'agent_1' });
    expect(result).toEqual({ kind: 'created', execution: created });
  });

  it('createExecution forwards input only when provided', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(sampleExecution());
    await liveExecutionAdapter.createExecution('proj_1', 'task_1', { agentId: 'agent_1', input: { instruction: 'go' } });
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/executions', {
      agentId: 'agent_1',
      input: { instruction: 'go' },
    });
  });

  // ---- create: the real 202 approval-required shape -------------------------
  // A 202 is a genuine HTTP success (response.ok), so apiClient never throws
  // for it. This is the exact envelope the server's ApprovalRequiredError
  // produces, distinguished from a real execution purely by the
  // approvalRequestId field, since the status code itself is not exposed to
  // the caller on a 2xx.
  it('createExecution resolves { kind: "approval_required" } for a real 202, not an error', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      error: 'APPROVAL_REQUIRED',
      message: 'Execution blocked pending human approval',
      approvalRequestId: 'appr_1',
      approvalRequest: { id: 'appr_1', status: 'PENDING' },
    });

    const result = await liveExecutionAdapter.createExecution('proj_1', 'task_1', { agentId: 'agent_1' });

    expect(result).toEqual({
      kind: 'approval_required',
      approvalRequestId: 'appr_1',
      approvalRequest: { id: 'appr_1', status: 'PENDING' },
      message: 'Execution blocked pending human approval',
    });
  });

  it('createExecution falls back to a generic message when the 202 body has none', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      approvalRequestId: 'appr_1',
      approvalRequest: null,
    });
    const result = await liveExecutionAdapter.createExecution('proj_1', 'task_1', { agentId: 'agent_1' });
    expect(result).toMatchObject({ kind: 'approval_required', message: 'Execution requires human approval.' });
  });

  // ---- create: real rejections (responsibility, dependencies, policy) ------
  it('createExecution propagates a 403 when the agent has no responsibility for the task', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(403, 'Forbidden', 'Agent is not assigned responsibility for this task', { error: 'FORBIDDEN' }),
    );
    await expect(
      liveExecutionAdapter.createExecution('proj_1', 'task_1', { agentId: 'agent_1' }),
    ).rejects.toMatchObject({ status: 403, message: 'Agent is not assigned responsibility for this task' });
  });

  it('createExecution propagates a 400 when dependencies are not satisfied', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(400, 'Bad Request', 'Task dependencies are not satisfied', { error: 'BAD_REQUEST' }),
    );
    await expect(
      liveExecutionAdapter.createExecution('proj_1', 'task_1', { agentId: 'agent_1' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('createExecution propagates a 403 when policy denies the action', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(403, 'Forbidden', 'Action rejected by project policy', { error: 'FORBIDDEN' }),
    );
    await expect(
      liveExecutionAdapter.createExecution('proj_1', 'task_1', { agentId: 'agent_1' }),
    ).rejects.toMatchObject({ status: 403, message: 'Action rejected by project policy' });
  });

  it('createExecution surfaces the real server validation message via executionErrorMessage', async () => {
    // Stub the transport, not apiClient: proving the message flows through the
    // real precedence api-client already applies, not a hand-written fixture.
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
              details: [{ field: 'agentId', message: 'agentId is required' }],
            }),
          ),
      }),
    );
    try {
      await liveExecutionAdapter.createExecution('proj_1', 'task_1', { agentId: '' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(executionErrorMessage(err)).toBe('agentId is required');
    }
  });

  // ---- cancel ----------------------------------------------------------------
  it('cancelExecution POSTs /executions/:id/cancel', async () => {
    const cancelled = sampleExecution({ status: 'CANCELLED' });
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(cancelled);
    const result = await liveExecutionAdapter.cancelExecution('proj_1', 'task_1', 'exec_1');
    expect(spy).toHaveBeenCalledWith('/projects/proj_1/tasks/task_1/executions/exec_1/cancel');
    expect(result).toEqual(cancelled);
  });

  it('cancelExecution propagates a 409 on an invalid transition (already terminal)', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(409, 'Conflict', "Invalid execution state transition from 'COMPLETED' to 'CANCELLED'", { error: 'CONFLICT' }),
    );
    await expect(
      liveExecutionAdapter.cancelExecution('proj_1', 'task_1', 'exec_1'),
    ).rejects.toMatchObject({ status: 409 });
  });

  // ---- auth / failure propagation on reads ------------------------------------
  it('listExecutions propagates a 401 ApiError', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(401, 'Unauthorized', 'Authentication required'));
    await expect(liveExecutionAdapter.listExecutions('proj_1', 'task_1')).rejects.toMatchObject({ status: 401 });
  });

  it('listExecutions propagates a 403 ApiError (not a member)', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(403, 'Forbidden', 'User is not a member of this project'));
    await expect(liveExecutionAdapter.listExecutions('proj_1', 'task_1')).rejects.toMatchObject({ status: 403 });
  });

  it('listExecutions propagates a 500 ApiError and never an empty list', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(500, 'Internal Server Error', 'boom'));
    await expect(liveExecutionAdapter.listExecutions('proj_1', 'task_1')).rejects.toBeInstanceOf(ApiError);
  });

  it('listExecutions propagates a network ApiError(0)', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new ApiError(0, 'Network Error', 'Failed to fetch'));
    await expect(liveExecutionAdapter.listExecutions('proj_1', 'task_1')).rejects.toMatchObject({ status: 0 });
  });
});

describe('executionErrorMessage', () => {
  it('returns ApiError.message verbatim', () => {
    const err = new ApiError(403, 'Forbidden', 'Agent is not assigned responsibility for this task');
    expect(executionErrorMessage(err)).toBe('Agent is not assigned responsibility for this task');
  });

  it('handles plain errors and unknowns', () => {
    expect(executionErrorMessage(new Error('nope'))).toBe('nope');
    expect(executionErrorMessage('weird')).toBe('Something went wrong');
  });
});
