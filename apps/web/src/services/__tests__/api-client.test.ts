import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiClient, ApiError } from '../api-client';

const client = new ApiClient(() => 'http://localhost:3001');

/** Build a fetch stub returning the real shape the server's error middleware sends. */
function respondWith(status: number, statusText: string, body: unknown, asText?: string) {
  const payload = asText ?? JSON.stringify(body);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      text: () => Promise.resolve(payload),
      json: () => Promise.resolve(JSON.parse(payload)),
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ApiClient error messages', () => {
  it('surfaces the human message, not the machine code', async () => {
    respondWith(403, 'Forbidden', {
      error: 'FORBIDDEN',
      message: 'User user_1 is not a member of project proj_1',
    });
    await expect(client.get('/projects/proj_1/agents')).rejects.toThrow(
      'User user_1 is not a member of project proj_1'
    );
  });

  it('keeps the machine code reachable on ApiError.data', async () => {
    respondWith(401, 'Unauthorized', {
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
    const err = await client.get('/auth/me').catch((e: unknown) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).toBe('Authentication required');
    expect(((err as ApiError).data as { error: string }).error).toBe('UNAUTHORIZED');
  });

  it('prefers Zod field details over the generic validation message', async () => {
    // What the server actually sends for a failed createAgentSchema.parse.
    respondWith(400, 'Bad Request', {
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: [{ field: 'provider', message: 'Provider is too long' }],
    });
    await expect(
      client.post('/projects/proj_1/agents', { name: 'X', provider: 'P'.repeat(80) })
    ).rejects.toThrow('Provider is too long');
  });

  it('joins multiple field details', async () => {
    respondWith(400, 'Bad Request', {
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: [
        { field: 'name', message: 'Name is required' },
        { field: 'provider', message: 'Provider is required' },
      ],
    });
    await expect(client.post('/projects/proj_1/agents', {})).rejects.toThrow(
      'Name is required, Provider is required'
    );
  });

  it('falls back to the code when the body carries no message', async () => {
    respondWith(409, 'Conflict', { error: 'CONFLICT' });
    await expect(client.get('/agents/agent_1')).rejects.toThrow('CONFLICT');
  });

  it('falls back to the HTTP status line for a non-JSON body', async () => {
    respondWith(502, 'Bad Gateway', null, '<html>502 Bad Gateway</html>');
    const err = await client.get('/projects').catch((e: unknown) => e as ApiError);
    // The real status must survive; the old read-twice path reported 0/Network Error.
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).message).toBe('HTTP 502: Bad Gateway');
  });

  it('falls back to the HTTP status line for an empty body', async () => {
    respondWith(500, 'Internal Server Error', null, '');
    const err = await client.get('/projects').catch((e: unknown) => e as ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toBe('HTTP 500: Internal Server Error');
  });

  it('ignores an empty details array and uses the message', async () => {
    respondWith(400, 'Bad Request', {
      error: 'BAD_REQUEST',
      message: 'At least one field must be provided for update',
      details: [],
    });
    await expect(client.patch('/agents/agent_1', {})).rejects.toThrow(
      'At least one field must be provided for update'
    );
  });

  it('leaves a 200 response body untouched', async () => {
    // A declined assignment is a successful response, not a transport error.
    respondWith(200, 'OK', { assigned: false, reason: 'NO_ELIGIBLE_AGENT' });
    await expect(client.post('/tasks/task_1/assign', {})).resolves.toEqual({
      assigned: false,
      reason: 'NO_ELIGIBLE_AGENT',
    });
  });

  it('still reports a genuine network failure as ApiError(0)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await client.get('/projects').catch((e: unknown) => e as ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).statusText).toBe('Network Error');
  });
});
