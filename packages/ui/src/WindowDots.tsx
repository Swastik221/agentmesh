export interface WindowDotsProps {
  className?: string;
}

/**
 * The three macOS-style dots that mark a panel as a terminal window.
 * Purely decorative — they are not buttons and carry no state.
 */
export function WindowDots({ className }: WindowDotsProps) {
  return (
    <span className={className ? `am-dots ${className}` : 'am-dots'} aria-hidden="true">
      <i className="am-dots__dot am-dots__dot--close" />
      <i className="am-dots__dot am-dots__dot--min" />
      <i className="am-dots__dot am-dots__dot--max" />
    </span>
  );
}
