import { useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/navigation/Sidebar';
import { StatusBar } from './components/status/StatusBar';
import { WorkspaceCanvas } from './components/canvas/WorkspaceCanvas';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { navItems } from './data/workspace';
import type { SectionId } from './types';

/** Workspace shell: header, left rail, section content, status bar. */
export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const activeLabel = navItems.find((item) => item.id === activeSection)?.label ?? 'Overview';

  return (
    <div className="app-shell">
      <Header />

      <div className="app-body">
        <Sidebar activeSection={activeSection} onSelect={setActiveSection} />

        <main className="app-main">
          {activeSection === 'overview' ? (
            <WorkspaceCanvas />
          ) : (
            <PlaceholderPage title={activeLabel} />
          )}
        </main>
      </div>

      <StatusBar />
    </div>
  );
}

export default App;
