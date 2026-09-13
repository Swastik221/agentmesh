import { WorkspaceCanvas } from '../../components/canvas/WorkspaceCanvas';

interface OverviewPageProps {
  focusView: boolean;
  onFocusViewChange: (focused: boolean) => void;
}

/**
 * The workspace Overview is the canvas, full bleed.
 *
 * The floating AgentRoster that used to sit on top of the canvas has been
 * removed: it duplicated the real agents the canvas already renders as nodes
 * and collided with the canvas header in the top-left corner. The full agent
 * roster, register and connect UI still lives in the Agents view in the left
 * rail, so nothing real was lost.
 */
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
