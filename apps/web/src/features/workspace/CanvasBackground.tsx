import type { CSSProperties } from 'react';

export function CanvasBackground() {
  return <div className="autumn-background" aria-hidden="true"><div className="falling-leaves">{Array.from({ length: 12 }, (_, i) => <span key={i} style={{ '--leaf-x': `${(i * 37) % 100}%`, '--leaf-delay': `${-i * 3.7}s`, '--leaf-duration': `${24 + i % 5 * 4}s` } as CSSProperties}><svg viewBox="0 0 24 24"><path d="M12 1 9 7 5 4 6 10 1 9 5 15 3 18 11 17 11 23 13 23 13 17 21 18 19 15 23 9 18 10 19 4 15 7Z" fill="currentColor"/></svg></span>)}</div></div>;
}
