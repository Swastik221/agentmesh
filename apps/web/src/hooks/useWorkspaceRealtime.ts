import { useEffect, useRef, useState } from 'react';
import { AgentMeshMessageType, PROTOCOL_VERSION } from '@agentmesh/agent-protocol';
import { envConfig } from '../config/env';

/**
 * Live Workspace Realtime subscription.
 *
 * Subscribes to the real project websocket. Confirmed directly against
 * `websocket.server.ts`: a connection is only treated as a user client, and
 * only then gets a snapshot or any `broadcastToProjectUsers` message (every
 * delta and presence change), when its URL carries `clientType=user`.
 * Without it the server silently sends nothing meant for users; this is
 * exactly the bug in the pre-existing, unused `useMultiplayerPresence.ts`,
 * left untouched since nothing renders it.
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

export type RealtimeConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface UseWorkspaceRealtimeResult {
  status: RealtimeConnectionStatus;
  /** The last sequence number this hook has applied; 0 before the first snapshot. */
  sequence: number;
}

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;

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
}

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

    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    let currentSeq = 0;
    let resyncPending = false;

    const requestResync = (ws: WebSocket, lastKnownSequence: number, reason: 'SEQUENCE_GAP' | 'RECONNECT') => {
      // Not using createWorkspaceResyncRequestMessage from @agentmesh/agent-protocol
      // here: its builder module imports Node's `crypto` directly, which Vite
      // externalizes for the browser, so calling it throws inside this
      // onmessage handler (silently, since nothing here was catching it) and
      // the request never gets built, let alone sent. Confirmed live: no
      // resync.request ever reached the server until this was hand-built
      // instead. The envelope itself is otherwise exactly what that builder
      // would produce; only the browser-unsafe id generation is avoided.
      const msg = {
        id: crypto.randomUUID(),
        protocolVersion: PROTOCOL_VERSION,
        projectId,
        senderId: 'user-client',
        timestamp: new Date().toISOString(),
        type: AgentMeshMessageType.WORKSPACE_RESYNC_REQUEST,
        payload: { lastKnownSequence, reason },
      };
      resyncPending = true;
      ws.send(JSON.stringify(msg));
    };

    const connect = () => {
      if (!active) return;
      setStatus(reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

      const base = envConfig.wsUrl.replace(/\/$/, '');
      const url = `${base}/ws?projectId=${encodeURIComponent(projectId)}&clientType=user`;
      const ws = new WebSocket(url);
      socket = ws;

      ws.onopen = () => {
        if (!active) return;
        reconnectAttempts = 0;
        setStatus('connected');
        // No resync.request needed here: the server sends a fresh snapshot
        // unconditionally on every new connection, this one included.
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!active) return;
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
            currentSeq = payload.sequence ?? 0;
            resyncPending = false;
            setSequence(currentSeq);
            callbacksRef.current?.onResync?.();
            return;
          }

          case AgentMeshMessageType.WORKSPACE_RESYNC_REQUIRED: {
            // The server sends a fresh snapshot right after this, which will
            // re-baseline the sequence on its own; adopt the number here too
            // so nothing in between reads as a gap.
            const payload = data.payload as { sequence?: number };
            if (typeof payload.sequence === 'number') {
              currentSeq = payload.sequence;
              setSequence(currentSeq);
            }
            return;
          }

          case AgentMeshMessageType.WORKSPACE_DELTA: {
            const payload = data.payload as { sequence: number; changes: RealtimeDeltaEvent[] };
            if (typeof payload.sequence !== 'number' || !Array.isArray(payload.changes)) return;

            if (payload.sequence <= currentSeq) {
              return; // duplicate or already-applied delta
            }
            if (payload.sequence > currentSeq + 1) {
              // One resync request in flight is enough: two deltas can each
              // observe the same gap before the first reply lands (confirmed
              // live), and firing a second is pure waste, not a correctness
              // issue on its own, since a replayed duplicate is still caught
              // by the check above once the first reply has landed.
              if (!resyncPending) requestResync(ws, currentSeq, 'SEQUENCE_GAP');
              return;
            }

            currentSeq = payload.sequence;
            resyncPending = false;
            setSequence(currentSeq);
            for (const change of payload.changes) {
              callbacksRef.current?.onDelta?.(change);
            }
            return;
          }

          case AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED: {
            const payload = data.payload as { entityType: 'user' | 'agent'; entityId: string; status: string };
            callbacksRef.current?.onDelta?.({
              entity: 'presence',
              entityId: payload.entityId,
              operation: 'updated',
              fields: { entityType: payload.entityType, status: payload.status },
            });
            return;
          }

          default:
            return;
        }
      };

      ws.onclose = () => {
        if (!active) return;
        socket = null;
        setStatus('reconnecting');
        reconnectAttempts += 1;
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_DELAY_MS);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      setStatus('disconnected');
    };
  }, [projectId]);

  return { status, sequence };
}
