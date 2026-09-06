import { Waypoints } from 'lucide-react';
import { Pill } from '@agentmesh/ui';

import { BackendStatus } from '../status/BackendStatus';
import { WalletAuthButton } from '../auth/WalletAuthButton';
import { currentProject } from '../../data/workspace';
import type { BackendHealth, BackendState } from '../../hooks/useBackendHealth';

export interface HeaderProps {
  backendState: BackendState;
  databaseState: BackendHealth['database'];
}

/**
 * Top chrome: product identity and the current project on the left, backend
 * reachability and who you are on the right. One row, separated by a border.
 */
export function Header({ backendState, databaseState }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <Waypoints size={18} strokeWidth={1.75} className="app-header__mark" aria-hidden="true" />
        <span className="app-header__name">AgentMesh</span>
        {/* Placeholder — there is no project switching yet. */}
        <span className="app-header__divider" aria-hidden="true" />
        <span className="app-header__project">{currentProject.name}</span>
      </div>

      <div className="app-header__identity">
        <BackendStatus state={backendState} degraded={databaseState === 'disconnected'} />
        <Pill tone="success" dot>
          auto-comm on
        </Pill>
        <WalletAuthButton />
      </div>
    </header>
  );
}
