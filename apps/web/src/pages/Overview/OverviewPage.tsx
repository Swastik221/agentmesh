import { WorkspaceCanvas } from '../../components/canvas/WorkspaceCanvas';
import { AgentRoster } from '../../components/agents/AgentRoster';
import { getAppMode } from '../../config/env';

/** The product workspace keeps the live coordination canvas as its primary view. */
interface OverviewPageProps {
  focusView: boolean;
  onFocusViewChange: (focused: boolean) => void;
}

export function OverviewPage({ focusView, onFocusViewChange }: OverviewPageProps) {
  return (
    <div className="overview">
      {/*
       * AgentRoster was dead code before this: nothing rendered it anywhere
       * in the app. Placing it here, above the canvas, in Live Mode only, is
       * a placement decision made to give it a real location to test the
       * real-data fix through the actual UI; the canvas's own React-Flow
       * node graph below is untouched and still Demo-only pending a separate
       * decision on that.
       */}
      {getAppMode() === 'live' && <AgentRoster />}
      <section className="overview__canvas" aria-label="Workspace canvas">
        <div className="overview__canvas-frame">
          <WorkspaceCanvas focusView={focusView} onFocusViewChange={onFocusViewChange} />
        </div>
      </section>
    </div>
  );
}
