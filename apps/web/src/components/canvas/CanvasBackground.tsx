import { useViewport } from '@xyflow/react';
import { HexGrid } from '@agentmesh/ui';

/**
 * Binds the shared hex grid to the React Flow viewport so the texture pans and
 * zooms with the canvas instead of sitting behind it as a static wallpaper.
 */
export function CanvasBackground() {
  const { x, y, zoom } = useViewport();
  return <HexGrid offsetX={x} offsetY={y} scale={zoom} id="am-canvas-hex" />;
}
