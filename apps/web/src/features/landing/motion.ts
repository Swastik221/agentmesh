/**
 * Frame-rate independent smoothing for the scroll scenes.
 *
 * Scroll events arrive in uneven bursts, so writing raw scroll progress
 * straight into a transform reads as a stutter — the thing being animated
 * teleports by whatever distance the last wheel tick covered. Every scene
 * instead keeps a *displayed* value that chases its scroll-derived target with
 * an exponential decay. The decay is expressed per second rather than per
 * frame, so a 144Hz display and a 60Hz display travel the same curve, and the
 * value lands exactly on the target once it is close enough. Scrubbing back to
 * a scroll position therefore still reproduces that position exactly.
 */

const values = new WeakMap<Element, Map<string, number>>();
/** Below this the value is snapped, so a scene can report itself settled. */
const EPSILON = 0.0004;

let delta = 1 / 60;
let stamp = 0;
let settled = true;

/**
 * Opens one animation frame. Several scenes paint inside the same frame, so
 * the elapsed time is only recomputed when the frame timestamp actually
 * changes; otherwise the second scene would see a delta of nearly zero.
 */
export function startFrame(now = performance.now()) {
  if (now !== stamp) {
    // A backgrounded tab returns one enormous delta; clamping keeps the first
    // frame after it from jumping the whole distance at once.
    delta = stamp ? Math.min(0.05, Math.max(0.001, (now - stamp) / 1000)) : 1 / 60;
    stamp = now;
  }
  settled = true;
}

/** True when every value damped since `startFrame` has reached its target. */
export const frameSettled = () => settled;

/** Moves the stored value for `key` towards `target` and returns it. */
export function damp(element: Element, key: string, target: number, lambda = 7) {
  let stored = values.get(element);
  if (!stored) values.set(element, (stored = new Map()));
  const current = stored.get(key);
  if (current === undefined) {
    stored.set(key, target);
    return target;
  }
  const distance = target - current;
  if (Math.abs(distance) < EPSILON) {
    stored.set(key, target);
    return target;
  }
  const next = target - distance * Math.exp(-lambda * delta);
  stored.set(key, next);
  settled = false;
  return next;
}

/** Jumps straight to a value — reduced motion, and remounts. */
export function snap(element: Element, key: string, target: number) {
  let stored = values.get(element);
  if (!stored) values.set(element, (stored = new Map()));
  stored.set(key, target);
  return target;
}

/** Ease used wherever a block should start and stop gently rather than slide. */
export const smoothStep = (p: number) => p * p * (3 - 2 * p);
export const easeOut = (p: number) => 1 - (1 - p) * (1 - p) * (1 - p);
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
