import { Waypoints } from 'lucide-react';
import { Pill, TruncatedAddress } from '@agentmesh/ui';
import { currentUser } from '../../data/workspace';

/**
 * Top chrome: product identity on the left, who you are and whether the mesh
 * is negotiating on your behalf on the right. One row, separated by a border.
 */
export function Header() {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <Waypoints size={18} strokeWidth={1.75} className="app-header__mark" aria-hidden="true" />
        <span className="app-header__name">AgentMesh</span>
      </div>

      <div className="app-header__identity">
        <Pill tone="success" dot>
          auto-comm on
        </Pill>
        <TruncatedAddress
          address={currentUser.address}
          label={currentUser.ens}
          className="app-header__wallet"
        />
      </div>
    </header>
  );
}
