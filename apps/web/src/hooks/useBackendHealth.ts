import { useEffect, useState } from 'react';
import type { HealthStatus } from '@agentmesh/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const POLL_INTERVAL_MS = 5000;

/**
 * `connecting` is the state before the first response lands, so the UI never
 * claims the backend is down while the first request is still in flight.
 */
export type BackendState = 'connecting' | 'connected' | 'disconnected';

export interface BackendHealth {
  state: BackendState;
  /** Database reachability as reported by the server, once known. */
  database: HealthStatus['database'] | null;
}

/**
 * Polls the existing `/health` endpoint. Called once at the shell root and
 * passed down, so the header and status bar never poll twice.
 */
export function useBackendHealth(): BackendHealth {
  const [health, setHealth] = useState<BackendHealth>({ state: 'connecting', database: null });

  useEffect(() => {
    let active = true;

    const check = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (!response.ok) throw new Error(`unexpected status ${response.status}`);

        const data: HealthStatus = await response.json();
        if (!active) return;
        // Reaching the endpoint at all means the backend is up. The server
        // answers 200 with status `degraded` when only its database is
        // unreachable, which `database` reports separately rather than
        // collapsing into a blanket "disconnected".
        setHealth({ state: 'connected', database: data.database });
      } catch {
        if (active) setHealth({ state: 'disconnected', database: null });
      }
    };

    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return health;
}
