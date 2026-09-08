import { User } from 'lucide-react';
import { StatusBadge, Pill } from '@agentmesh/ui';
import { AgentCard } from './AgentCard';
import { currentProject, placeholderAgents } from '../../data/workspace';
import { useMultiplayerPresence } from '../../hooks/useMultiplayerPresence';

/** The connectable-agent roster and connected workspace members shown on Overview. */
export function AgentRoster() {
  const presence = useMultiplayerPresence(currentProject.id);

  return (
    <section className="agent-roster" aria-label="Agents">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-heading">Agents</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Pill tone="neutral">Task Coordinator: Active</Pill>
          <Pill tone={presence.connected ? 'success' : 'neutral'} dot>
            {presence.connected ? 'Multiplayer Live' : presence.isReconnecting ? 'Reconnecting...' : 'Offline'}
          </Pill>
        </div>
      </div>

      {presence.members.length > 0 && (
        <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #888)' }}>Workspace Members:</span>
          {presence.members.map((member) => (
            <StatusBadge key={member.userId} tone={member.status === 'ONLINE' ? 'success' : 'neutral'}>
              <User size={12} style={{ marginRight: '4px' }} />
              {member.displayName || member.userId.substring(0, 8)} ({member.status})
            </StatusBadge>
          ))}
        </div>
      )}

      <div className="agent-roster__grid">
        {placeholderAgents.map((agent) => {
          const liveAgent = presence.agents.find((a) => a.name === agent.name || a.agentId === agent.id);
          const currentStatus = liveAgent ? liveAgent.status : agent.status;
          return <AgentCard key={agent.id} agent={{ ...agent, status: currentStatus }} />;
        })}
      </div>
    </section>
  );
}
