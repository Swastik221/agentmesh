import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

/**
 * Read-only xterm.js view of a connected terminal.
 *
 * `disableStdin` means keystrokes in this view go nowhere. That is a courtesy;
 * the guarantee is the server, which accepts output only from the session's
 * own connector and refuses any input message.
 */
export interface TerminalViewerHandle {
  /** Replaces the screen with a snapshot. */
  reset(data: string): void;
  /** Appends live output. */
  write(data: string): void;
}

export interface TerminalViewerProps {
  cols?: number | null;
  rows?: number | null;
  /** Receives the handle once xterm is mounted, and null on unmount. */
  onReady(handle: TerminalViewerHandle | null): void;
  label: string;
}

export function TerminalViewer({ cols, rows, onReady, label }: TerminalViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: 'underline',
      // Output from a real pty already carries CRLF; the no-pty fallback
      // sends bare LF. Treating LF as CRLF renders both correctly.
      convertEol: true,
      scrollback: 2000,
      cols: cols ?? 100,
      rows: Math.min(rows ?? 28, 40),
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      theme: { background: '#07101e', foreground: '#d6e2f0', cursor: '#07101e' },
    });
    term.open(hostRef.current);
    termRef.current = term;
    onReadyRef.current({
      reset: (data) => {
        term.reset();
        term.write(data);
      },
      write: (data) => term.write(data),
    });
    return () => {
      onReadyRef.current(null);
      term.dispose();
      termRef.current = null;
    };
    // Created once: the parent keys this component per session, and size
    // changes are applied in place by the effect below.
  }, []);

  useEffect(() => {
    if (termRef.current && cols && rows) {
      termRef.current.resize(cols, Math.min(rows, 40));
    }
  }, [cols, rows]);

  return <div ref={hostRef} className="terminal-viewer" role="log" aria-label={`${label} (read-only)`} aria-live="off" />;
}
