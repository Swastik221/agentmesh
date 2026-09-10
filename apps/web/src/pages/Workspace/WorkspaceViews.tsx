import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Code2,
  FileJson2,
  Filter,
  FolderGit2,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Users,
} from 'lucide-react';
import { agents, artifact, owners } from '../../features/workspace/workspace.mock';
import type { ProductTaskStatus, ProtocolEventType } from '../../features/workspace/workspace.types';
import { useDemo } from '../../demo/DemoProvider';

interface WorkspaceViewProps {
  onOpenCanvas(): void;
}

const labelForStatus: Record<ProductTaskStatus, string> = {
  proposed: 'Open',
  claimed: 'Claimed',
  'auto-assigned': 'Auto assigned',
};

function ViewHeader({ eyebrow, title, description, onOpenCanvas }: { eyebrow: string; title: string; description: string; onOpenCanvas(): void }) {
  return (
    <header className="workspace-view__header">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <button type="button" onClick={onOpenCanvas}>Open canvas <ArrowRight size={15} /></button>
    </header>
  );
}

export function AgentsView({ onOpenCanvas }: WorkspaceViewProps) {
  const { profile, state } = useDemo();
  return (
    <section className="workspace-view">
      <ViewHeader eyebrow="WORKSPACE / AGENTS" title="Connected agents" description="Inspect ownership, identity and the capabilities used for task assignment." onOpenCanvas={onOpenCanvas} />
      <div className="workspace-metric-row">
        <article><Bot /><div><strong>2</strong><span>agents connected</span></div></article>
        <article><Users /><div><strong>2</strong><span>human owners</span></div></article>
        <article><Radio /><div><strong>Live</strong><span>local collaboration</span></div></article>
      </div>
      <div className="agent-directory">
        {agents.map((agent, index) => {
          const owner = owners[index];
          const assigned = state.workspace.tasks.filter((task) => task.claimedBy === agent.id);
          return (
            <article key={agent.id} className={`agent-directory__card agent-directory__card--${index ? 'teal' : 'purple'}`}>
              <header><div className="agent-directory__mark"><TerminalSquare /></div><div><span>{owner.ens}</span><h2>{agent.name} <small>{agent.provider}</small></h2></div><b><i /> connected</b></header>
              <dl>
                <div><dt>Human owner</dt><dd>{owner.name}</dd></div>
                <div><dt>Agent identity</dt><dd>{agent.ens}</dd></div>
                <div><dt>Repository scope</dt><dd>{index ? 'contracts/**' : 'src/identity/**'}</dd></div>
                <div><dt>Current work</dt><dd>{assigned[0]?.id ?? 'Ready for task'}</dd></div>
              </dl>
              <div className="agent-directory__capabilities">{agent.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div>
              <footer><span><ShieldCheck /> Owned by {owner.ens}</span><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('agentmesh:open-panel', { detail: 'terminal' }))}>Open terminal <Code2 /></button></footer>
            </article>
          );
        })}
      </div>
      <p className="workspace-view__note"><Sparkles /> You are viewing the workspace as {profile.name}. Agent identity and wallet actions are simulated in demo mode.</p>
    </section>
  );
}

