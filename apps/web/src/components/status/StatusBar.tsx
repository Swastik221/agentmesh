import { RefreshCw, Terminal } from 'lucide-react';
import { BackendStatus } from './BackendStatus';
import type { BackendHealth } from '../../hooks/useBackendHealth';

export interface StatusBarProps {
  health: BackendHealth;
  /** Live WebSocket state for the active workspace. */
  connected: boolean;
}

export function StatusBar({ health, connected }: StatusBarProps) {
  return (
    <footer className="app-status">
      <div className="app-status__left">
        <BackendStatus state={health.state} degraded={health.database === 'disconnected'} />
        <span className="app-status__sync">
          <RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" />
          {connected ? 'live' : 'ws …'}
        </span>
        <span className="app-status__sync">
          {health.database ? `db ${health.database}` : 'db unknown'}
        </span>
      </div>

      {/* Reserved space for the Terminal and Browser panels. Present so the
          bar does not reflow when those land, but deliberately inert. */}
      <div className="app-status__panels" aria-hidden="true">
        <span className="app-status__toggle app-status__toggle--reserved">
          <Terminal size={12} strokeWidth={1.75} />
          Terminal
        </span>
      </div>
    </footer>
  );
}