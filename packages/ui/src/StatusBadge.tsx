import type { ReactNode } from 'react';

/**
 * Semantic tones. Each maps to exactly one accent colour so a reader can learn
 * the colour once: neutral = no claim yet, accent = claimed by an agent,
 * warning = auto-assigned and awaiting confirmation, success = done,
 * flow = live data movement, identity = wallet / ENS.
 */
export type BadgeTone = 'neutral' | 'accent' | 'warning' | 'success' | 'flow' | 'identity';

export interface StatusBadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** Renders a small filled square before the label. */
  marker?: boolean;
  className?: string;
}

export function StatusBadge({
  tone = 'neutral',
  children,
  marker = true,
  className,
}: StatusBadgeProps) {
  return (
    <span className={`am-badge am-badge--${tone}${className ? ` ${className}` : ''}`}>
      {marker ? <i className="am-badge__marker" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
