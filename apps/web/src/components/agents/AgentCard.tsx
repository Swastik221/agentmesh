import { Bot } from 'lucide-react';
import { StatusBadge } from '@agentmesh/ui';
import type { PlaceholderAgent } from '../../types';

export interface AgentCardProps {
  agent: PlaceholderAgent;
}

/**
 * Roster entry for an agent a developer could connect. Visual placeholder —
 * every card is offline because agent registration does not exist yet.
 */
export function AgentCard({ agent }: AgentCardProps) {
  return (
    <article className="agent-card">
      <div className="agent-card__head">
        <Bot size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="agent-card__name">{agent.name}</span>
      </div>
      <div className="agent-card__vendor">{agent.vendor}</div>
      <StatusBadge tone="neutral">Status: {agent.status}</StatusBadge>
    </article>
  );
}
