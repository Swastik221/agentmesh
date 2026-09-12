import type { ComponentType } from 'react';
import {
  Activity,
  Bot,
  FolderTree,
  Globe,
  LayoutDashboard,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal,
  StickyNote,
  Users,
} from 'lucide-react';
import { NavItem, type NavItemIconProps } from './NavItem';
import { navItems } from '../../data/workspace';
import type { SectionId } from '../../types';

const SECTION_ICONS: Record<SectionId, ComponentType<NavItemIconProps>> = {
  overview: LayoutDashboard,
  agents: Bot,
  tasks: ListChecks,
  files: FolderTree,
  activity: Activity,
  team: Users,
  terminal: Terminal,
  browser: Globe,
  notes: StickyNote,
};

export interface SidebarProps {
  activeSection: SectionId;
  collapsed: boolean;
  onCollapse: () => void;
  onSelect: (section: SectionId) => void;
}

/**
 * Left rail. Reserved sections stay visible so the eventual shape of the app
 * is legible, but they are disabled rather than silently inert.
 */
export function Sidebar({ activeSection, collapsed, onCollapse, onSelect }: SidebarProps) {
  return (
    <nav className="app-sidebar" aria-label="Workspace sections">
      <ul className="app-sidebar__list">
        {navItems.map((item) => (
          <li key={item.id}>
            <NavItem
              id={item.id}
              label={item.label}
              icon={SECTION_ICONS[item.id]}
              active={!item.reserved && item.id === activeSection}
              reserved={item.reserved}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="app-sidebar__toggle"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={onCollapse}
      >
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        <span>{collapsed ? 'Expand' : 'Collapse sidebar'}</span>
      </button>
    </nav>
  );
}
