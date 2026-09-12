import { useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/navigation/Sidebar';
import { OverviewPage } from './pages/Overview/OverviewPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { navItems } from './data/workspace';
import type { SectionId } from './types';
import { ActivityView, AgentsView, FilesView, TasksView, TeamView } from './pages/Workspace/WorkspaceViews';
import { WorkspaceScenery } from './components/canvas/WorkspaceScenery';
import './features/workspace/scenery.css';
import './pages/Workspace/workspace-views.css';

/**
 * Workspace shell: a compact header, left rail, and uninterrupted canvas.
 */
export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [focusView, setFocusView] = useState(false);
  const activeLabel = navItems.find((item) => item.id === activeSection)?.label ?? 'Overview';

  return (
    <div
      className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ' is-sidebar-expanded'}${focusView ? ' is-focus-view' : ''}`}
    >
      <Header />

      <div className="app-body">
        <Sidebar
          activeSection={activeSection}
          collapsed={sidebarCollapsed}
          onCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
          onSelect={(section) => {
            if (section === 'notes') {
              setActiveSection('overview');
              window.setTimeout(() => window.dispatchEvent(new Event('agentmesh:add-note')), 100);
              return;
            }
            setActiveSection(section);
          }}
        />

        <div className="app-workspace-stack">
          <WorkspaceScenery />
          <main className="app-main">
            {activeSection === 'overview' ? (
              <OverviewPage focusView={focusView} onFocusViewChange={setFocusView} />
            ) : activeSection === 'agents' ? (
              <AgentsView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'tasks' ? (
              <TasksView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'files' ? (
              <FilesView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'activity' ? (
              <ActivityView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'team' ? (
              <TeamView onOpenCanvas={() => setActiveSection('overview')} />
            ) : (
              <PlaceholderPage title={activeLabel} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
