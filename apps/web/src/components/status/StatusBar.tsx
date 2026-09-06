import { useEffect, useState } from 'react';
import { Globe, RefreshCw, Terminal } from 'lucide-react';
import { BackendStatus } from './BackendStatus';
import type { BackendHealth } from '../../hooks/useBackendHealth';

/** Mock chain head. Ticks slowly so the bar feels live without drawing the eye. */
const BLOCK_INTERVAL_MS = 12_000;
const INITIAL_BLOCK = 18_432_908;

export interface StatusBarProps {
  health: BackendHealth;
}

export function StatusBar({ health }: StatusBarProps) {
  const [block, setBlock] = useState(INITIAL_BLOCK);

  useEffect(() => {
    const timer = setInterval(() => setBlock((current) => current + 1), BLOCK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <footer className="app-status">
      <div className="app-status__left">
        <BackendStatus state={health.state} degraded={health.database === 'disconnected'} />
        <span className="app-status__sync">
          <RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" />
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
        <span className="app-status__toggle app-status__toggle--reserved">
          <Globe size={12} strokeWidth={1.75} />
          Browser
        </span>
      </div>

      <div className="app-status__right">
        <span className="app-status__block">block {block.toLocaleString('en-US')}</span>
      </div>
    </footer>
  );
}
