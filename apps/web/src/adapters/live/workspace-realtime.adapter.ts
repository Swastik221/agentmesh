import { WorkspaceRealtimeAdapter, Workspace, User, Cursor, ProtocolEvent } from '../types';
import { wsClient } from '../../services/ws-client';
import { apiClient } from '../../services/api-client';

export const liveWorkspaceRealtimeAdapter: WorkspaceRealtimeAdapter = {
  async joinWorkspace(workspaceId: string, _user: User): Promise<Workspace> {
    wsClient.connect(workspaceId);
    return await apiClient.get<Workspace>(`/projects/${encodeURIComponent(workspaceId)}`);
  },

  publishCursor(_workspaceId: string, _cursor: Cursor): void {
    // Spatial UI cursor movements are local-only in INT-1 as backend WS protocol does not process custom cursor events
  },

  subscribeCursors(_workspaceId: string, _callback: (cursors: Cursor[]) => void): () => void {
    return () => {};
  },

  publishNodeMovement(_workspaceId: string, _nodeId: string, _position: { x: number; y: number }): void {
    // Spatial UI node movements are local-only in INT-1 as backend WS protocol does not process custom node movement events
  },

  subscribeNodeMovements(
    _workspaceId: string,
    _callback: (update: { nodeId: string; position: { x: number; y: number }; actor?: string }) => void
  ): () => void {
    return () => {};
  },

  publishEvent(_workspaceId: string, _event: ProtocolEvent): void {
    // Custom protocol events are handled via REST and WS snapshot/presence in INT-1
  },

  subscribeEvents(_workspaceId: string, _callback: (event: ProtocolEvent) => void): () => void {
    return () => {};
  },
};
