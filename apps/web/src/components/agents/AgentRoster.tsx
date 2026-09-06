import { AgentCard } from './AgentCard';
import { placeholderAgents } from '../../data/workspace';

/** The connectable-agent roster shown on Overview. */
export function AgentRoster() {
  return (
    <section className="agent-roster" aria-label="Agents">
      <h2 className="section-heading">Agents</h2>
      <div className="agent-roster__grid">
        {placeholderAgents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </section>
  );
}
