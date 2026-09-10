export function navigate(path: string) {
  window.history.pushState({}, '', path);
  queueMicrotask(() => window.dispatchEvent(new PopStateEvent('popstate')));
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
