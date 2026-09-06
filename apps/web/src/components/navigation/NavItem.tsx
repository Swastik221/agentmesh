import type { ComponentType } from 'react';
import type { SectionId } from '../../types';

export interface NavItemIconProps {
  size?: number;
  strokeWidth?: number;
}

export interface NavItemProps {
  id: SectionId;
  label: string;
  icon: ComponentType<NavItemIconProps>;
  active: boolean;
  /** Reserved sections render visibly but cannot be selected. */
  reserved?: boolean;
  onSelect: (section: SectionId) => void;
}

/**
 * A single navigation row. Kept separate from Sidebar so future rails — a
 * project switcher, a per-agent list — can reuse the same affordances.
 */
export function NavItem({ id, label, icon: Icon, active, reserved, onSelect }: NavItemProps) {
  return (
    <button
      type="button"
      className={`app-nav${active ? ' app-nav--active' : ''}${reserved ? ' app-nav--reserved' : ''}`}
      aria-current={active ? 'page' : undefined}
      disabled={reserved}
      title={reserved ? `${label} — coming in a later pass` : label}
      onClick={() => onSelect(id)}
    >
      <Icon size={16} strokeWidth={1.75} />
      <span className="app-nav__label">{label}</span>
      {reserved ? <span className="app-nav__tag">soon</span> : null}
    </button>
  );
}
