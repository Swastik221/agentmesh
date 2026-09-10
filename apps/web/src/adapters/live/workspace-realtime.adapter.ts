import { WorkspaceRealtimeAdapter, Workspace, User, Cursor, ProtocolEvent } from '../types';
import { wsClient } from '../../services/ws-client';
import { apiClient } from '../../services/api-client';

export const liveWorkspaceRealtimeAdapter: WorkspaceRealtimeAdapter = {
  async joinWorkspace(workspaceId: string, _user: User): Promise<Workspace> {
    wsClient.connect(workspaceId);
    try {
      const res = await apiClient.get<Workspace>(`/projects/${encodeURIComponent(workspaceId)}`);
      return res;
    } catch {
      return {
        id: workspaceId,
        name: 'Live AgentMesh Workspace',
        inviteCode: 'LIVE-2026',
        memberCount: 2,
        agentCount: 2,
        online: true,
      };
    }
  },

  publishCursor(workspaceId: string, cursor: Cursor): void {
    wsClient.send({
      type: 'CURSOR_MOVE',
      workspaceId,
      cursor,
    });
  },

  subscribeCursors(_workspaceId: string, callback: (cursors: Cursor[]) => void): () => void {
    return wsClient.onMessage((data: unknown) => {
      if (typeof data === 'object' && data !== null && (data as { type?: string }).type === 'CURSOR_UPDATE') {
        callback((data as { cursors: Cursor[] }).cursors || []);
      }
    });
  },

  publishNodeMovement(workspaceId: string, nodeId: string, position: { x: number; y: number }): void {
    wsClient.send({
      type: 'NODE_MOVE',
      workspaceId,
      nodeId,
      position,
    });
  },

  subscribeNodeMovements(
    _workspaceId: string,
    callback: (update: { nodeId: string; position: { x: number; y: number }; actor?: string }) => void
  ): () => void {
    return wsClient.onMessage((data: unknown) => {
      if (typeof data === 'object' && data !== null && (data as { type?: string }).type === 'NODE_MOVED') {
        callback(data as { nodeId: string; position: { x: number; y: number }; actor?: string });
      }
    });
  },

  publishEvent(workspaceId: string, event: ProtocolEvent): void {
    wsClient.send({
      type: 'PROTOCOL_EVENT',
      workspaceId,
      event,
    });
  },

  subscribeEvents(_workspaceId: string, callback: (event: ProtocolEvent) => void): () => void {
    return wsClient.onMessage((data: unknown) => {
      if (typeof data === 'object' && data !== null && (data as { type?: string }).type === 'PROTOCOL_EVENT') {
        callback((data as { event: ProtocolEvent }).event);
      }
    });
  },
};
