import { useEffect, useState } from 'react';
import { AgentMeshMessageType } from '@agentmesh/agent-protocol';
import type { TaskDTO } from '@agentmesh/shared';
import { api, ActivityEventItem } from '../lib/api';

/**
 * Live workspace state for a project: snapshot/delta/presence from the
 * existing WebSocket infrastructure, augmented with task.status,
 * artifact.created and activity.created events, plus REST fallbacks so the
 * UI survives refresh and reconnect.
 */

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

export interface TaskSummary {
  taskId: string;
  title: string;
  status: TaskDTO['status'];
  priority?: TaskDTO['priority'];
  agentName?: string | null;
  /** Live-only progress streamed by the executing agent (0-100). */
  progress?: number | null;
  /** Live-only message accompanying the latest progress report. */
  message?: string | null;
}

export interface WorkspaceLiveState {
  connected: boolean;
  isReconnecting: boolean;
  lastSequence: number;
  members: MemberPresence[];
  agents: AgentPresence[];
  tasks: TaskSummary[];
  activity: ActivityEventItem[];
}

function wsUrl(projectId: string): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) {
    return `${configured}/ws?projectId=${encodeURIComponent(projectId)}&clientType=user`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws?projectId=${encodeURIComponent(projectId)}&clientType=user`;
}

export function useWorkspaceSocket(projectId: string | null): {
  live: WorkspaceLiveState;
  refresh: () => Promise<void>;
} {
  const [live, setLive] = useState<WorkspaceLiveState>({
    connected: false,
    isReconnecting: false,
    lastSequence: 0,
    members: [],
    agents: [],
    tasks: [],
    activity: [],
  });

  const refresh = async () => {
    if (!projectId) return;
    try {
      const [agents, taskRes, activityRes] = await Promise.all([
        api.listAgents(projectId),
        api.listTasks(projectId),
        api.listActivity(projectId),
      ]);

      const agentLines: AgentPresence[] = agents.map((a) => ({
        agentId: a.id,
        name: a.name,
        ownerId: a.ownerId,
        provider: a.provider,
        status: a.status,
      }));
      setLive((prev) => {
        const agentStatusById = new Map(prev.agents.map((a) => [a.agentId, a.status]));
        return {
          ...prev,
          agents: agentLines.map((a) => ({
            ...a,
            status: agentStatusById.get(a.agentId) ?? a.status,
          })),
          tasks: taskRes.items.map((t) => ({
            taskId: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            agentName: t.responsibilities?.[0]?.agent?.name ?? null,
          })),
          activity: activityRes.events,
        };
      });
    } catch {
      // Offline refresh failures surface through `connected` state instead.
    }
  };

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let currentSeq = 0;
    let attempt = 0;

    const connect = () => {
      if (!active) return;
      try {
        ws = new WebSocket(wsUrl(projectId));

        ws.onopen = () => {
          if (!active) return;
          attempt = 0;
          setLive((prev) => ({ ...prev, connected: true, isReconnecting: false }));
          void refresh();
        };

        ws.onmessage = (event) => {
          if (!active) return;
          try {
            const data = JSON.parse(event.data) as Record<string, unknown>;
            handleLiveMessage(data);
          } catch {
            // Ignore non-JSON frames
          }
        };

        ws.onclose = () => {
          if (!active) return;
          setLive((prev) => ({ ...prev, connected: false, isReconnecting: true }));
          const delay = Math.min(1000 * 2 ** attempt, 10000);
          attempt += 1;
          reconnectTimer = setTimeout(connect, delay);
        };

        ws.onerror = () => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        };
      } catch {
        if (!active) return;
        setLive((prev) => ({ ...prev, connected: false, isReconnecting: true }));
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    const handleLiveMessage = (data: Record<string, unknown>) => {
      const type = data.type;
      const payload = (data.payload ?? {}) as Record<string, unknown>;

      switch (type) {
        case AgentMeshMessageType.WORKSPACE_SNAPSHOT: {
          currentSeq = (payload.sequence as number) ?? 0;
          const members = (payload.members as MemberPresence[]) ?? [];
          const agents = (payload.agents as AgentPresence[]) ?? [];
          const tasksFromSnapshot = (payload.tasks as TaskSummary[]) ?? [];
          setLive((prev) => ({
            ...prev,
            lastSequence: currentSeq,
            members,
            agents: [...agents],
            tasks: tasksFromSnapshot,
          }));
          break;
        }
        case AgentMeshMessageType.WORKSPACE_DELTA: {
          const sequence = payload.sequence as number;
          const changes = (payload.changes as Array<{
            entity: string;
            entityId: string;
            operation: string;
            fields?: Record<string, unknown>;
          }>) ?? [];

          if (sequence <= currentSeq) return;
          if (sequence > currentSeq + 1) {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  id: `resync-${Date.now()}`,
                  protocolVersion: '1.0',
                  projectId,
                  senderId: 'user-client',
                  type: AgentMeshMessageType.WORKSPACE_RESYNC_REQUEST,
                  payload: { lastKnownSequence: currentSeq, reason: 'SEQUENCE_GAP' },
                }),
              );
            }
            return;
          }

          currentSeq = sequence;
          setLive((prev) => {
            let agents = [...prev.agents];
            const tasks = [...prev.tasks];
            for (const change of changes) {
              if (change.entity === 'presence' && change.fields?.status) {
                const entityType = change.fields.entityType;
                const status = change.fields.status as 'ONLINE' | 'OFFLINE' | 'BUSY';
                if (entityType === 'agent') {
                  agents = agents.map((a) =>
                    a.agentId === change.entityId ? { ...a, status } : a,
                  );
                }
              } else if (change.entity === 'task' && change.operation === 'updated' && change.fields?.status) {
                const idx = tasks.findIndex((t) => t.taskId === change.entityId);
                if (idx !== -1) {
                  tasks[idx] = { ...tasks[idx], status: change.fields.status as TaskDTO['status'] };
                } else {
                  tasks.push({
                    taskId: change.entityId,
                    title: (change.fields?.title as string) ?? 'Task',
                    status: change.fields.status as TaskDTO['status'],
                    priority: change.fields?.priority as TaskDTO['priority'],
                  });
                }
              }
            }
            return { ...prev, lastSequence: currentSeq, agents, tasks };
          });
          break;
        }
        case AgentMeshMessageType.WORKSPACE_PRESENCE_CHANGED: {
          const entityType = payload.entityType as string;
          const entityId = payload.entityId as string;
          const status = payload.status as 'ONLINE' | 'OFFLINE' | 'BUSY';
          setLive((prev) => {
            if (entityType === 'agent') {
              const agents = prev.agents.map((a) =>
                a.agentId === entityId ? { ...a, status } : a,
              );
              return { ...prev, agents };
            }
            if (entityType === 'user') {
              const members = prev.members.map((m) =>
                m.userId === entityId ? { ...m, status: status as 'ONLINE' | 'OFFLINE' } : m,
              );
              return { ...prev, members };
            }
            return prev;
          });
          break;
        }
        case AgentMeshMessageType.TASK_STATUS: {
          const taskId = payload.taskId as string;
          const status = payload.status as TaskDTO['status'];
          const progress =
            typeof payload.progress === 'number' ? payload.progress : undefined;
          const message = typeof payload.message === 'string' ? payload.message : undefined;
          setLive((prev) => {
            const idx = prev.tasks.findIndex((t) => t.taskId === taskId);
            const tasks = [...prev.tasks];
            if (idx !== -1) {
              tasks[idx] = {
                ...tasks[idx],
                status,
                ...(progress !== undefined && { progress }),
                ...(message !== undefined && { message }),
              };
            } else {
              tasks.push({
                taskId,
                title: 'Task',
                status,
                ...(progress !== undefined && { progress }),
                ...(message !== undefined && { message }),
              });
            }
            return { ...prev, tasks };
          });
          break;
        }
        case AgentMeshMessageType.TASK_ASSIGNED: {
          const taskId = payload.taskId as string;
          const agentId = payload.agentId as string;
          setLive((prev) => {
            const assignee = prev.agents.find((a) => a.agentId === agentId);
            const tasks = prev.tasks.map((t) =>
              t.taskId === taskId ? { ...t, agentName: assignee?.name ?? t.agentName } : t,
            );
            return { ...prev, tasks };
          });
          break;
        }
        case AgentMeshMessageType.ACTIVITY_CREATED: {
          const event: ActivityEventItem = {
            id: payload.activityId as string,
            projectId: payload.projectId as string,
            type: payload.type as string,
            actorType: payload.actorType as string,
            actorId: payload.actorId as string,
            actorName: (payload.actorName as string | undefined) ?? null,
            taskId: (payload.taskId as string | undefined) ?? null,
            artifactId: (payload.artifactId as string | undefined) ?? null,
            message: (payload.message as string | undefined) ?? null,
            createdAt: (payload.createdAt as string | undefined) ?? new Date().toISOString(),
          };
          setLive((prev) => ({
            ...prev,
            activity: [event, ...prev.activity].slice(0, 200),
          }));
          break;
        }
        default:
          break;
      }
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
    // `connect` and `handleLiveMessage` are intentionally defined per-effect;
    // they close over the current `projectId`, so re-running on every render
    // would churn the socket. `refresh` is stable and re-fetches by design.
  }, [projectId]);

  return { live, refresh };
}