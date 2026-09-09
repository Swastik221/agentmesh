import { WorkspaceCanvas } from '../../components/canvas/WorkspaceCanvas';

export interface OverviewPageProps {
  name: string;
}

/** The product workspace keeps the live coordination canvas as its primary view. */
export function OverviewPage({ name }: OverviewPageProps) {
  return (
    <div className="overview">
      <div className="overview__head">
        <span className="overview__project">{name}</span>
      </div>
      <section className="overview__canvas" aria-label="Workspace canvas">
        <div className="overview__canvas-frame">
          <WorkspaceCanvas />
        </div>
      </section>
    </div>
  );
}