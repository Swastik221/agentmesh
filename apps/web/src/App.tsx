import { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/navigation/Sidebar';
import { OverviewPage } from './pages/Overview/OverviewPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { navItems } from './data/workspace';
import type { SectionId } from './types';
import { ActivityView, AgentsView, FilesView, TasksView, TeamView } from './pages/Workspace/WorkspaceViews';
import { AwarenessView, TerminalsView } from './pages/Workspace/CanvasViews';
import { useWorkspaceRealtime } from './hooks/useWorkspaceRealtime';
import { currentProjectId } from './utils/currentProjectId';
import { navigate } from './routes/AppRouter';
import { WorkspaceScenery } from './components/canvas/WorkspaceScenery';
import './features/workspace/scenery.css';
import './pages/Workspace/workspace-views.css';

/**
 * Workspace shell: a compact header, left rail, and uninterrupted canvas.
 */
export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const activeLabel = navItems.find((item) => item.id === activeSection)?.label ?? 'Overview';
  const projectId = currentProjectId();

  // Holds the workspace's shared realtime connection open for as long as the
  // workspace is on screen, so switching views never reconnects (and never
  // makes this user flicker offline for teammates).
  const { status: realtimeStatus } = useWorkspaceRealtime(projectId);

  // The server closed the connection because access was withdrawn (removed
  // from the workspace): leave it.
  useEffect(() => {
    if (realtimeStatus === 'revoked') navigate('/workspaces?notice=access-removed');
  }, [realtimeStatus]);

  // Other parts of the UI (canvas nodes, header) ask to open a section.
  useEffect(() => {
    const open = (e: Event) => {
      const section = (e as CustomEvent<SectionId>).detail;
      if (navItems.some((item) => item.id === section)) setActiveSection(section);
    };
    window.addEventListener('agentmesh:open-section', open);
    return () => window.removeEventListener('agentmesh:open-section', open);
  }, []);

  // A different workspace starts on its overview.
  useEffect(() => {
    setActiveSection('overview');
  }, [projectId]);

  return (
    <div
      className={`app-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ' is-sidebar-expanded'}`}
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
              <OverviewPage />
            ) : activeSection === 'agents' ? (
              <AgentsView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'tasks' ? (
              <TasksView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'terminals' ? (
              <TerminalsView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'awareness' ? (
              <AwarenessView onOpenCanvas={() => setActiveSection('overview')} />
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
