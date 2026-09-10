import { WorkspaceCanvas } from '../../components/canvas/WorkspaceCanvas';

/** The product workspace keeps the live coordination canvas as its primary view. */
interface OverviewPageProps {
  focusView: boolean;
  onFocusViewChange: (focused: boolean) => void;
}

export function OverviewPage({ focusView, onFocusViewChange }: OverviewPageProps) {
  return (
    <div className="overview">
      <section className="overview__canvas" aria-label="Workspace canvas">
        <div className="overview__canvas-frame">
          <WorkspaceCanvas focusView={focusView} onFocusViewChange={onFocusViewChange} />
        </div>
      </section>
    </div>
  );
}
