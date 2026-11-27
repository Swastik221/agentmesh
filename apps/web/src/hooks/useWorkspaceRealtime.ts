import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentMeshMessageType, PROTOCOL_VERSION } from '@agentmesh/agent-protocol';
import { envConfig } from '../config/env';

/**
 * Live Workspace Realtime subscription.
 *
 * Subscribes to the real project websocket. Confirmed directly against
 * `websocket.server.ts`: a connection is only treated as a user client, and
 * only then gets a snapshot or any `broadcastToProjectUsers` message (every
 * delta and presence change), when its URL carries `clientType=user`.
 * Without it the server silently sends nothing meant for users; this was
 * exactly the bug in `useMultiplayerPresence.ts`, since removed in favor of
 * this hook (`AgentRoster.tsx` now reuses `useAgents` + this hook directly,
 * the same pattern `LiveAgentsView` already uses).
 *
 * Six entity types actually broadcast today, confirmed by reading every
 * `recordAndBroadcastDelta` call site on the server: `task`,
 * `taskResponsibility` (manual claim only, not coordinator auto-assign),
 * `artifact`, `dependency`, `activity`, `presence`. `execution`, `agent` and
 * `member` are valid entity values in the protocol schema but no code path
 * emits them (execution only in one narrow connector case); do not expect
 * deltas for those here. That gap is server-side and out of scope for this
 * PRD.
 *
 * This hook holds no workspace state of its own. Every existing hook
 * (`useAgents`, `useTasks`, ...) already owns its own REST-fetched state and
 * its own `refetch()`; hand-merging a delta's partial `fields` into that
 * state here would be a second, easily-drifting source of truth. Instead
 * every delta is handed to `onDelta` as it arrives, in server-broadcast
 * order, and callers decide whether it means "refetch my own data." A
 * resync (buffer exhausted, or a gap too large for it) instead calls
 * `onResync`, confirmed live to matter: the fallback snapshot itself is
 * capped at 20 tasks, so on a large-enough gap it cannot carry every change
 * back on its own, and a caller that only reacted to individual deltas would
 * stay silently short of tasks 21+ until something else happened to refetch.
 *
 * Sequence handling: the server sends a fresh `workspace.snapshot`
 * unconditionally on every new connection, cold start or reconnect alike, so
 * this hook never needs to proactively request one on open. A
 * `workspace.resync.request` is only sent when an incoming delta's sequence
 * shows a real gap; the server then either replays the missing deltas from
 * its buffer or answers with `workspace.resync.required` followed by a
 * fresh snapshot, which this hook adopts as the new baseline either way. A
 * delta at or behind the current sequence is a duplicate and is dropped. Only
 * one resync request is kept in flight at a time; a second gap noticed
 * before the first reply lands does not send a second request.
 */

export type RealtimeDeltaEntity =
  | 'member'
  | 'agent'
  | 'presence'
  | 'task'
  | 'taskResponsibility'
  | 'execution'
  | 'artifact'
  | 'activity'
  | 'dependency';

export interface RealtimeDeltaEvent {
  entity: RealtimeDeltaEntity;
  entityId: string;
  operation: 'created' | 'updated' | 'removed';
  fields?: Record<string, unknown>;
}

/**
 * `revoked`: the server closed the connection because access was withdrawn
 * (membership removed, credentials revoked, or the session is no longer
 * valid). The hub stops reconnecting; the UI should send the user elsewhere.
 */
export type RealtimeConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'revoked';

export interface UseWorkspaceRealtimeResult {
  status: RealtimeConnectionStatus;
  /** The last sequence number this hook has applied; 0 before the first snapshot. */
  sequence: number;
  /**
   * Sends a protocol envelope on this hook's socket (terminal subscribe and
   * the like). Returns false when not connected; callers resend once
   * `status` is 'connected' again, since subscriptions do not survive a
   * reconnect.
   */
  send: (type: string, payload: unknown) => boolean;
}

