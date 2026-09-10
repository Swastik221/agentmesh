import type { Cursor, ProtocolEvent, User, Workspace, WorkspaceRealtimeAdapter } from '../types';

export const PRIMARY_WORKSPACE_DEMO: Workspace = {
  id: 'checkout-demo',
  name: 'Checkout protocol workspace',
  inviteCode: 'MESH-2026',
  memberCount: 2,
  agentCount: 2,
  online: true,
};

const CURSOR_CHANNEL_NAME = 'agentmesh-workspace-cursors';
const NODE_CHANNEL_NAME = 'agentmesh-workspace-nodes';
const EVENT_CHANNEL_NAME = 'agentmesh-workspace-events';

export class DemoWorkspaceRealtimeAdapter implements WorkspaceRealtimeAdapter {
  private cursorChannel: BroadcastChannel | null = null;
  private nodeChannel: BroadcastChannel | null = null;
  private eventChannel: BroadcastChannel | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.cursorChannel = new BroadcastChannel(CURSOR_CHANNEL_NAME);
        this.nodeChannel = new BroadcastChannel(NODE_CHANNEL_NAME);
        this.eventChannel = new BroadcastChannel(EVENT_CHANNEL_NAME);
      } catch {
        // Fallback for environments where BroadcastChannel is blocked
      }
    }
  }

  async joinWorkspace(workspaceId: string, _user: User): Promise<Workspace> {
    return {
      ...PRIMARY_WORKSPACE_DEMO,
      id: workspaceId,
    };
  }

  publishCursor(_workspaceId: string, cursor: Cursor): void {
    if (this.cursorChannel) {
      this.cursorChannel.postMessage(cursor);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agentmesh:cursor', { detail: cursor }));
    }
  }

  subscribeCursors(
    _workspaceId: string,
    callback: (cursors: Cursor[]) => void
  ): () => void {
    const cursorMap = new Map<string, Cursor>();

    const handler = (cursor: Cursor) => {
      cursorMap.set(cursor.id, cursor);
      // Prune stale cursors older than 4 seconds
      const now = Date.now();
      for (const [id, c] of cursorMap.entries()) {
        if (now - c.updatedAt > 4000) cursorMap.delete(id);
      }
      callback(Array.from(cursorMap.values()));
    };

    const channelHandler = (event: MessageEvent<Cursor>) => {
      handler(event.data);
    };

    const windowHandler = (event: Event) => {
      const custom = event as CustomEvent<Cursor>;
      if (custom.detail) handler(custom.detail);
    };

    this.cursorChannel?.addEventListener('message', channelHandler);
    window.addEventListener('agentmesh:cursor', windowHandler);

    const pruneInterval = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, c] of cursorMap.entries()) {
        if (now - c.updatedAt > 4000) {
          cursorMap.delete(id);
          changed = true;
        }
      }
      if (changed) callback(Array.from(cursorMap.values()));
    }, 1200);

    return () => {
      this.cursorChannel?.removeEventListener('message', channelHandler);
      window.removeEventListener('agentmesh:cursor', windowHandler);
      clearInterval(pruneInterval);
    };
  }

  publishNodeMovement(
    _workspaceId: string,
    nodeId: string,
    position: { x: number; y: number },
    actor?: string
  ): void {
    const payload = { nodeId, position, actor, timestamp: Date.now() };
    if (this.nodeChannel) {
      this.nodeChannel.postMessage(payload);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agentmesh:node-move', { detail: payload }));
    }
  }

  subscribeNodeMovements(
    _workspaceId: string,
    callback: (update: { nodeId: string; position: { x: number; y: number }; actor?: string }) => void
  ): () => void {
    const channelHandler = (event: MessageEvent<{ nodeId: string; position: { x: number; y: number }; actor?: string }>) => {
      callback(event.data);
    };

    const windowHandler = (event: Event) => {
      const custom = event as CustomEvent<{ nodeId: string; position: { x: number; y: number }; actor?: string }>;
      if (custom.detail) callback(custom.detail);
    };

    this.nodeChannel?.addEventListener('message', channelHandler);
    window.addEventListener('agentmesh:node-move', windowHandler);

    return () => {
      this.nodeChannel?.removeEventListener('message', channelHandler);
      window.removeEventListener('agentmesh:node-move', windowHandler);
    };
  }

  publishEvent(_workspaceId: string, event: ProtocolEvent): void {
    if (this.eventChannel) {
      this.eventChannel.postMessage(event);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agentmesh:protocol-event', { detail: event }));
    }
  }

  subscribeEvents(
    _workspaceId: string,
    callback: (event: ProtocolEvent) => void
  ): () => void {
    const channelHandler = (e: MessageEvent<ProtocolEvent>) => {
      callback(e.data);
    };

    const windowHandler = (e: Event) => {
      const custom = e as CustomEvent<ProtocolEvent>;
      if (custom.detail) callback(custom.detail);
    };

    this.eventChannel?.addEventListener('message', channelHandler);
    window.addEventListener('agentmesh:protocol-event', windowHandler);

    return () => {
      this.eventChannel?.removeEventListener('message', channelHandler);
      window.removeEventListener('agentmesh:protocol-event', windowHandler);
    };
  }
}
