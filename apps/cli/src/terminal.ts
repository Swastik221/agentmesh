import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { CoordinationMessageType, redactSecrets } from '@agentmesh/agent-protocol';
import { AgentMeshClient } from './client.js';
import { resolveCredentials, type CredentialOptions } from './credentials.js';

/**
 * `agentmesh terminal`: run a command (your shell, `claude`, `codex`, ...) in
 * your own terminal, exactly as you would without AgentMesh, and mirror its
 * output to the workspace.
 *
 * - The process runs on this machine. Your keyboard goes straight to it; the
 *   workspace never sends input (the server refuses to relay any).
 * - The session is PRIVATE unless you pass --share or share it from the
 *   workspace UI. Private output reaches only you.
 * - Output is redacted for common secret formats before it leaves this
 *   machine. That is best effort: do not print secrets into a shared terminal.
 * - If the connection drops, the command keeps running and the session
 *   resumes when the connector reconnects.
 */

export interface TerminalOptions extends CredentialOptions {
  /** Command and arguments. Defaults to $SHELL. */
  command?: string[];
  name?: string;
  share?: boolean;
}

/** Text sent per message, in characters; 4 bytes per char worst case stays under the 16 KB cap. */
const CHUNK_CHARS = 4000;
const FLUSH_INTERVAL_MS = 25;
/** Output held while disconnected, so a short blip loses nothing. */
const MAX_PENDING_CHARS = 64 * 1024;

