export interface HexGridProps {
  /** Viewport pan, in px. Lets the grid track a canvas as it is dragged. */
  offsetX?: number;
  offsetY?: number;
  /** Viewport zoom. */
  scale?: number;
  /** Unique id — two grids on one page must not share a <pattern> id. */
  id?: string;
  className?: string;
}

/** Hexagon side length. Tile is √3·s wide and 3·s tall, which tiles seamlessly. */
const S = 16;
const HALF_W = (Math.sqrt(3) * S) / 2;
const TILE_W = Math.sqrt(3) * S;
const TILE_H = 3 * S;

/** Pointy-top hexagon centred on (cx, cy). */
function hexPath(cx: number, cy: number): string {
  const points: Array<[number, number]> = [
    [cx, cy - S],
    [cx + HALF_W, cy - S / 2],
    [cx + HALF_W, cy + S / 2],
    [cx, cy + S],
    [cx - HALF_W, cy + S / 2],
    [cx - HALF_W, cy - S / 2],
  ];
  return `M${points.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join('L')}Z`;
}

/**
 * Faint honeycomb backdrop. Deliberately low contrast against the base
 * background — it should read as texture, never compete with node content.
 *
 * The tile holds one whole hexagon plus the two half-hexagons that straddle the
 * left and right tile edges; together they interlock across repeats.
 */
export function HexGrid({ offsetX = 0, offsetY = 0, scale = 1, id = 'am-hex', className }: HexGridProps) {
  const patternTransform = `translate(${offsetX},${offsetY}) scale(${scale})`;

  return (
    <svg className={className ? `am-hexgrid ${className}` : 'am-hexgrid'} aria-hidden="true">
      <defs>
        <pattern
          id={id}
          width={TILE_W}
          height={TILE_H}
          patternUnits="userSpaceOnUse"
          patternTransform={patternTransform}
        >
          <path
            className="am-hexgrid__cell"
            d={`${hexPath(TILE_W / 2, S)}${hexPath(0, 2.5 * S)}${hexPath(TILE_W, 2.5 * S)}`}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