export function TasksView({ onOpenCanvas }: WorkspaceViewProps) {
  const { state, claimTask, submitPrd } = useDemo();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | ProductTaskStatus>('all');
  const tasks = state.workspace.tasks.filter((task) => (filter === 'all' || task.status === filter) && `${task.id} ${task.title} ${task.capability}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="workspace-view">
      <ViewHeader eyebrow="COORDINATOR / RESPONSIBILITY" title="Shared task board" description="Choose preferred work or let the coordinator assign it by capability." onOpenCanvas={onOpenCanvas} />
      <div className="workspace-list-tools"><label><Search /><input aria-label="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks or capabilities" /></label><div><Filter />{(['all', 'proposed', 'claimed', 'auto-assigned'] as const).map((item) => <button type="button" className={filter === item ? 'is-active' : ''} onClick={() => setFilter(item)} key={item}>{item === 'all' ? 'All' : labelForStatus[item]}</button>)}</div><button type="button" className="workspace-list-tools__primary" onClick={submitPrd}>Generate from PRD</button></div>
      <div className="task-table" role="table" aria-label="Workspace tasks">
        <div className="task-table__head" role="row"><span>Task</span><span>Capability</span><span>Assignment</span><span>Status</span><span /></div>
        {tasks.map((task) => <article role="row" key={task.id}><div><code>{task.id}</code><strong>{task.title}</strong><small>{task.reason}</small></div><span>{task.capability}</span><span>{task.claimedBy ?? `Suggested: ${task.suggestedAgent}`}</span><b className={`task-table__status task-table__status--${task.status}`}>{task.status === 'proposed' && <Clock3 />}{labelForStatus[task.status]}{task.countdown ? ` · ${task.countdown}s` : ''}</b>{task.status === 'proposed' ? <button type="button" onClick={() => claimTask(task.id)}>Claim task</button> : <CheckCircle2 />}</article>)}
        {!tasks.length && <p className="workspace-empty">No tasks match this view.</p>}
      </div>
    </section>
  );
}

export function FilesView({ onOpenCanvas }: WorkspaceViewProps) {
  const { openBrowser } = useDemo();
  const openArtifact = () => { openBrowser('agentmesh://artifact/payment-api'); window.dispatchEvent(new CustomEvent('agentmesh:open-panel', { detail: 'browser' })); };
  return (
    <section className="workspace-view">
      <ViewHeader eyebrow="ARTIFACTS / SCOPED FILES" title="Workspace files" description="Review published artifacts and the repository scopes shared with each agent." onOpenCanvas={onOpenCanvas} />
      <div className="file-layout">
        <aside className="file-tree"><h2><FolderGit2 /> checkout-protocol</h2><ul><li><span>⌄</span> src</li><li className="is-child">identity</li><li className="is-child">payment.ts</li><li><span>⌄</span> contracts</li><li className="is-child">Checkout.sol</li><li className="is-selected"><FileJson2 /> payment-api.json</li></ul><footer><ShieldCheck /> Secrets and .env stay excluded</footer></aside>
        <article className="artifact-preview"><header><div><FileJson2 /><span><small>VERSIONED ARTIFACT</small><h2>{artifact.name}</h2></span></div><b>Published</b></header><dl><div><dt>Schema</dt><dd>{artifact.schema}</dd></div><div><dt>Content hash</dt><dd>{artifact.hash}</dd></div><div><dt>Published by</dt><dd>{artifact.publishedBy}</dd></div><div><dt>Consumed by</dt><dd>{artifact.usedBy}</dd></div></dl><pre>{`{\n  "version": 1,\n  "endpoints": ["/payment", "/refund"],\n  "review": "approved",\n  "scope": "checkout-protocol"\n}`}</pre><button type="button" onClick={openArtifact}>Inspect artifact <ArrowRight /></button></article>
      </div>
    </section>
  );
}

const eventGroups: Array<{ label: string; types: ProtocolEventType[] }> = [
  { label: 'All events', types: [] },
  { label: 'Tasks', types: ['TASK_PROPOSAL', 'TASK_PREFERENCE', 'TASK_CLAIMED', 'TASK_AUTO_ASSIGNED'] },
  { label: 'Artifacts', types: ['ARTIFACT_PUBLISHED', 'DEPENDENCY_REQUEST'] },
  { label: 'Approvals', types: ['APPROVAL_REQUESTED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED'] },
];

export function ActivityView({ onOpenCanvas }: WorkspaceViewProps) {
  const { state } = useDemo();
  const [group, setGroup] = useState(0);
  const events = useMemo(() => group === 0 ? state.workspace.events : state.workspace.events.filter((event) => eventGroups[group].types.includes(event.type)), [group, state.workspace.events]);
  return (
    <section className="workspace-view">
      <ViewHeader eyebrow="AUDIT / PROTOCOL" title="Live activity" description="Every task, artifact and approval remains attributable to a human or agent identity." onOpenCanvas={onOpenCanvas} />
      <div className="activity-layout"><aside><span>FILTER EVENTS</span>{eventGroups.map((item, index) => <button type="button" className={group === index ? 'is-active' : ''} onClick={() => setGroup(index)} key={item.label}>{item.label}<b>{index === 0 ? state.workspace.events.length : state.workspace.events.filter((event) => item.types.includes(event.type)).length}</b></button>)}</aside><div className="activity-stream">{events.slice().reverse().map((item) => <article key={item.id}><i /><time>{item.time}</time><div><span>{item.type}</span><h2>{item.payload}</h2><p>{item.sender} <ArrowRight /> {item.receiver}</p></div><code>{item.correlationId ?? item.id}</code></article>)}</div></div>
    </section>
  );
}
