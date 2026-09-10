import { useEffect, useRef } from 'react';
import { paintScene } from './ChapterScene';
import { damp, frameSettled, snap, startFrame } from './motion';

export const clampProgress = (value: number) => Math.max(0, Math.min(1, value));
export const segmentProgress = (progress: number, start: number, end: number) =>
  clampProgress((progress - start) / (end - start));

/**
 * One queued frame per scroll event; no autoplay clock, React render loop, or
 * scroll capture. A scene reports whether its damped values have caught up and
 * keeps its own frames running until they have — so releasing the wheel lets
 * the artwork glide the last stretch instead of freezing mid-motion.
 */
export function useScrollScene<T extends HTMLElement>(
  paint: (element: T, reducedMotion: boolean) => boolean | void,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let disposed = false;
    const update = (now?: number) => {
      frame = 0;
      if (disposed) return;
      startFrame(now);
      if (paint(element, preference.matches) === false) frame = requestAnimationFrame(update);
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const landing = element.closest('.landing');
    if (landing) resize.observe(landing);
    const scene = element.querySelector('.workshop-scene');
    if (scene) resize.observe(scene);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    preference.addEventListener('change', schedule);
    document.fonts.ready.then(schedule);
    update();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      preference.removeEventListener('change', schedule);
    };
  }, [paint]);
  return ref;
}

/** Returns false while a damped value in this chapter is still catching up. */
export function paintChapter(element: HTMLElement, reduced: boolean) {
  const ease = reduced ? snap : damp;
  const bounds = element.getBoundingClientRect();
  const target = reduced
    ? 1
    : clampProgress((innerHeight * 0.9 - bounds.top) / (innerHeight * 0.85));
  const progress = ease(element, 'chapter', target, 5.2);
  element.style.setProperty('--chapter-progress', String(progress));
  element.style.setProperty('--chapter-enter', String(segmentProgress(progress, 0, 0.55)));
  const cover = element.querySelector<HTMLElement>('.chapter-cover');
  if (cover) {
    const coverBounds = cover.getBoundingClientRect();
    const runway = element.querySelector<HTMLElement>('.chapter-runway');
    const coverTarget = reduced
      ? 1
      : runway
        ? clampProgress(
            (86 - runway.getBoundingClientRect().top) /
              Math.max(1, runway.offsetHeight - cover.offsetHeight),
          )
        : clampProgress((innerHeight - coverBounds.top) / (innerHeight + coverBounds.height * 0.3));
    // The cover carries the chapter's whole illustrated beat, so it is damped a
    // little slower than the surrounding copy: the drawing trails the scroll.
    const coverProgress = ease(cover, 'cover', coverTarget, 4.2);
    cover.style.setProperty('--cover-progress', String(coverProgress));
    const scene = cover.querySelector<HTMLElement>('.chapter-scene');
    if (scene) paintScene(scene, coverProgress);
  }
  if (!cover)
    element
      .querySelectorAll<HTMLElement>('.chapter-scene')
      .forEach((scene) => paintScene(scene, progress));
  // Each explanatory visual has its own range, so tall chapters don't finish before it appears.
  for (const visual of element.querySelectorAll<HTMLElement>('[data-scroll-visual]')) {
    const rect = visual.getBoundingClientRect();
    const visualTarget = reduced
      ? 1
      : clampProgress(
          (innerHeight * 0.88 - rect.top) / Math.min(innerHeight * 0.7, rect.height + 100),
        );
    const visualProgress = ease(visual, 'visual', visualTarget, 4.8);
    visual.style.setProperty('--visual-progress', String(visualProgress));
    visual.style.setProperty('--visual-first', String(segmentProgress(visualProgress, 0.05, 0.5)));
    visual.style.setProperty('--visual-second', String(segmentProgress(visualProgress, 0.4, 0.9)));
  }
  return reduced || frameSettled();
}
