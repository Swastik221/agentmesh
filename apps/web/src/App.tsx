import { useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/navigation/Sidebar';
import { StatusBar } from './components/status/StatusBar';
import { OverviewPage } from './pages/Overview/OverviewPage';
import { AuthGate } from './pages/AuthGate';
import { ProjectsPage } from './pages/ProjectsPage';
import { AgentsPage } from './pages/AgentsPage';
import { TasksPage } from './pages/TasksPage';
import { ActivityPage } from './pages/ActivityPage';
import { useBackendHealth } from './hooks/useBackendHealth';
import { useWorkspace, WorkspaceProvider } from './state/WorkspaceContext';
import { useWorkspaceSocket } from './hooks/useWorkspaceSocket';
import { navItems } from './data/workspace';
import type { SectionId } from './types';

/**
 * Product shell driven by the real backend:
 *   workspace context (auth + projects) -> live socket state -> section pages.
 */
function Shell() {
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const health = useBackendHealth();
  const { activeProjectId, activeProject } = useWorkspace();
  const { live, refresh } = useWorkspaceSocket(activeProjectId);
  const activeLabel = navItems.find((item) => item.id === activeSection)?.label ?? 'Overview';

  return (
    <div className="app-shell">
      <Header backendState={health.state} databaseState={health.database} />

      <div className="app-body">
        <Sidebar activeSection={activeSection} onSelect={setActiveSection} />

        <main className="app-main">
          {activeSection === 'overview' ? (
            <OverviewPage name={activeProject?.name ?? 'Workspace'} />
          ) : activeSection === 'agents' ? (
            <AgentsPage live={live} refresh={refresh} />
          ) : activeSection === 'tasks' ? (
            <TasksPage live={live} refresh={refresh} />
          ) : activeSection === 'activity' ? (
            <ActivityPage activity={live.activity} connected={live.connected} />
          ) : (
            <PlaceholderPage title={activeLabel} />
          )}
        </main>
      </div>

      <StatusBar health={health} connected={live.connected} />
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="app-placeholder">
      <span className="app-placeholder__title">{title}</span>
      <span className="app-placeholder__note">Section reserved.</span>
    </div>
  );
}

/**
 * Root: authentication gate -> project selection -> workspace shell.
 */
export function App() {
  const { activeProjectId } = useWorkspace();

  return <AuthGate>{activeProjectId ? <Shell /> : <ProjectsPage />}</AuthGate>;
}

export default function Root() {
  return (
    <WorkspaceProvider>
      <App />
    </WorkspaceProvider>
  );
}