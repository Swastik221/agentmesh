export function navigate(path: string) {
  window.history.pushState({}, '', path);
  queueMicrotask(() => window.dispatchEvent(new PopStateEvent('popstate')));
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/**
 * True for a path this app can safely navigate to internally: starts with a
 * single `/`, never `//` (which a browser resolves as protocol-relative, i.e.
 * off-site) and never an absolute URL. Same rule the SPA link interceptor in
 * DemoRouter already applies to `<a href>` clicks; a redirect target read back
 * out of a query string needs the same check since that value is attacker
 * controlled.
 */
export function isSafeInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}
