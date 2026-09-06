import { useState } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { WorkspaceCanvas } from './components/canvas/WorkspaceCanvas';
import { navItems } from './data/workspace';
import type { SectionId } from './types';

/**
 * Workspace shell: header, left rail, canvas, status bar.
 *
 * Only the Project section renders real content in this pass — the rest share
 * a placeholder so the navigation is honest about what exists so far.
 */
export function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('project');
  const activeLabel = navItems.find((item) => item.id === activeSection)?.label ?? 'Project';

  return (
    <div className="app-shell">
      <Header />

      <div className="app-body">
        <Sidebar activeSection={activeSection} onSelect={setActiveSection} />

        <main className="app-main">
          {activeSection === 'project' ? (
            <WorkspaceCanvas />
          ) : (
            <div className="app-placeholder">
              <span className="app-placeholder__title">{activeLabel}</span>
              <span className="app-placeholder__note">
                Section reserved. The workspace canvas lives under Project.
              </span>
            </div>
          )}
        </main>
      </div>

      <StatusBar />
    </div>
  );
}

export default App;
