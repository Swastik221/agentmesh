/** Current project id from the /workspace/:id route, or null on /canvas. */
export function currentProjectId(): string | null {
  const match = /\/workspace\/([^/]+)/.exec(location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}
