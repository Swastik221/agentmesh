import type { ComponentType } from 'react';
import { Activity, Bot, Boxes, FolderTree, Globe, ListChecks, Terminal } from 'lucide-react';
import { navItems } from '../data/workspace';
import type { SectionId } from '../types';

interface IconProps {
  size?: number;
  strokeWidth?: number;
}

const SECTION_ICONS: Record<SectionId, ComponentType<IconProps>> = {
  project: Boxes,
  agents: Bot,
  tasks: ListChecks,
  activity: Activity,
  files: FolderTree,
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
        {navItems.map((item) => {
          const Icon = SECTION_ICONS[item.id];
          const isActive = !item.reserved && item.id === activeSection;

          return (
            <li key={item.id}>
              <button
                type="button"
                className={`app-nav${isActive ? ' app-nav--active' : ''}${
                  item.reserved ? ' app-nav--reserved' : ''
                }`}
                aria-current={isActive ? 'page' : undefined}
                disabled={item.reserved}
                onClick={() => onSelect(item.id)}
              >
                <Icon size={16} strokeWidth={1.75} />
                <span className="app-nav__label">{item.label}</span>
                {item.reserved ? <span className="app-nav__tag">soon</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
