import { FallingLeaves } from './FallingLeaves';

/**
 * The autumn lake scene shared by the whole workspace.
 *
 * It used to live only inside the canvas. Now a single instance is painted
 * once, behind every page (Project canvas, Agents, Tasks, Files, Activity),
 * so the animated scenery is the common backdrop the design is built on — and
 * there is exactly one leaf system running instead of one per view.
 */
export function WorkspaceScenery() {
  return (
    <div className="workspace-scenery" aria-hidden="true">
      <div className="workspace-scenery__image" />
      <div className="workspace-scenery__overlay" />
      <div className="workspace-scenery__grid" />
      <FallingLeaves />
    </div>
  );
}