/** A frame this hook does not interpret itself, handed to `onMessage`. */
export interface RealtimeFrame {
  type: string;
  payload: unknown;
  correlationId?: string;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;
/**
 * How long a workspace connection stays open after its last subscriber goes
 * away. Switching between workspace views unmounts one view and mounts the
 * next; without this the socket would close and reopen, and teammates would
 * see this user flicker offline and online.
 */
const LINGER_MS = 5000;
/** Server close codes that mean "you no longer have access": do not reconnect. */
const ACCESS_LOST_CODES = new Set([4001, 4003]);

export interface UseWorkspaceRealtimeCallbacks {
  /** A single change landed, in server-broadcast order. */
  onDelta?: (event: RealtimeDeltaEvent) => void;
  /**
   * A workspace.snapshot was just applied: on the very first connection, and
   * again on any resync (a detected sequence gap the buffer could replay,
   * or one it could not, both send a fresh snapshot). The snapshot itself is
   * a thin summary (tasks capped at 20, most recent first, confirmed against
   * the server) and is never a substitute for real data: called so a caller
   * can refetch its own REST-backed state and be sure it is actually
   * complete, rather than only as current as whatever fit in the summary.
   */
  onResync?: () => void;
  /** Any other frame (terminal output, terminal session changes, errors). */
  onMessage?: (frame: RealtimeFrame) => void;
}

interface Subscriber {
  callbacks: { current: UseWorkspaceRealtimeCallbacks | undefined };
  setStatus: (s: RealtimeConnectionStatus) => void;
  setSequence: (n: number) => void;
}

/**
 * One WebSocket per workspace, shared by every component that subscribes to
 * it. Owns the connection lifecycle (backoff, sequencing, gap detection,
 * resync) and fans each frame out to its subscribers.
 */
class WorkspaceRealtimeHub {
  private socket: WebSocket | null = null;
  private subscribers = new Set<Subscriber>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private currentSeq = 0;
  private resyncPending = false;
  private closed = false;
  status: RealtimeConnectionStatus = 'disconnected';

  constructor(
    readonly projectId: string,
    private readonly onDispose: (hub: WorkspaceRealtimeHub) => void,
  ) {}

  subscribe(sub: Subscriber): () => void {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    this.subscribers.add(sub);
    sub.setStatus(this.status);
    sub.setSequence(this.currentSeq);
    if (!this.socket && !this.reconnectTimer && this.status !== 'revoked') this.connect();
    return () => {
      this.subscribers.delete(sub);
      if (this.subscribers.size === 0) {
        this.lingerTimer = setTimeout(() => this.dispose(), LINGER_MS);
      }
    };
  }

  send(type: string, payload: unknown): boolean {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(
      JSON.stringify({
        id: crypto.randomUUID(),
        protocolVersion: PROTOCOL_VERSION,
        projectId: this.projectId,
        senderId: 'user-client',
        timestamp: new Date().toISOString(),
        type,
        payload,
      }),
    );
    return true;
  }

  dispose(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
      this.socket = null;
    }
    this.setStatus('disconnected');
    this.onDispose(this);
  }

  private setStatus(status: RealtimeConnectionStatus): void {
    this.status = status;
    for (const s of this.subscribers) s.setStatus(status);
  }

  private setSequence(seq: number): void {
    this.currentSeq = seq;
    for (const s of this.subscribers) s.setSequence(seq);
  }

  private emit<K extends keyof UseWorkspaceRealtimeCallbacks>(
    key: K,
    ...args: Parameters<NonNullable<UseWorkspaceRealtimeCallbacks[K]>>
  ): void {
    for (const s of [...this.subscribers]) {
      const fn = s.callbacks.current?.[key] as ((...a: unknown[]) => void) | undefined;
      try {
        fn?.(...args);
      } catch (err) {
        console.error('[realtime] subscriber failed', err);
      }
    }
  }

  private requestResync(ws: WebSocket, lastKnownSequence: number, reason: 'SEQUENCE_GAP' | 'RECONNECT') {
    // Hand-built: the protocol package's builder imports Node's `crypto`,
    // which Vite externalizes for the browser.
    this.resyncPending = true;
    ws.send(
      JSON.stringify({
        id: crypto.randomUUID(),
        protocolVersion: PROTOCOL_VERSION,
        projectId: this.projectId,
        senderId: 'user-client',
        timestamp: new Date().toISOString(),
        type: AgentMeshMessageType.WORKSPACE_RESYNC_REQUEST,
        payload: { lastKnownSequence, reason },
      }),
    );
  }

  private connect(): void {
    if (this.closed) return;
    this.reconnectTimer = null;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    const base = envConfig.wsUrl.replace(/\/$/, '');
    const ws = new WebSocket(`${base}/ws?projectId=${encodeURIComponent(this.projectId)}&clientType=user`);
    this.socket = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('connected');
      // The server sends a fresh snapshot on every new connection.
    };

