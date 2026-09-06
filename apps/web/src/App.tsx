import { useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/navigation/Sidebar';
import { StatusBar } from './components/status/StatusBar';
import { OverviewPage } from './pages/Overview/OverviewPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { useBackendHealth } from './hooks/useBackendHealth';
import { navItems } from './data/workspace';
import type { SectionId } from './types';

/**
 * Workspace shell: header, left rail, section content, status bar.
 *
 * Backend health is polled once here and passed down, so the header and the
 * status bar always agree and only one poll is in flight.
 */
export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const health = useBackendHealth();
  const activeLabel = navItems.find((item) => item.id === activeSection)?.label ?? 'Overview';

  return (
    <div className="app-shell">
      <Header backendState={health.state} databaseState={health.database} />

      <div className="app-body">
        <Sidebar activeSection={activeSection} onSelect={setActiveSection} />

        <main className="app-main">
          {activeSection === 'overview' ? (
            <OverviewPage />
          ) : (
            <PlaceholderPage title={activeLabel} />
          )}
        </main>
      </div>

      <StatusBar health={health} />
    </div>
  );
}

export default App;
