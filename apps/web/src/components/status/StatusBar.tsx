import { useEffect, useState } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import { BackendStatus } from './BackendStatus';
import type { BackendHealth } from '../../hooks/useBackendHealth';

const BLOCK_INTERVAL_MS = 12_000;
const INITIAL_BLOCK = 18_432_916;

export interface StatusBarProps {
  health: BackendHealth;
  activePanel?: 'terminal' | 'browser' | null;
  onPanelChange?: (panel: 'terminal' | 'browser') => void;
}

export function StatusBar({ health, activePanel, onPanelChange }: StatusBarProps) {
  const [block, setBlock] = useState(INITIAL_BLOCK);

  useEffect(() => {
    const timer = setInterval(() => setBlock((current) => current + 1), BLOCK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <footer className="app-status" aria-label="Application status">
      <div className="app-status__left">
        <BackendStatus state={health.state} degraded={health.database === 'disconnected'} />
        <span className="app-status__sync">
          <RefreshCw size={11} strokeWidth={1.75} aria-hidden="true" />
          <span>{health.database ? `db ${health.database}` : 'db unknown'}</span>
        </span>
        <button
          type="button"
          className={`app-status__toggle${activePanel === 'terminal' ? ' is-active' : ''}`}
          onClick={() => onPanelChange?.('terminal')}
          title="Toggle Terminal panel"
        >
          <span style={{ fontFamily: 'var(--mesh-font-mono)', fontWeight: 700, fontSize: 10 }}>&gt;_</span>
          <span>Terminal</span>
        </button>
        <button
          type="button"
          className={`app-status__toggle${activePanel === 'browser' ? ' is-active' : ''}`}
          onClick={() => onPanelChange?.('browser')}
          title="Toggle Browser preview panel"
        >
          <Globe size={11} strokeWidth={1.75} />
          <span>Browser</span>
        </button>
      </div>

      <div className="app-status__right">
        <span className="app-status__block">block {block.toLocaleString('en-US')}</span>
      </div>
    </footer>
  );
}
