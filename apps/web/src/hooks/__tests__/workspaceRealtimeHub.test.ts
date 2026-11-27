import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  subscribeWorkspaceRealtime,
  closeAllWorkspaceRealtime,
  openWorkspaceRealtimeCount,
  type RealtimeConnectionStatus,
} from '../useWorkspaceRealtime';

/** Minimal browser-WebSocket stand-in that records instances and sends. */
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Array<{ type: string; payload: unknown }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  closeAllWorkspaceRealtime();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared workspace realtime hub', () => {
  it('shares one socket between every subscriber of a workspace', () => {
    const a = subscribeWorkspaceRealtime('p1', {});
    const b = subscribeWorkspaceRealtime('p1', {});
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toContain('projectId=p1');
    expect(FakeSocket.instances[0].url).toContain('clientType=user');
    a.unsubscribe();
    b.unsubscribe();
  });

  it('lingers after the last subscriber leaves, so switching views does not reconnect', () => {
    const a = subscribeWorkspaceRealtime('p1', {});
    a.unsubscribe();
    vi.advanceTimersByTime(2000);
    const b = subscribeWorkspaceRealtime('p1', {}); // next view mounts
    expect(FakeSocket.instances).toHaveLength(1);
    b.unsubscribe();
    vi.advanceTimersByTime(6000);
    expect(openWorkspaceRealtimeCount()).toBe(0);
  });

  it('delivers deltas in order, drops duplicates, and asks for a resync on a gap', () => {
    const deltas: string[] = [];
    const sub = subscribeWorkspaceRealtime('p1', { callbacks: { onDelta: (d) => deltas.push(d.entityId) } });
    const ws = FakeSocket.instances[0];
    ws.open();
    ws.receive({ type: 'workspace.snapshot', payload: { sequence: 5 } });
    ws.receive({ type: 'workspace.delta', payload: { sequence: 6, changes: [{ entity: 'task', entityId: 't6', operation: 'updated' }] } });
    ws.receive({ type: 'workspace.delta', payload: { sequence: 6, changes: [{ entity: 'task', entityId: 't6-dup', operation: 'updated' }] } });
    ws.receive({ type: 'workspace.delta', payload: { sequence: 9, changes: [{ entity: 'task', entityId: 't9', operation: 'updated' }] } });
    expect(deltas).toEqual(['t6']);
    expect(ws.sent.at(-1)).toMatchObject({ type: 'workspace.resync.request', payload: { lastKnownSequence: 6 } });
    sub.unsubscribe();
  });

  it('reconnects with backoff after a drop, but stops when access is revoked', () => {
    const statuses: RealtimeConnectionStatus[] = [];
    const sub = subscribeWorkspaceRealtime('p1', { onStatus: (s) => statuses.push(s) });
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop(1006);
    expect(statuses.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.instances[1].open();
    FakeSocket.instances[1].drop(4003);
    expect(statuses.at(-1)).toBe('revoked');
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(2);
    sub.unsubscribe();
  });

  it('hands frames it does not interpret to onMessage, and ignores duplicate presence frames', () => {
    const frames: string[] = [];
    const deltas: string[] = [];
    const sub = subscribeWorkspaceRealtime('p1', {
      callbacks: { onMessage: (f) => frames.push(f.type), onDelta: (d) => deltas.push(d.entity) },
    });
    const ws = FakeSocket.instances[0];
    ws.open();
    ws.receive({ type: 'terminal.session.changed', payload: {} });
    ws.receive({ type: 'workspace.presence.changed', payload: { entityType: 'user', entityId: 'u', status: 'ONLINE' } });
    expect(frames).toEqual(['terminal.session.changed']);
    expect(deltas).toEqual([]);
    sub.unsubscribe();
  });

  it('sign-out closes every workspace connection', () => {
    subscribeWorkspaceRealtime('p1', {});
    subscribeWorkspaceRealtime('p2', {});
    expect(openWorkspaceRealtimeCount()).toBe(2);
    closeAllWorkspaceRealtime();
    expect(openWorkspaceRealtimeCount()).toBe(0);
  });
});
