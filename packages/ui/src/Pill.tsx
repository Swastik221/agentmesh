import type { ReactNode } from 'react';
import type { BadgeTone } from './StatusBadge';

export interface PillProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** Shows a small pulsing-free dot on the left, for live-ish states. */
  dot?: boolean;
  className?: string;
}

/**
 * Rounded status chip for header/footer chrome. Same colour vocabulary as
 * StatusBadge, but softer geometry — badges label data, pills label the app.
 */
export function Pill({ tone = 'neutral', children, dot = false, className }: PillProps) {
  return (
    <span className={`am-pill am-pill--${tone}${className ? ` ${className}` : ''}`}>
      {dot ? <i className="am-pill__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
