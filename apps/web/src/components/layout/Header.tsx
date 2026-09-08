import { Copy, Hexagon, RotateCcw, Settings, UserPlus } from 'lucide-react';
import { Pill, TruncatedAddress } from '@agentmesh/ui';
import { BackendStatus } from '../status/BackendStatus';
import { currentProject, currentUser } from '../../data/workspace';
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
        <Hexagon size={24} strokeWidth={1.5} className="app-header__mark" aria-hidden="true" />
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
        <TruncatedAddress
          address={currentUser.address}
          label={currentUser.ens}
          className="app-header__wallet"
        />
        <div className="app-header__actions">
          <button title="Invite developer">
            <UserPlus size={14} />
            Invite
          </button>
          <button
            title="Copy workspace link"
            onClick={() => void navigator.clipboard?.writeText(location.href)}
          >
            <Copy size={14} />
            Share
          </button>
          <button
            title="Replay demo"
            onClick={() => window.dispatchEvent(new Event('agentmesh:replay'))}
          >
            <RotateCcw size={14} />
            Replay demo
          </button>
          <button className="icon-only" title="Workspace settings">
            <Settings size={15} />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </header>
  );
}
