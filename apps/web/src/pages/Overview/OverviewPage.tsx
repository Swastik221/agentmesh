import { WorkspaceCanvas } from '../../components/canvas/WorkspaceCanvas';

/** The product workspace keeps the live coordination canvas as its primary view. */
export function OverviewPage() {
  return (
    <div className="overview">
      <section className="overview__canvas" aria-label="Workspace canvas">
        <div className="overview__canvas-frame">
          <WorkspaceCanvas />
        </div>
      </section>
    </div>
  );
}
