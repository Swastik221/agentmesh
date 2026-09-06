import { AgentRoster } from '../../components/agents/AgentRoster';
import { WorkspaceCanvas } from '../../components/canvas/WorkspaceCanvas';
import { currentProject } from '../../data/workspace';

/**
 * Overview: the project it belongs to, which agents could join, and the live
 * mesh between them. The canvas takes the remaining height so it stays the
 * focus once the roster above it is read.
 */
export function OverviewPage() {
  return (
    <div className="overview">
      <header className="overview__head">
        <h1 className="overview__project">{currentProject.name}</h1>
        <span className="overview__slug">{currentProject.slug}</span>
      </header>

      <AgentRoster />

      <section className="overview__canvas" aria-label="Workspace canvas">
        <h2 className="section-heading">Workspace</h2>
        <div className="overview__canvas-frame">
          <WorkspaceCanvas />
        </div>
      </section>
    </div>
  );
}
