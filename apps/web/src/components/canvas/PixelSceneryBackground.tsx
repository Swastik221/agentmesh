import { FallingLeaves } from './FallingLeaves';

export function PixelSceneryBackground() {
  return (
    <div className="mesh-scenery-backdrop" aria-hidden="true">
      <div className="mesh-scenery-image" />
      <div className="mesh-scenery-overlay" />
      <div className="mesh-scenery-grid" />
      <FallingLeaves />
    </div>
  );
}
