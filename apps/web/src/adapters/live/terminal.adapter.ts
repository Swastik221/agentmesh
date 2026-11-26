import type {
  TerminalSessionSummary,
  TerminalVisibility,
  WorkspaceContext,
} from '@agentmesh/agent-protocol';
import { apiClient } from '../../services/api-client';

/**
 * Live connected terminals and agent context.
 *
 * Terminals run on each developer's own machine (`agentmesh terminal`); the
 * workspace only ever lists them, streams their output read-only, and lets
 * the owner share, unshare or disconnect them. There is no way to send input
 * from here, and the server enforces that, not this file.
 */

export type LiveTerminalSession = TerminalSessionSummary;
export type { TerminalVisibility, WorkspaceContext };

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;

/** Sessions you may see: your own, and everyone's shared ones. */
export async function listTerminalSessions(projectId: string, includeClosed = false): Promise<LiveTerminalSession[]> {
  const res = await apiClient.get<{ sessions: LiveTerminalSession[] }>(`${base(projectId)}/terminals`, {
    params: includeClosed ? { includeClosed: 'true' } : undefined,
  });
  return res.sessions;
}

/** Owner only. Making a session PRIVATE revokes every other viewer at once. */
export async function setTerminalVisibility(
  projectId: string,
  terminalId: string,
  visibility: TerminalVisibility,
): Promise<void> {
  await apiClient.patch(`${base(projectId)}/terminals/${encodeURIComponent(terminalId)}`, { visibility });
}

/** Owner only. Detaches the session from the workspace; the local terminal keeps running. */
export async function disconnectTerminal(projectId: string, terminalId: string): Promise<void> {
  await apiClient.delete(`${base(projectId)}/terminals/${encodeURIComponent(terminalId)}`);
}

/** The structured context an agent receives, as you are allowed to see it. */
export async function getAgentContext(
  projectId: string,
  agentId: string,
  focus: { filePaths?: string[]; taskId?: string } = {},
): Promise<WorkspaceContext> {
  const params: Record<string, string> = {};
  if (focus.filePaths?.length) params.filePaths = focus.filePaths.join(',');
  if (focus.taskId) params.taskId = focus.taskId;
  const res = await apiClient.get<{ context: WorkspaceContext }>(
    `${base(projectId)}/agents/${encodeURIComponent(agentId)}/context`,
    { params },
  );
  return res.context;
}

export const liveTerminalAdapter = {
  listTerminalSessions,
  setTerminalVisibility,
  disconnectTerminal,
  getAgentContext,
};
