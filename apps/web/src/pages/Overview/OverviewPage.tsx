import { WorkspaceCanvas } from '../../components/canvas/WorkspaceCanvas';

/**
 * The workspace Overview is the canvas, full bleed.
 *
 * The floating AgentRoster that used to sit on top of the canvas has been
 * removed: it duplicated the real agents the canvas already renders as nodes
 * and collided with the canvas header in the top-left corner. The full agent
 * roster, register and connect UI still lives in the Agents view in the left
 * rail, so nothing real was lost.
 *
 * The Focus toggle is gone too: it only added a CSS class and changed nothing
 * a user could see, so it was a control that pretended to do something.
 */
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
