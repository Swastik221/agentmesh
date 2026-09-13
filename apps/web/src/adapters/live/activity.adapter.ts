import { apiClient } from '../../services/api-client';

/**
 * Live activity feed.
 *
 * Reads the real, persisted workspace activity (`GET /projects/:id/activity`).
 * The human sentence for an event lives in `payload.message`, which the server
 * writes alongside any structured payload fields.
 */
export interface LiveActivityEvent {
  id: string;
  projectId: string;
  type: string;
  actorType: string;
  actorId: string;
  actorName: string | null;
  taskId: string | null;
  artifactId: string | null;
  payload?: { message?: string } | null;
  createdAt: string;
}

export async function listActivity(
  projectId: string,
  limit = 50,
): Promise<LiveActivityEvent[]> {
  const res = await apiClient.get<{ events: LiveActivityEvent[] }>(
    `/projects/${encodeURIComponent(projectId)}/activity`,
    { params: { limit } },
  );
  return res.events;
}
