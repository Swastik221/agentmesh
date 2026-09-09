import { Hexagon } from 'lucide-react';
import { BackendStatus } from '../status/BackendStatus';
import { WalletAuthButton } from '../auth/WalletAuthButton';
import { useWorkspace } from '../../state/WorkspaceContext';
import type { BackendHealth, BackendState } from '../../hooks/useBackendHealth';

export interface HeaderProps {
  backendState: BackendState;
  databaseState: BackendHealth['database'];
}

/**
 * Top chrome: product identity and the real active project on the left,
 * backend reachability, SIWE wallet auth and the current identity on the right.
 */
export function Header({ backendState, databaseState }: HeaderProps) {
  const { activeProject } = useWorkspace();

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <Hexagon size={24} strokeWidth={1.5} className="app-header__mark" aria-hidden="true" />
        <span className="app-header__name">AgentMesh</span>
        <span className="app-header__divider" aria-hidden="true" />
        <span className="app-header__project" title={activeProject?.id}>
          {activeProject?.name ?? 'Workspace'}
        </span>
      </div>

      <div className="app-header__identity">
        <BackendStatus state={backendState} degraded={databaseState === 'disconnected'} />
        <WalletAuthButton />
      </div>
    </header>
  );
}