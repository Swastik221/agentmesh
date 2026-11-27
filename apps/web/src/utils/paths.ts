/**
 * `a` and `b` refer to the same file, or one is a directory containing the
 * other. Mirrors the server's overlap check (workspace-context.service.ts).
 */
export function pathsOverlap(a: string, b: string): boolean {
  const norm = (p: string) => p.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}
