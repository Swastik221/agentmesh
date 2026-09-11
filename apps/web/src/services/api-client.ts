/**
 * AgentMesh Typed REST API Client
 *
 * Handles HTTP requests between the frontend and the AgentMesh backend server.
 * Supports credentials inclusion for SIWE cookie sessions, typed JSON responses,
 * and structured error handling.
 */

import { envConfig } from '../config/env';

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

/** The error envelope the server's error middleware sends on every non-2xx. */
interface ApiErrorBody {
  error?: unknown;
  message?: unknown;
  details?: unknown;
}

/**
 * Pick the most useful human sentence out of a server error body.
 *
 * The backend sends both a machine code (`error`, e.g. `VALIDATION_ERROR`) and a
 * human sentence (`message`, e.g. `Provider is too long`). Zod failures keep
 * `message` generic (`Invalid request data`) and put the per-field text in
 * `details`, so preference runs most specific first: field details, then
 * `message`, then the bare code, then the HTTP status line. The parsed body is
 * kept on `ApiError.data` for callers that need the code itself.
 */
function errorMessageFrom(errorData: unknown, status: number, statusText: string): string {
  const httpFallback = `HTTP ${status}: ${statusText}`;
  if (typeof errorData !== 'object' || errorData === null) {
    return httpFallback;
  }
  const body = errorData as ApiErrorBody;

  if (Array.isArray(body.details)) {
    const fieldMessages = body.details
      .map((detail) =>
        typeof detail === 'object' &&
        detail !== null &&
        typeof (detail as { message?: unknown }).message === 'string'
          ? (detail as { message: string }).message
          : null
      )
      .filter((message): message is string => Boolean(message && message.trim()));
    if (fieldMessages.length > 0) {
      return fieldMessages.join(', ');
    }
  }

  if (typeof body.message === 'string' && body.message.trim() !== '') {
    return body.message;
  }
  if (typeof body.error === 'string' && body.error.trim() !== '') {
    return body.error;
  }
  return httpFallback;
}

export class ApiClient {
  constructor(private baseUrlProvider: () => string = () => envConfig.apiUrl) {}

  private get baseUrl(): string {
    return this.baseUrlProvider().replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${cleanPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  public async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, headers: customHeaders, ...customInit } = options;
    const url = this.buildUrl(path, params);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(customHeaders as Record<string, string>),
    };

    const config: RequestInit = {
      credentials: 'include', // Important for SIWE cookie-based authentication
      headers,
      ...customInit,
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        // Read the body once. Calling .json() first consumes the stream, so a
        // non-JSON error body made the follow-up .text() throw and surface as a
        // fake ApiError(0, 'Network Error') instead of the real status.
        const rawBody = await response.text().catch(() => '');
        let errorData: unknown = rawBody;
        try {
          errorData = JSON.parse(rawBody) as unknown;
        } catch {
          // Not JSON (proxy HTML, empty body); keep the raw text on .data.
        }

        throw new ApiError(
          response.status,
          response.statusText,
          errorMessageFrom(errorData, response.status, response.statusText),
          errorData
        );
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(0, 'Network Error', err instanceof Error ? err.message : 'Unknown network error');
    }
  }

  public get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  public post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
