import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CoordinationMessageType } from '@agentmesh/agent-protocol';
import { AlertTriangle, Eye, EyeOff, Lock, Plug, Radar, RefreshCw, Sparkles, SquareTerminal, Unplug, Users } from 'lucide-react';
import { currentProjectId } from '../../utils/currentProjectId';
import { authSessionService } from '../../services/auth-session';
import { envConfig } from '../../config/env';
import { useAgents } from '../../hooks/useAgents';
import { useWorkspaceRealtime, type RealtimeFrame, type RealtimeDeltaEvent } from '../../hooks/useWorkspaceRealtime';
import {
  listTerminalSessions,
  setTerminalVisibility,
  disconnectTerminal,
  getAgentContext,
  type LiveTerminalSession,
  type WorkspaceContext,
} from '../../adapters/live/terminal.adapter';
import { TerminalViewer, type TerminalViewerHandle } from '../../components/terminals/TerminalViewer';
import { ViewHeader, type WorkspaceViewProps } from './WorkspaceViews';

const errorText = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

/**
 * Connected terminals: your own (private or shared) and teammates' shared
 * ones. Watching is read-only. Only the owner sees share / disconnect
 * controls, and the server refuses them from anyone else regardless.
 */
export function TerminalsView({ onOpenCanvas }: WorkspaceViewProps) {
  const projectId = currentProjectId();
  const me = authSessionService.getCurrentUser()?.id ?? null;
  const [sessions, setSessions] = useState<LiveTerminalSession[]>([]);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [watchingId, setWatchingId] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const viewerRef = useRef<TerminalViewerHandle | null>(null);
  const lastSeqRef = useRef(0);
  const watchingRef = useRef<string | null>(null);
  watchingRef.current = watchingId;

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setSessions(await listTerminalSessions(projectId));
      setError(null);
    } catch (reason) {
      setError(errorText(reason, 'Could not load terminals.'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendRef = useRef<(type: string, payload: unknown) => boolean>(() => false);

  const onMessage = useCallback(
    (frame: RealtimeFrame) => {
      const payload = (frame.payload ?? {}) as Record<string, unknown>;
      switch (frame.type) {
        case CoordinationMessageType.TERMINAL_SESSION_CHANGED: {
          const session = payload.session as LiveTerminalSession;
          setSessions((prev) => {
            const visible = session.status !== 'CLOSED' && (session.visibility === 'SHARED' || session.owner.userId === me);
            const rest = prev.filter((s) => s.terminalId !== session.terminalId);
            return visible ? [session, ...rest] : rest;
          });
          return;
        }
        case CoordinationMessageType.TERMINAL_SNAPSHOT: {
          if (payload.terminalId !== watchingRef.current) return;
          viewerRef.current?.reset(
            `${payload.truncated ? '\x1b[2m[earlier output not kept]\x1b[0m\r\n' : ''}${payload.data as string}`,
          );
          lastSeqRef.current = payload.seq as number;
          return;
        }
        case CoordinationMessageType.TERMINAL_OUTPUT: {
          if (payload.terminalId !== watchingRef.current) return;
          const seq = payload.seq as number;
          if (lastSeqRef.current > 0 && seq !== lastSeqRef.current + 1) {
            // A gap (a dropped frame): ask again for a clean snapshot.
            sendRef.current(CoordinationMessageType.TERMINAL_SUBSCRIBE, { terminalId: watchingRef.current });
            return;
          }
          lastSeqRef.current = seq;
          viewerRef.current?.write(payload.data as string);
          return;
        }
        case CoordinationMessageType.TERMINAL_REVOKED: {
          if (payload.terminalId === watchingRef.current) {
            setWatchingId(null);
            setNotice(payload.reason === 'CLOSED' ? 'That terminal was disconnected.' : 'Its owner stopped sharing that terminal.');
          }
          setSessions((prev) =>
            payload.reason === 'CLOSED' ? prev.filter((s) => s.terminalId !== payload.terminalId) : prev,
          );
          return;
        }
        case 'error': {
          if (watchingRef.current && payload.code === 'NOT_FOUND') {
            setWatchingId(null);
            setNotice('That terminal is no longer available to you.');
          }
          return;
        }
        default:
          return;
      }
    },
    [me],
  );

  const { status, send } = useWorkspaceRealtime(
    projectId,
    useMemo(() => ({ onMessage, onResync: () => void load() }), [onMessage, load]),
  );
  sendRef.current = send;

  // (Re)subscribe whenever the socket is (re)connected and a viewer is mounted;
  // subscriptions do not survive a reconnect.
  useEffect(() => {
    if (!watchingId || !viewerReady || status !== 'connected') return;
    lastSeqRef.current = 0;
    send(CoordinationMessageType.TERMINAL_SUBSCRIBE, { terminalId: watchingId });
    return () => {
      send(CoordinationMessageType.TERMINAL_UNSUBSCRIBE, { terminalId: watchingId });
    };
  }, [watchingId, viewerReady, status, send]);

  const toggleShare = async (session: LiveTerminalSession) => {
    if (!projectId) return;
    setBusyId(session.terminalId);
    setNotice(null);
    try {
      await setTerminalVisibility(projectId, session.terminalId, session.visibility === 'SHARED' ? 'PRIVATE' : 'SHARED');
      await load();
    } catch (reason) {
      setNotice(errorText(reason, 'Could not change sharing.'));
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (session: LiveTerminalSession) => {
    if (!projectId) return;
    if (!window.confirm(`Disconnect "${session.name}" from the workspace? It keeps running on your machine.`)) return;
    setBusyId(session.terminalId);
    try {
      await disconnectTerminal(projectId, session.terminalId);
      if (watchingId === session.terminalId) setWatchingId(null);
      await load();
    } catch (reason) {
      setNotice(errorText(reason, 'Could not disconnect.'));
    } finally {
      setBusyId(null);
    }
  };

  const watching = sessions.find((s) => s.terminalId === watchingId) ?? null;
  const mine = sessions.filter((s) => s.owner.userId === me);
  const shared = sessions.filter((s) => s.owner.userId !== me);
  const command = projectId
    ? `agentmesh terminal --workspace ${projectId} --agent <agent-id> --connect-token <token> --url ${envConfig.apiUrl} --share -- claude`
    : '';

  const renderSession = (session: LiveTerminalSession) => {
    const isMine = session.owner.userId === me;
    const busy = busyId === session.terminalId;
    return (
      <article key={session.terminalId} className={`terminal-card${watchingId === session.terminalId ? ' is-watching' : ''}`}>
        <header>
          <SquareTerminal size={16} />
          <strong>{session.name}</strong>
          <span className={`terminal-pill terminal-pill--${session.status.toLowerCase()}`}>{session.status.toLowerCase()}</span>
          <span className={`terminal-pill terminal-pill--${session.visibility.toLowerCase()}`}>
            {session.visibility === 'SHARED' ? <><Users size={11} /> shared, read-only</> : <><Lock size={11} /> private</>}
          </span>
        </header>
        <dl>
          <div><dt>Owner</dt><dd>{isMine ? 'You' : session.owner.displayName ?? 'Teammate'}</dd></div>
          <div><dt>Agent</dt><dd>{session.agent?.name ?? '—'}</dd></div>
          <div><dt>Where</dt><dd><code>{session.cwd ?? '—'}</code></dd></div>
          {session.command && <div><dt>Running</dt><dd><code>{session.command}</code></dd></div>}
        </dl>
        <footer>
          <button type="button" onClick={() => setWatchingId(watchingId === session.terminalId ? null : session.terminalId)}>
            <Eye size={13} /> {watchingId === session.terminalId ? 'Stop watching' : 'Watch'}
          </button>
          {isMine && (
            <>
              <button type="button" disabled={busy} onClick={() => void toggleShare(session)}>
                {session.visibility === 'SHARED' ? <><EyeOff size={13} /> Stop sharing</> : <><Users size={13} /> Share read-only</>}
              </button>
              <button type="button" disabled={busy} onClick={() => void disconnect(session)}>
                <Unplug size={13} /> Disconnect
              </button>
            </>
          )}
        </footer>
      </article>
    );
  };

  return (
    <section className="workspace-view">
      <ViewHeader
        eyebrow="WORKSPACE / TERMINALS"
        title="Connected terminals"
        description="Terminals run on each developer's own machine. Yours are private until you share them; shared ones are read-only for everyone else."
        onOpenCanvas={onOpenCanvas}
      />

      {!projectId ? (
        <p className="workspace-view__note"><Sparkles /> Open a project to see its terminals.</p>
      ) : (
        <>
          <details className="terminal-howto">
            <summary><Plug size={14} /> Connect a terminal from your machine</summary>
            <p>
              Get a connect token from <strong>Agents → Connect this agent</strong>, then run your agent through AgentMesh.
              Leave out <code>--share</code> to keep it private; you can share or stop sharing here at any time.
              Common secret formats are redacted before output leaves your machine, but that is best effort: don't print secrets into a shared terminal.
            </p>
            <code className="terminal-howto__cmd">{command}</code>
          </details>

          {notice && (
            <p className="workspace-view__note" role="status">{notice} <button type="button" onClick={() => setNotice(null)}>Dismiss</button></p>
          )}

          {watching && (
            <div className="terminal-watch">
              <div className="terminal-watch__bar">
                <SquareTerminal size={14} /> {watching.name}
                <span>{watching.owner.userId === me ? 'your terminal' : `${watching.owner.displayName ?? 'teammate'}'s terminal`} · read-only</span>
                {status !== 'connected' && <span className="terminal-watch__status">{status}…</span>}
                {watching.status === 'DISCONNECTED' && <span className="terminal-watch__status">owner offline; showing last output</span>}
              </div>
              <TerminalViewer
                key={watching.terminalId}
                label={watching.name}
                cols={watching.cols}
                rows={watching.rows}
                onReady={(handle) => {
                  viewerRef.current = handle;
                  setViewerReady(Boolean(handle));
                }}
              />
            </div>
          )}

          {loading && sessions.length === 0 ? (
            <p role="status" className="workspace-view__note">Loading terminals…</p>
          ) : error ? (
            <div role="alert" className="workspace-view__note"><span>{error}</span> <button type="button" onClick={() => void load()}>Retry</button></div>
          ) : sessions.length === 0 ? (
            <p className="workspace-view__note"><Sparkles /> No terminals connected yet. Connect one with the command above.</p>
          ) : (
            <div className="terminal-groups">
              {mine.length > 0 && (
                <div>
                  <h2 className="workspace-list__label">YOUR TERMINALS</h2>
                  <div className="terminal-list">{mine.map(renderSession)}</div>
                </div>
              )}
              {shared.length > 0 && (
                <div>
                  <h2 className="workspace-list__label">SHARED WITH YOU</h2>
                  <div className="terminal-list">{shared.map(renderSession)}</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Agent awareness
// ---------------------------------------------------------------------------

const REFRESH_ENTITIES = new Set(['task', 'taskResponsibility', 'dependency', 'artifact', 'presence', 'agent', 'execution']);

/**
 * What an agent knows about the rest of the workspace before it starts: the
 * same structured context `agentmesh context` prints and agents receive over
 * the protocol. Lets a developer check what their agent will see, and what
 * would collide with the work they are about to hand it.
 */
export function AwarenessView({ onOpenCanvas }: WorkspaceViewProps) {
  const projectId = currentProjectId();
  const me = authSessionService.getCurrentUser()?.id ?? null;
  const { agents } = useAgents(projectId);
  const [agentId, setAgentId] = useState<string>('');
  const [filesInput, setFilesInput] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [context, setContext] = useState<WorkspaceContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to one of your own agents: that is whose view you most likely want.
  useEffect(() => {
    if (agentId || agents.length === 0) return;
    setAgentId((agents.find((a) => a.ownerId === me) ?? agents[0]).id);
  }, [agents, agentId, me]);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setLoading(true);
    try {
      setContext(await getAgentContext(projectId, agentId, { filePaths: files }));
      setError(null);
    } catch (reason) {
      setError(errorText(reason, 'Could not load agent context.'));
    } finally {
      setLoading(false);
    }
  }, [projectId, agentId, files]);

  useEffect(() => {
    void load();
  }, [load]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void loadRef.current(), 400);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useWorkspaceRealtime(
    projectId,
    useMemo(
      () => ({
        onDelta: (event: RealtimeDeltaEvent) => {
          if (REFRESH_ENTITIES.has(event.entity)) scheduleRefresh();
        },
        onMessage: (frame: RealtimeFrame) => {
          if (frame.type === CoordinationMessageType.TERMINAL_SESSION_CHANGED) scheduleRefresh();
        },
        onResync: scheduleRefresh,
      }),
      [scheduleRefresh],
    ),
  );

  const applyFocus = (e: FormEvent) => {
    e.preventDefault();
    setFiles(filesInput.split(/[\s,]+/).map((f) => f.trim()).filter(Boolean));
  };

  return (
    <section className="workspace-view">
      <ViewHeader
        eyebrow="WORKSPACE / AWARENESS"
        title="What your agent knows"
        description="The structured context an agent gets before it starts: who else is working on what, where, and what overlaps. Agents read the same thing with `agentmesh context`."
        onOpenCanvas={onOpenCanvas}
      />

      {!projectId ? (
        <p className="workspace-view__note"><Sparkles /> Open a project to see agent awareness.</p>
      ) : agents.length === 0 ? (
        <p className="workspace-view__note"><Sparkles /> Register an agent first.</p>
      ) : (
        <>
          <form className="workspace-inline-form awareness-focus" onSubmit={applyFocus}>
            <label>
              As agent
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.ownerId === me ? ' (yours)' : ''}</option>
                ))}
              </select>
            </label>
            <label>
              About to change <span style={{ opacity: 0.6 }}>(optional files or folders)</span>
              <input value={filesInput} onChange={(e) => setFilesInput(e.target.value)} placeholder="api/auth, web/src/login.tsx" />
            </label>
            <button type="submit" className="workspace-list-tools__primary">Check overlaps</button>
            <button type="button" onClick={() => void load()} aria-label="Refresh"><RefreshCw size={14} /></button>
          </form>

          {error ? (
            <div role="alert" className="workspace-view__note"><span>{error}</span> <button type="button" onClick={() => void load()}>Retry</button></div>
          ) : !context ? (
            <p role="status" className="workspace-view__note">{loading ? 'Loading context…' : 'No context yet.'}</p>
          ) : (
            <div className="awareness-grid">
              <article className="awareness-card awareness-card--wide">
                <h2><AlertTriangle size={15} /> Check before starting</h2>
                {context.overlaps.length === 0 ? (
                  <p className="awareness-muted">No overlaps with other agents' work{files.length ? ` on ${files.join(', ')}` : ''}.</p>
                ) : (
                  <ul>
                    {context.overlaps.map((o) => (
                      <li key={`${o.kind}-${o.taskId}`}>
                        <span className={`terminal-pill terminal-pill--${o.kind === 'FILE' ? 'disconnected' : 'shared'}`}>{o.kind === 'FILE' ? 'files' : 'task'}</span> {o.explanation}
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="awareness-card">
                <h2><Radar size={15} /> Other agents</h2>
                {context.agents.length === 0 ? (
                  <p className="awareness-muted">No other agents in this workspace.</p>
                ) : (
                  <ul>
                    {context.agents.map((a) => (
                      <li key={a.agentId}>
                        <strong>{a.online ? '●' : '○'} {a.name}</strong>{' '}
                        <span className="awareness-muted">{a.provider} · {a.owner.ensName || a.owner.displayName || 'unknown owner'}{a.capabilities.length ? ` · ${a.capabilities.join(', ')}` : ''}</span>
                        {a.currentTasks.map((t) => (
                          <div key={t.taskId} className="awareness-task">
                            {t.status} · {t.title}{t.filePaths.length ? <> · <code>{t.filePaths.join(', ')}</code></> : null}
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="awareness-card">
                <h2>Blocked and unassigned</h2>
                {(() => {
                  const rows = context.tasks.filter((t) => t.blocked || t.assignedAgents.length === 0);
                  if (rows.length === 0) return <p className="awareness-muted">Nothing blocked or waiting for an owner.</p>;
                  return (
                    <ul>
                      {rows.map((t) => (
                        <li key={t.taskId}>
                          <strong>{t.title}</strong>{' '}
                          <span className="awareness-muted">
                            {t.assignedAgents.length === 0 ? (t.openOffer ? 'open offer' : 'unassigned') : t.assignedAgents.map((a) => a.name).join(', ')}
                            {t.blocked ? ` · waiting on ${t.dependsOn.filter((d) => !d.satisfied).map((d) => d.taskTitle || d.artifactName || d.type).join(', ') || 'a dependency'}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </article>

              <article className="awareness-card">
                <h2>Artifacts and worktrees</h2>
                {context.artifacts.length === 0 && context.worktrees.length === 0 ? (
                  <p className="awareness-muted">Nothing produced yet.</p>
                ) : (
                  <ul>
                    {context.artifacts.slice(0, 8).map((a) => (
                      <li key={a.artifactId}>{a.name} <span className="awareness-muted">{a.type} v{a.version} · {a.status}{a.producedBy ? ` · ${a.producedBy.name}` : ''}</span></li>
                    ))}
                    {context.worktrees.map((w) => (
                      <li key={w.worktreeId}><code>{w.branch ?? 'worktree'}</code> <span className="awareness-muted">{w.agentName}</span></li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="awareness-card">
                <h2><SquareTerminal size={15} /> Terminals it can see</h2>
                {context.terminals.length === 0 ? (
                  <p className="awareness-muted">No shared terminals. Private terminals are never shown to other agents.</p>
                ) : (
                  <ul>
                    {context.terminals.map((t) => (
                      <li key={t.terminalId}>{t.name} <span className="awareness-muted">{t.owner.displayName ?? 'teammate'}{t.agent ? ` / ${t.agent.name}` : ''} · {t.visibility.toLowerCase()} · {t.status.toLowerCase()}</span></li>
                    ))}
                  </ul>
                )}
              </article>

              {context.decisions.length > 0 && (
                <article className="awareness-card">
                  <h2>Project decisions</h2>
                  <ul>
                    {context.decisions.map((d, i) => <li key={i}><span className="awareness-muted">[{d.type}]</span> {d.title}</li>)}
                  </ul>
                </article>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
