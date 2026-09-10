import { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/navigation/Sidebar';
import { OverviewPage } from './pages/Overview/OverviewPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { navItems } from './data/workspace';
import type { SectionId } from './types';
import { BrowserPanel, TerminalPanel } from './demo/DemoPanels';
import { ActivityView, AgentsView, FilesView, TasksView } from './pages/Workspace/WorkspaceViews';
import './pages/Workspace/workspace-views.css';

/**
 * Workspace shell: a compact header, left rail, and uninterrupted canvas.
 */
export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  // The rail starts as a 46px icon strip, as in the reference capture.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [focusView, setFocusView] = useState(false);
  const [panel, setPanel] = useState<'terminal' | 'browser' | null>(null);
  const activeLabel = navItems.find((item) => item.id === activeSection)?.label ?? 'Overview';
  useEffect(() => { const open = (event: Event) => setPanel((event as CustomEvent<'terminal' | 'browser'>).detail); window.addEventListener('agentmesh:open-panel', open); return () => window.removeEventListener('agentmesh:open-panel', open); }, []);

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
          onSelect={(section) => { if (section === 'notes') { setActiveSection('overview'); window.setTimeout(() => window.dispatchEvent(new Event('agentmesh:add-note')), 100); return; } setActiveSection(section); if (section === 'terminal' || section === 'browser') setPanel(section); }}
        />

        <div className={`app-workspace-stack${panel ? ' has-utility-panel' : ''}`}>
          <main className="app-main">
            {activeSection === 'overview' || activeSection === 'terminal' || activeSection === 'browser' ? (
              <OverviewPage focusView={focusView} onFocusViewChange={setFocusView} />
            ) : activeSection === 'agents' ? (
              <AgentsView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'tasks' ? (
              <TasksView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'files' ? (
              <FilesView onOpenCanvas={() => setActiveSection('overview')} />
            ) : activeSection === 'activity' ? (
              <ActivityView onOpenCanvas={() => setActiveSection('overview')} />
            ) : (
              <PlaceholderPage title={activeLabel} />
            )}
          </main>
          {panel && (panel === 'terminal' ? <TerminalPanel onClose={() => setPanel(null)} /> : <BrowserPanel onClose={() => setPanel(null)} />)}
        </div>
      </div>
    </div>
  );
}

export default App;
