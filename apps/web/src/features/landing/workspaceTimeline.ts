export type Layout = 'phone' | 'tablet' | 'desktop';
type Point = { x: number; y: number };
const local = (p: number, a: number, b: number) => Math.max(0, Math.min(1, (p - a) / (b - a)));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** How fast `ease` is travelling at t — peaks at 3 in the middle of a drag. */
const easeRate = (t: number) => (t < 0.5 ? 12 * t * t : 3 * (2 - 2 * t) ** 2);
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
// A fixed title-bar grip. Both the pointer and terminal use this one coordinate frame.
export const grip = { x: 128, y: 20 };
/** How far a terminal trails its pointer at full drag speed. */
const LAG = 0.03;

/**
 * One developer's whole pass over the canvas, as continuous functions of
 * scroll progress: approach, press, drag, release. Nothing here switches on or
 * off — a beat that used to be a boolean is a 0→1 ramp instead, so any frame
 * between two beats is a real in-between rather than a jump, and scrolling
 * back up retraces exactly the same values.
 */
function actor(
  p: number,
  start: Point,
  end: Point,
  side: number,
  approach: number,
  grab: number,
  drag: number,
  release: number,
) {
  const at = (node: Point) => ({ x: node.x + grip.x, y: node.y + grip.y });
  const waiting = { x: start.x + side * 100, y: start.y - 65 };
  // Every ramp below is at least 0.05 of the section wide — roughly 200px of
  // scrolling — so none of them can complete inside a single wheel notch. A
  // shorter ramp is indistinguishable from a hard switch at reading speed.
  //
  // Closing on the grip, holding it, and letting go is one value, so the press
  // of the cursor and the lift of the terminal can never disagree.
  const hold = Math.min(local(p, grab - 0.035, grab + 0.02), 1 - local(p, release, release + 0.06));
  const carried = local(p, drag, release);
  // The two attribution lines hand over the same way the captions do — the
  // first is gone before the second arrives, never both at half.
  const selected = local(p, grab - 0.06, grab) * (1 - local(p, drag - 0.03, drag));
  const moved = local(p, drag, drag + 0.03);
  const working = local(p, release, release + 0.06);

  // Every stretch uses the same ease-in-out, so the pointer is at rest at each
  // seam between them. An ease-out here would leave the approach and the walk
  // away starting at full speed, which reads as a snap however smooth the
  // scroll driving it is.
  let base: Point;
  let mode: 'idle' | 'point' | 'grab' | 'drag' = 'idle';
  if (p < approach)
    base = mix({ x: waiting.x + side * 170, y: waiting.y + 100 }, waiting, ease(local(p, 0, 0.15)));
  else if (p < grab) {
    base = mix(waiting, at(start), ease(local(p, approach, grab)));
    mode = 'point';
  } else if (p < drag) {
    base = at(start);
    mode = 'grab';
  } else if (p < release) {
    base = mix(at(start), at(end), ease(carried));
    mode = 'drag';
  } else
    base = mix(
      at(end),
      { x: end.x + grip.x, y: end.y - 65 },
      ease(local(p, release, release + 0.08)),
    );

  // The terminal hangs off the grip and trails it by an amount proportional to
  // how fast the pointer is travelling: still at both ends of the drag, furthest
  // behind in the middle. That lag is what makes the pointer look like it is
  // pulling the block rather than the two sharing one coordinate.
  const rate = p > drag && p < release ? easeRate(carried) : 0;
  const lag = { x: (end.x - start.x) * rate * LAG, y: (end.y - start.y) * rate * LAG };
  const position =
    mode === 'drag'
      ? { x: base.x - grip.x - lag.x, y: base.y - grip.y - lag.y }
      : p < release
        ? start
        : end;

  // Hand tremor, derived from scroll rather than a clock so it reverses too.
  // It moves the pointer only; the terminal keeps a clean path.
  const tremor = 1 - hold * 0.75;
  return {
    cursor: {
      x: base.x + Math.sin(p * 21 + side) * 3.5 * tremor,
      y: base.y + Math.cos(p * 17 + side) * 2.5 * tremor,
      mode,
      hold,
    },
    node: {
      ...position,
      hold,
      // A dragged card leans out of the pull; capped so it stays a lean.
      tilt: clamp(lag.x * 0.16, -2.4, 2.4),
      selected,
      moved,
      working,
    },
  };
}

export const CAPTIONS = [
  'Two people bring their agents.',
  'Anand selects Orion.',
  'Anand moves Orion toward the wallet task.',
  'The frontend agent claims the identity panel.',
  'Swastik selects Vega.',
  'The backend agent takes the API task.',
  'One agent’s output becomes the next agent’s input.',
];
/** Progress at which each caption takes over from the one before it. */
export const BEATS = [0.15, 0.3, 0.45, 0.58, 0.7, 0.82];
/** How long a line takes to leave, and the next to arrive after it has gone. */
const HANDOVER = 0.028;

/**
 * Opacity of the line for `index`. Captions are all mounted and stacked in one
 * cell, so they never reflow — but they hand over in sequence rather than
 * crossfading: the outgoing line is fully gone before the incoming one starts.
 * Overlapping them put two sentences on top of each other at every boundary,
 * which read as doubled text rather than as a transition.
 */
export const beatOpacity = (p: number, index: number) => {
  const from = index === 0 ? -1 : BEATS[index - 1];
  const to = index >= BEATS.length ? 2 : BEATS[index];
  return Math.min(local(p, from, from + HANDOVER), 1 - local(p, to - HANDOVER, to));
};

export function workspaceTimeline(p: number, layout: Layout = 'desktop') {
  const points =
    layout === 'phone'
      ? [
          { x: -25, y: 60 },
          { x: 0, y: 0 },
          { x: 30, y: 640 },
          { x: 0, y: 585 },
          { x: 5, y: 265 },
        ]
      : layout === 'tablet'
        ? [
            { x: -60, y: 470 },
            { x: 0, y: 340 },
            { x: 460, y: 350 },
            { x: 405, y: 340 },
            { x: 205, y: 0 },
          ]
        : [
            { x: -95, y: 270 },
            { x: 0, y: 100 },
            { x: 925, y: 210 },
            { x: 830, y: 100 },
            { x: 420, y: 0 },
          ];
  const a = actor(p, points[0], points[1], -1, 0.15, 0.265, 0.3, 0.45);
  const b = actor(p, points[2], points[3], 1, 0.58, 0.675, 0.7, 0.82);
  const beat = BEATS.filter((edge) => p >= edge).length;
  return {
    anandCursor: a.cursor,
    swastikCursor: b.cursor,
    orionNode: a.node,
    vegaNode: b.node,
    board: points[4],
    stage: beat,
    // Two claim receipts, both mounted, each fading in on its own release.
    taskEvents: [local(p, 0.45, 0.51) * (1 - local(p, 0.78, 0.84)), local(p, 0.82, 0.88)],
    // `arrive` carries the arrowhead separately from the line, so the tip can
    // fade in over its own window instead of popping on at full draw.
    activeEdges: [
      { draw: local(p, 0.45, 0.55), arrive: local(p, 0.49, 0.55) },
      { draw: local(p, 0.82, 0.9), arrive: local(p, 0.84, 0.9) },
      { draw: local(p, 0.84, 0.93), arrive: local(p, 0.87, 0.93) },
    ],
    packet: local(p, 0.87, 0.98),
    packetOpacity: local(p, 0.84, 0.9),
    caption: CAPTIONS[beat],
  };
}