/** Builds the argv that runs `command` inside a pseudo-terminal. */
export function ptyCommand(command: string[], platform = process.platform): { file: string; args: string[] } | null {
  if (platform === 'darwin' || platform === 'freebsd') {
    // BSD script: script [-q] file command...
    return { file: 'script', args: ['-q', '/dev/null', ...command] };
  }
  if (platform === 'linux') {
    // util-linux script takes a single shell command string.
    const quoted = command.map((c) => `'${c.replace(/'/g, `'\\''`)}'`).join(' ');
    return { file: 'script', args: ['-qfec', quoted, '/dev/null'] };
  }
  return null;
}

/** Shows `~` instead of the home directory, so the label does not leak a username. */
export function displayCwd(cwd: string, home = os.homedir()): string {
  return cwd === home ? '~' : cwd.startsWith(`${home}${path.sep}`) ? `~${cwd.slice(home.length)}` : cwd;
}

const notice = (text: string) => process.stderr.write(`\r\n\x1b[2m[agentmesh] ${text}\x1b[0m\r\n`);

export async function runTerminal(options: TerminalOptions): Promise<void> {
  const creds = resolveCredentials(options);
  const command = options.command?.length ? options.command : [process.env.SHELL || '/bin/sh'];
  const name = (options.name || path.basename(command[0])).slice(0, 80);
  const cwdLabel = displayCwd(process.cwd());

  let terminalId: string | undefined;
  let visibility: 'PRIVATE' | 'SHARED' = options.share ? 'SHARED' : 'PRIVATE';
  let detached = false;
  let pending = '';
  let flushTimer: NodeJS.Timeout | null = null;

  const client = new AgentMeshClient({
    serverUrl: creds.serverUrl,
    workspaceId: creds.workspaceId,
    agentId: creds.agentId,
    ...(creds.connectToken ? { connectToken: creds.connectToken } : {}),
    ...(creds.sessionId ? { sessionId: creds.sessionId } : {}),
    connectionRole: 'terminal',
    quiet: true,
    maxReconnectAttempts: 1000,
    onRegistered: () => {
      // Every (re)connect re-registers; passing the id resumes the same session.
      client.sendFrame(CoordinationMessageType.TERMINAL_OPEN, {
        ...(terminalId && { terminalId }),
        name: redactSecrets(name).text,
        command: redactSecrets(command.join(' ')).text.slice(0, 200),
        cwd: cwdLabel,
        visibility,
        ...(process.stdout.columns && { cols: process.stdout.columns }),
        ...(process.stdout.rows && { rows: process.stdout.rows }),
      });
    },
    onFrame: (frame) => {
      const payload = (frame.payload ?? {}) as Record<string, unknown>;
      switch (frame.type) {
        case CoordinationMessageType.TERMINAL_OPENED: {
          const first = !terminalId;
          terminalId = payload.terminalId as string;
          visibility = payload.visibility as typeof visibility;
          if (first) {
            notice(
              visibility === 'SHARED'
                ? `"${name}" is shared read-only with your workspace. Teammates can watch, nobody else can type.`
                : `"${name}" is connected privately. Only you can see it. Share it from the workspace, or rerun with --share.`,
            );
          } else if (payload.resumed) {
            notice('reconnected');
          }
          flush();
          return true;
        }
        case CoordinationMessageType.TERMINAL_UPDATE:
          if (payload.visibility && payload.visibility !== visibility) {
            visibility = payload.visibility as typeof visibility;
            notice(visibility === 'SHARED' ? 'now shared read-only with your workspace' : 'no longer shared; only you can see it');
          }
          return true;
        case CoordinationMessageType.TERMINAL_CLOSE:
          // Disconnected from the UI. The local process is yours and keeps running.
          detached = true;
          notice('disconnected from the workspace from the UI; this terminal keeps running locally');
          client.disconnect();
          return true;
        case 'error': {
          const code = payload.code as string | undefined;
          if (code && code !== 'INVALID_MESSAGE') notice(`${code}: ${payload.message as string}`);
          return true;
        }
        default:
          return false;
      }
    },
  });

  function flush(): void {
    flushTimer = null;
    if (detached || !terminalId || !client.isConnected() || !pending) return;
    const text = redactSecrets(pending).text;
    pending = '';
    for (let i = 0; i < text.length; i += CHUNK_CHARS) {
      client.sendFrame(CoordinationMessageType.TERMINAL_OUTPUT, { terminalId, data: text.slice(i, i + CHUNK_CHARS) });
    }
  }

  function mirror(text: string): void {
    if (detached) return;
    pending += text;
    if (pending.length > MAX_PENDING_CHARS) pending = pending.slice(pending.length - MAX_PENDING_CHARS);
    flushTimer ??= setTimeout(flush, FLUSH_INTERVAL_MS);
  }

  await client.connect();

  const pty = process.stdin.isTTY ? ptyCommand(command) : null;
  if (process.stdin.isTTY && !pty) {
    notice(`no pseudo-terminal support on ${process.platform}; running without one (interactive tools may misbehave)`);
  }

  const child: ChildProcess = pty
    ? spawn(pty.file, pty.args, { stdio: ['inherit', 'pipe', 'inherit'] })
    : spawn(command[0], command.slice(1), { stdio: ['inherit', 'pipe', 'pipe'] });

  const decoder = new StringDecoder('utf8');
  child.stdout?.on('data', (buf: Buffer) => {
    process.stdout.write(buf);
    mirror(decoder.write(buf));
  });
  child.stderr?.on('data', (buf: Buffer) => {
    process.stderr.write(buf);
    mirror(buf.toString('utf8'));
  });

  const onResize = () => {
    if (terminalId && client.isConnected() && process.stdout.columns && process.stdout.rows) {
      client.sendFrame(CoordinationMessageType.TERMINAL_UPDATE, {
        terminalId,
        cols: process.stdout.columns,
        rows: process.stdout.rows,
      });
    }
  };
  process.stdout.on('resize', onResize);

  // Ctrl+C belongs to the child, which shares this terminal; the connector
  // only exits when the child does.
  const ignore = () => {};
  process.on('SIGINT', ignore);

  await new Promise<void>((resolve) => {
    child.on('error', (err) => {
      notice(`could not start ${command[0]}: ${err.message}`);
      resolve();
    });
    child.on('exit', (code) => {
      process.exitCode = code ?? 0;
      resolve();
    });
  });

  process.off('SIGINT', ignore);
  process.stdout.off('resize', onResize);
  if (flushTimer) clearTimeout(flushTimer);
  flush();
  if (terminalId && client.isConnected() && !detached) {
    client.sendFrame(CoordinationMessageType.TERMINAL_CLOSE, { terminalId });
    await new Promise((r) => setTimeout(r, 100));
  }
  client.disconnect();
}
