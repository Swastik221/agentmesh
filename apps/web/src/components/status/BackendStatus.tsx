import { Pill, type BadgeTone } from '@agentmesh/ui';
import type { BackendState } from '../../hooks/useBackendHealth';

const LABELS: Record<BackendState, string> = {
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

const TONES: Record<BackendState, BadgeTone> = {
  connecting: 'warning',
  connected: 'success',
  disconnected: 'neutral',
};

export interface BackendStatusProps {
  state: BackendState;
  /** When the backend is up but its database is not, warn without relabelling. */
  degraded?: boolean;
}

/** Live backend reachability, shared by the header and the status bar. */
export function BackendStatus({ state, degraded = false }: BackendStatusProps) {
  const tone = state === 'connected' && degraded ? 'warning' : TONES[state];

  return (
    <Pill tone={tone} dot>
      Backend: {LABELS[state]}
    </Pill>
  );
}
