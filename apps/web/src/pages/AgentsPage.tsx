import { useState } from 'react';
import { Bot, Loader2, Plus } from 'lucide-react';
import { StatusBadge } from '@agentmesh/ui';
import type { AgentDTO } from '@agentmesh/shared';
import { api } from '../lib/api';
import { useWorkspace } from '../state/WorkspaceContext';
import { useWorkspaceSocket } from '../hooks/useWorkspaceSocket';
import { StateNote } from '../components/status/StateNote';

function agentStatusTone(status: AgentDTO['status']): 'success' | 'neutral' | 'warning' {
  if (status === 'ONLINE') return 'success';
  if (status === 'BUSY') return 'warning';
  return 'neutral';
}

export interface AgentsPageProps {
  live: ReturnType<typeof useWorkspaceSocket>['live'];
  refresh: () => Promise<void>;
}

/**
 * Real agent registry: agents come from the backend (agent.service), while
 * ONLINE/OFFLINE/BUSY presence is driven by the live WebSocket stream.
 */
export function AgentsPage({ live, refresh }: AgentsPageProps) {
  const { user, activeProjectId } = useWorkspace();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('cli');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const onCreate = async () => {
    if (!activeProjectId || !user || !name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.createAgent(activeProjectId, {
        ownerId: user.id,
        name: name.trim(),
        provider: provider.trim() || 'cli',
      });
      setName('');
      await refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">Agents</h1>
        <p className="page__subtitle">
          Registered agents in this workspace. Status is live from the WebSocket presence stream.
        </p>
      </div>

      <section className="panel">
        <div className="panel__title">Register agent</div>
        <div className="panel__row">
          <input
            className="field"
            placeholder="Agent name, e.g. codex-dev"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onCreate();
            }}
          />
          <select className="field field--select" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="cli">agentmesh CLI</option>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
            <option value="gemini">Gemini</option>
            <option value="custom">Custom</option>
          </select>
          <button className="btn btn--primary" onClick={() => void onCreate()} disabled={creating || !name.trim()}>
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Register
          </button>
        </div>
        {createError && <StateNote tone="error" text={createError} />}
        <p className="panel__hint">
          Connect the matching agent over the CLI (<code>pnpm --filter @agentmesh/cli dev</code>)
          to bring it ONLINE and let it claim tasks.
        </p>
      </section>

      <section className="panel">
        <div className="panel__title">Agent registry</div>
        {live.agents.length === 0 ? (
          <StateNote tone="empty" text="No agents registered yet in this workspace." />
        ) : (
          <ul className="agents-grid">
            {live.agents.map((agent) => (
              <li key={agent.agentId} className="agent-tile">
                <div className="agent-tile__head">
                  <Bot size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className="agent-tile__name">{agent.name}</span>
                </div>
                <div className="agent-tile__meta mono">{agent.provider}</div>
                <StatusBadge tone={agentStatusTone(agent.status)}>
                  {agent.status === 'ONLINE'
                    ? 'Connected'
                    : agent.status === 'BUSY'
                      ? 'Working'
                      : 'Offline'}
                </StatusBadge>
                <div className="agent-tile__id mono">{agent.agentId.slice(0, 12)}…</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}