    ws.onmessage = (event: MessageEvent) => {
      let data: { type?: string; payload?: unknown };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data || typeof data.type !== 'string') return;

      switch (data.type) {
        case AgentMeshMessageType.WORKSPACE_SNAPSHOT: {
          const payload = data.payload as { sequence?: number };
          this.resyncPending = false;
          this.setSequence(payload.sequence ?? 0);
          this.emit('onResync');
          return;
        }
        case AgentMeshMessageType.WORKSPACE_RESYNC_REQUIRED: {
          const payload = data.payload as { sequence?: number };
          if (typeof payload.sequence === 'number') this.setSequence(payload.sequence);
          return;
        }
        case AgentMeshMessageType.WORKSPACE_DELTA: {
          const payload = data.payload as { sequence: number; changes: RealtimeDeltaEvent[] };
          if (typeof payload.sequence !== 'number' || !Array.isArray(payload.changes)) return;
          if (payload.sequence <= this.currentSeq) return; // duplicate or already applied
          if (payload.sequence > this.currentSeq + 1) {
            if (!this.resyncPending) this.requestResync(ws, this.currentSeq, 'SEQUENCE_GAP');
            return;
          }
          this.resyncPending = false;
          this.setSequence(payload.sequence);
          for (const change of payload.changes) this.emit('onDelta', change);
          return;
        }
        case AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED:
          // Every presence change also arrives as a sequenced `presence`
          // delta; forwarding this too made every subscriber refetch twice.
          return;
        default:
          this.emit('onMessage', data as RealtimeFrame);
          return;
      }
    };

    ws.onclose = (event: CloseEvent) => {
      this.socket = null;
      if (this.closed) return;
      if (ACCESS_LOST_CODES.has(event.code)) {
        this.setStatus('revoked');
        return;
      }
      this.setStatus('reconnecting');
      this.reconnectAttempts += 1;
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_DELAY_MS);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };

    ws.onerror = () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
  }
}

const hubs = new Map<string, WorkspaceRealtimeHub>();

function hubFor(projectId: string): WorkspaceRealtimeHub {
  let hub = hubs.get(projectId);
  if (!hub) {
    hub = new WorkspaceRealtimeHub(projectId, (h) => {
      if (hubs.get(h.projectId) === h) hubs.delete(h.projectId);
    });
    hubs.set(projectId, hub);
  }
  return hub;
}

/**
 * Non-React subscription to a workspace's shared stream; the hook below is a
 * thin wrapper over it. Returns an unsubscribe function.
 */
export function subscribeWorkspaceRealtime(
  projectId: string,
  subscriber: {
    callbacks?: UseWorkspaceRealtimeCallbacks;
    onStatus?: (status: RealtimeConnectionStatus) => void;
    onSequence?: (sequence: number) => void;
  },
): { unsubscribe: () => void; send: (type: string, payload: unknown) => boolean } {
  const hub = hubFor(projectId);
  const unsubscribe = hub.subscribe({
    callbacks: { current: subscriber.callbacks },
    setStatus: subscriber.onStatus ?? (() => {}),
    setSequence: subscriber.onSequence ?? (() => {}),
  });
  return { unsubscribe, send: (type, payload) => hub.send(type, payload) };
}

/** Closes every workspace connection now. Call on sign-out. */
export function closeAllWorkspaceRealtime(): void {
  for (const hub of [...hubs.values()]) hub.dispose();
}

/** Number of open workspace hubs; for tests. */
export function openWorkspaceRealtimeCount(): number {
  return hubs.size;
}

/**
 * Subscribes to the workspace's shared realtime stream. Any number of
 * components may call this for the same workspace; they share one socket.
 */
export function useWorkspaceRealtime(
  projectId: string | null,
  callbacks?: UseWorkspaceRealtimeCallbacks,
): UseWorkspaceRealtimeResult {
  const [status, setStatus] = useState<RealtimeConnectionStatus>('disconnected');
  const [sequence, setSequence] = useState(0);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!projectId) {
      setStatus('disconnected');
      return;
    }
    const hub = hubFor(projectId);
    const unsubscribe = hub.subscribe({ callbacks: callbacksRef, setStatus, setSequence });
    return () => {
      unsubscribe();
      setStatus('disconnected');
    };
  }, [projectId]);

  const send = useCallback(
    (type: string, payload: unknown): boolean => (projectId ? (hubs.get(projectId)?.send(type, payload) ?? false) : false),
    [projectId],
  );

  return { status, sequence, send };
}
