import { useEffect, useState } from 'react';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

export interface MemberPresence {
  userId: string;
  displayName?: string | null;
  walletAddress?: string | null;
  role: string;
  status: 'ONLINE' | 'OFFLINE';
}

export interface AgentPresence {
  agentId: string;
  name: string;
  ownerId: string;
  provider: string;
  status: 'ONLINE' | 'OFFLINE' | 'BUSY';
}

export interface MultiplayerState {
  connected: boolean;
  isReconnecting: boolean;
  lastSequence: number;
  members: MemberPresence[];
  agents: AgentPresence[];
}

export function useMultiplayerPresence(projectId: string): MultiplayerState {
  const [state, setState] = useState<MultiplayerState>({
    connected: false,
    isReconnecting: false,
    lastSequence: 0,
    members: [],
    agents: [],
  });

  useEffect(() => {
    let active = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let currentSeq = 0;

    const connect = () => {
      if (!active) return;
      try {
        const wsUrl = `${WS_BASE_URL}/ws?projectId=${encodeURIComponent(projectId)}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (!active) return;
          setState((prev) => ({ ...prev, connected: true, isReconnecting: false }));
        };

        ws.onmessage = (event) => {
          if (!active) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === AgentMeshMessageType.WORKSPACE_SNAPSHOT) {
              const payload = data.payload;
              currentSeq = payload.sequence ?? 0;
              setState((prev) => ({
                ...prev,
                lastSequence: currentSeq,
                members: payload.members || [],
                agents: payload.agents || [],
              }));
            } else if (data.type === AgentMeshMessageType.WORKSPACE_DELTA) {
              const { sequence, changes } = data.payload as {
                sequence: number;
                changes: Array<{
                  entity: string;
                  entityId: string;
                  operation: string;
                  fields?: Record<string, unknown>;
                }>;
              };

              if (sequence <= currentSeq) {
                // Ignore duplicate or older delta
                return;
              }

              if (sequence > currentSeq + 1) {
                // Sequence gap detected: request resync
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      id: `resync-${Date.now()}`,
                      protocolVersion: '1.0',
                      projectId,
                      senderId: 'user-client',
                      type: AgentMeshMessageType.WORKSPACE_RESYNC_REQUEST,
                      payload: {
                        lastKnownSequence: currentSeq,
                        reason: 'SEQUENCE_GAP',
                      },
                    }),
                  );
                }
                return;
              }

              // Apply sequential delta
              currentSeq = sequence;
              setState((prev) => {
                let updatedMembers = [...prev.members];
                let updatedAgents = [...prev.agents];

                for (const change of changes) {
                  if (change.entity === 'presence') {
                    const { entityType, status } = (change.fields || {}) as {
                      entityType?: string;
                      status?: string;
                    };
                    if (entityType === 'user' && status) {
                      updatedMembers = updatedMembers.map((m) =>
                        m.userId === change.entityId
                          ? { ...m, status: status as 'ONLINE' | 'OFFLINE' }
                          : m,
                      );
                    } else if (entityType === 'agent' && status) {
                      updatedAgents = updatedAgents.map((a) =>
                        a.agentId === change.entityId
                          ? { ...a, status: status as 'ONLINE' | 'OFFLINE' | 'BUSY' }
                          : a,
                      );
                    }
                  }
                }

                return {
                  ...prev,
                  lastSequence: currentSeq,
                  members: updatedMembers,
                  agents: updatedAgents,
                };
              });
            } else if (data.type === AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED) {
              const { entityType, entityId, status, metadata } = data.payload;
              setState((prev) => {
                if (entityType === 'user') {
                  const existing = prev.members.find((m) => m.userId === entityId);
                  let updatedMembers: MemberPresence[];
                  if (existing) {
                    updatedMembers = prev.members.map((m) =>
                      m.userId === entityId ? { ...m, status: status as 'ONLINE' | 'OFFLINE' } : m,
                    );
                  } else {
                    updatedMembers = [
                      ...prev.members,
                      {
                        userId: entityId,
                        displayName: metadata?.displayName as string,
                        walletAddress: metadata?.walletAddress as string,
                        role: 'MEMBER',
                        status: status as 'ONLINE' | 'OFFLINE',
                      },
                    ];
                  }
                  return { ...prev, members: updatedMembers };
                } else if (entityType === 'agent') {
                  const updatedAgents = prev.agents.map((a) =>
                    a.agentId === entityId
                      ? { ...a, status: status as 'ONLINE' | 'OFFLINE' | 'BUSY' }
                      : a,
                  );
                  return { ...prev, agents: updatedAgents };
                }
                return prev;
              });
            }
          } catch {
            // Ignore non-JSON frames
          }
        };

        ws.onclose = () => {
          if (!active) return;
          setState((prev) => ({ ...prev, connected: false, isReconnecting: true }));
          reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        };
      } catch {
        if (!active) return;
        setState((prev) => ({ ...prev, connected: false, isReconnecting: true }));
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [projectId]);

  return state;
}
