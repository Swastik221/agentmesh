import { useMemo, useRef } from 'react';
import { Pill } from '@agentmesh/ui';
import { AgentCard } from './AgentCard';
import { currentProjectId } from '../../utils/currentProjectId';
import { useAgents } from '../../hooks/useAgents';
import { useWorkspaceRealtime, type RealtimeDeltaEvent } from '../../hooks/useWorkspaceRealtime';

/**
 * The connectable-agent roster shown on the workspace Overview.
 *
 * Previously read a hardcoded fixture (`placeholderAgents` from
 * `data/workspace.ts`) merged with `useMultiplayerPresence`, a hook confirmed
 * broken: it opened its own WebSocket connection without `clientType=user`,
 * which the server (`websocket.server.ts`) only treats as an authenticated
 * user client when that param (or `token`) is present. Without it the
 * connection never gets a snapshot or any broadcast, so `presence.agents`
 * stayed permanently empty. `useMultiplayerPresence.ts` has been removed,
 * this reuses `useAgents`, the same real, project-scoped agent list and
 * status (`ONLINE`/`OFFLINE`/`BUSY`, DB and connection-manager backed)
 * already proven live in `LiveAgentsView` (PRD-43/44), plus
 * `useWorkspaceRealtime`'s existing authenticated connection to refetch on
 * a real delta, exactly the same wiring `LiveAgentsView` uses. No new
 * WebSocket connection, no new data-fetching logic.
 */
export function AgentRoster() {
  const projectId = currentProjectId();
  const { agents, loading, error, refetch } = useAgents(projectId);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const { status: realtimeStatus } = useWorkspaceRealtime(
    projectId,
    useMemo(
      () => ({
        onDelta: (event: RealtimeDeltaEvent) => {
          if (event.entity === 'agent') {
            void refetchRef.current();
          } else if (event.entity === 'presence' && event.fields?.entityType === 'agent') {
            void refetchRef.current();
          }
        },
        onResync: () => void refetchRef.current(),
      }),
      [],
    ),
  );

  return (
    <section className="agent-roster" aria-label="Agents">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-heading">Agents</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {error && <Pill tone="warning">{error}</Pill>}
          <Pill tone={realtimeStatus === 'connected' ? 'success' : 'neutral'} dot>
            {realtimeStatus === 'connected'
              ? 'Live'
              : realtimeStatus === 'reconnecting'
                ? 'Reconnecting…'
                : realtimeStatus === 'connecting'
                  ? 'Connecting…'
                  : 'Offline'}
          </Pill>
        </div>
      </div>

      <div className="agent-roster__grid">
        {!projectId ? null : loading && agents.length === 0 ? (
          <p className="agent-roster__empty">Loading agents…</p>
        ) : agents.length === 0 ? (
          <p className="agent-roster__empty">No agents registered yet.</p>
        ) : (
          agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={{ id: agent.id, name: agent.name, vendor: agent.provider, status: agent.status }}
            />
          ))
        )}
      </div>
    </section>
  );
}
