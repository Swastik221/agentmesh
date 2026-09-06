import type { ComponentType } from 'react';
import {
  Activity,
  Bot,
  FolderTree,
  Globe,
  LayoutDashboard,
  ListChecks,
  Terminal,
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
  terminal: Terminal,
  browser: Globe,
};

export interface SidebarProps {
  activeSection: SectionId;
  onSelect: (section: SectionId) => void;
}

/**
 * Left rail. Reserved sections stay visible so the eventual shape of the app
 * is legible, but they are disabled rather than silently inert.
 */
export function Sidebar({ activeSection, onSelect }: SidebarProps) {
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
    </nav>
  );
}
