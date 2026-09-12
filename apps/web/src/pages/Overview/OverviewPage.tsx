import { WorkspaceCanvas } from '../../components/canvas/WorkspaceCanvas';
import { AgentRoster } from '../../components/agents/AgentRoster';

interface OverviewPageProps {
  focusView: boolean;
  onFocusViewChange: (focused: boolean) => void;
}

export function OverviewPage({ focusView, onFocusViewChange }: OverviewPageProps) {
  return (
    <div className="overview">
      <AgentRoster />
      <section className="overview__canvas" aria-label="Workspace canvas">
        <div className="overview__canvas-frame">
          <WorkspaceCanvas focusView={focusView} onFocusViewChange={onFocusViewChange} />
        </div>
      </section>
    </div>
  );
}
