import { useMemo, useRef, useState, type FormEvent } from 'react';
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
import { getAppMode } from '../../config/env';
import { currentProjectId } from '../../utils/currentProjectId';
import { useAgents } from '../../hooks/useAgents';
import { useTasks } from '../../hooks/useTasks';
import { useExecutions } from '../../hooks/useExecutions';
import { useWorkspaceRealtime, type RealtimeDeltaEvent } from '../../hooks/useWorkspaceRealtime';
import type { LiveAgentStatus } from '../../adapters/live/agent.adapter';
import {
  taskErrorMessage,
  isFileConflict,
  type LiveTask,
  type LiveTaskStatus,
  type LiveTaskPriority,
  type AssignmentFailureReason,
} from '../../adapters/live/task.adapter';
import {
  executionErrorMessage,
  type LiveExecutionStatus,
} from '../../adapters/live/execution.adapter';

interface WorkspaceViewProps {
  onOpenCanvas(): void;
}

const AGENT_STATUS_META: Record<LiveAgentStatus, { label: string; className: string }> = {
  ONLINE: { label: 'online', className: 'is-online' },
  BUSY: { label: 'busy', className: 'is-busy' },
  OFFLINE: { label: 'offline', className: 'is-offline' },
};

const labelForStatus: Record<ProductTaskStatus, string> = {
  proposed: 'Open',
  claimed: 'Claimed',
  'auto-assigned': 'Auto assigned',
};

const LIVE_TASK_STATUS_META: Record<LiveTaskStatus, { label: string; className: string }> = {
  TODO: { label: 'To do', className: 'is-todo' },
  IN_PROGRESS: { label: 'In progress', className: 'is-progress' },
  PENDING_APPROVAL: { label: 'Pending approval', className: 'is-pending' },
  BLOCKED: { label: 'Blocked', className: 'is-blocked' },
  COMPLETED: { label: 'Completed', className: 'is-complete' },
  FAILED: { label: 'Failed', className: 'is-failed' },
  CANCELLED: { label: 'Cancelled', className: 'is-cancelled' },
};

const LIVE_TASK_PRIORITIES: LiveTaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Human sentences for the coordinator's decline reasons (returned with HTTP 200). */
const ASSIGN_FAILURE_LABEL: Record<AssignmentFailureReason, string> = {
  NO_ELIGIBLE_AGENT: 'No agent is online and free to take this task right now.',
  PREFERRED_AGENT_UNAVAILABLE: 'The preferred agent is offline or already busy.',
  PREFERRED_AGENT_UNAUTHORIZED: 'The preferred agent is not part of this project.',
  TASK_ALREADY_ASSIGNED: 'This task is already assigned to an agent.',
  TASK_CANCELLED_OR_COMPLETED: 'This task is cancelled or completed, so it cannot be assigned.',
  DEPENDENCIES_NOT_SATISFIED: 'Blocked: this task is waiting on dependencies that are not ready yet.',
};

const EXECUTION_STATUS_META: Record<LiveExecutionStatus, { label: string; className: string }> = {
  QUEUED: { label: 'Queued', className: 'is-todo' },
  RUNNING: { label: 'Running', className: 'is-progress' },
  COMPLETED: { label: 'Completed', className: 'is-complete' },
  FAILED: { label: 'Failed', className: 'is-failed' },
  CANCELLED: { label: 'Cancelled', className: 'is-cancelled' },
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

export function AgentsView(props: WorkspaceViewProps) {
  // Live Mode shows the project's real registered agents; Demo Mode is unchanged.
  return getAppMode() === 'live' ? <LiveAgentsView {...props} /> : <DemoAgentsView {...props} />;
}

function LiveAgentsView({ onOpenCanvas }: WorkspaceViewProps) {
  const projectId = currentProjectId();
  const { agents: liveAgents, loading, error, refetch, createAgent } = useAgents(projectId);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  // No agent-row delta is ever actually broadcast server-side today (confirmed
  // by reading every emission site), only presence for a connected/disconnected
  // agent. Refetch on either, so a teammate connecting or disconnecting an
  // agent shows up here without a manual refresh.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useWorkspaceRealtime(
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
        // A resync's fallback snapshot cannot carry an agent list update on
        // its own (it only ever reports live connection state, not the row
        // itself), so refetch the real list every time one lands.
        onResync: () => void refetchRef.current(),
      }),
      [],
    ),
  );

  const register = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const data = new FormData(e.currentTarget);
      const name = String(data.get('name') ?? '').trim();
      const provider = String(data.get('provider') ?? '').trim();
      const ensRaw = String(data.get('ens') ?? '').trim();
      await createAgent({ name, provider, ...(ensRaw ? { ensName: ensRaw } : {}) });
      setFormOpen(false);
      e.currentTarget.reset();
    } catch (reason) {
      // Real server message, never an invented one.
      setFormError(reason instanceof Error ? reason.message : 'Unable to register agent.');
    } finally {
      setBusy(false);
    }
  };

  const ownerCount = new Set(liveAgents.map((a) => a.ownerId)).size;
  const onlineCount = liveAgents.filter((a) => a.status !== 'OFFLINE').length;

  return (
    <section className="workspace-view">
      <ViewHeader eyebrow="WORKSPACE / AGENTS" title="Connected agents" description="Inspect ownership, identity and the capabilities used for task assignment." onOpenCanvas={onOpenCanvas} />
      <div className="workspace-metric-row">
        <article><Bot /><div><strong>{liveAgents.length}</strong><span>agents registered</span></div></article>
        <article><Users /><div><strong>{ownerCount}</strong><span>human owners</span></div></article>
        <article><Radio /><div><strong>{onlineCount}</strong><span>online now</span></div></article>
      </div>

      {projectId && (
        <div className="workspace-list-tools" style={{ gridTemplateColumns: '1fr auto' }}>
          <div />
          <button type="button" className="workspace-list-tools__primary" onClick={() => { setFormOpen(!formOpen); setFormError(''); }}>
            {formOpen ? 'Cancel' : 'Register agent'}
          </button>
        </div>
      )}
      {formOpen && (
        <form className="workspace-inline-form" onSubmit={register} style={{ marginBottom: 16 }}>
          <label>Name<input name="name" required placeholder="Orion" /></label>
          <label>Provider<input name="provider" required placeholder="Codex" /></label>
          <label>ENS name <span style={{ opacity: 0.6 }}>(optional)</span><input name="ens" placeholder="orion.eth" /></label>
          <button type="submit" className="workspace-list-tools__primary" disabled={busy}>{busy ? 'Registering…' : 'Register'}</button>
          {formError && <p role="alert">{formError}</p>}
        </form>
      )}

      {!projectId ? (
        <p className="workspace-view__note"><Sparkles /> Open a project to see its registered agents.</p>
      ) : loading ? (
        <p role="status" className="workspace-view__note">Loading agents…</p>
      ) : error ? (
        <div role="alert" className="workspace-view__note"><span>{error}</span> <button type="button" onClick={() => void refetch()}>Retry</button></div>
      ) : liveAgents.length === 0 ? (
        <p className="workspace-view__note"><Sparkles /> No agents registered in this project yet.</p>
      ) : (
        <div className="agent-directory">
          {liveAgents.map((agent, index) => {
            const meta = AGENT_STATUS_META[agent.status];
            return (
              <article key={agent.id} className={`agent-directory__card agent-directory__card--${index % 2 ? 'teal' : 'purple'}`}>
                <header>
                  <div className="agent-directory__mark"><TerminalSquare /></div>
                  <div><span>{agent.ensName ?? 'no ENS'}</span><h2>{agent.name} <small>{agent.provider}</small></h2></div>
                  <b className={`agent-status ${meta.className}`}><i /> {meta.label}</b>
                </header>
                <dl>
                  <div><dt>Owner</dt><dd>{agent.ownerId.slice(0, 10)}…</dd></div>
                  <div><dt>Agent identity</dt><dd>{agent.ensName ? `${agent.ensName}${agent.ensVerifiedAt ? ' ✓' : ''}` : 'Not linked'}</dd></div>
                  <div><dt>Status</dt><dd>{agent.status}</dd></div>
                  <div><dt>Registered</dt><dd>{new Date(agent.createdAt).toLocaleDateString()}</dd></div>
                </dl>
                <div className="agent-directory__capabilities">
                  {(agent.capabilities ?? []).length === 0
                    ? <span style={{ opacity: 0.6 }}>no declared capabilities</span>
                    : agent.capabilities!.map((cap) => <span key={cap.id}>{cap.capability}</span>)}
                </div>
                <footer><span><ShieldCheck /> Owned by {agent.ownerId.slice(0, 10)}…</span></footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DemoAgentsView({ onOpenCanvas }: WorkspaceViewProps) {
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

export function TasksView(props: WorkspaceViewProps) {
  // Live Mode shows the project's real shared task board; Demo Mode is unchanged.
  return getAppMode() === 'live' ? <LiveTasksView {...props} /> : <DemoTasksView {...props} />;
}

function LiveTaskCard({
  projectId,
  task,
  agentOptions,
  taskOptions,
  onClaim,
  onAutoAssign,
  onAddDependency,
  onMarkComplete,
}: {
  projectId: string;
  task: LiveTask;
  agentOptions: Array<{ id: string; name: string; status: LiveAgentStatus }>;
  taskOptions: Array<{ id: string; title: string }>;
  onClaim: (taskId: string, agentId: string) => Promise<void>;
  onAutoAssign: (taskId: string) => Promise<void>;
  onAddDependency: (taskId: string, dependsOnTaskId: string) => Promise<void>;
  onMarkComplete: (taskId: string) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState('');
  const [dependsOnId, setDependsOnId] = useState('');
  const [busy, setBusy] = useState<'claim' | 'auto' | 'dep' | 'complete' | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info' | 'ok'; text: string } | null>(null);

  const responsibilities = task.responsibilities ?? [];
  const dependencies = task.dependencies ?? [];
  const assigned = responsibilities[0];
  const blockingDeps = dependencies.filter((dep) => !dep.available);
  const meta = LIVE_TASK_STATUS_META[task.status];
  const terminal = task.status === 'COMPLETED' || task.status === 'CANCELLED' || task.status === 'FAILED';

  const claim = async () => {
    if (!agentId) {
      setMessage({ kind: 'error', text: 'Pick an agent to assign.' });
      return;
    }
    setBusy('claim');
    setMessage(null);
    try {
      await onClaim(task.id, agentId);
      setMessage({ kind: 'ok', text: 'Agent assigned.' });
    } catch (err) {
      // Real server error, surfaced verbatim. File conflicts get their own note.
      setMessage({
        kind: 'error',
        text: isFileConflict(err)
          ? `File conflict: ${taskErrorMessage(err)}`
          : taskErrorMessage(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const autoAssign = async () => {
    setBusy('auto');
    setMessage(null);
    try {
      await onAutoAssign(task.id);
    } catch (err) {
      setMessage({ kind: 'error', text: taskErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const addDependency = async () => {
    if (!dependsOnId) {
      setMessage({ kind: 'error', text: 'Pick a task for this one to depend on.' });
      return;
    }
    setBusy('dep');
    setMessage(null);
    try {
      await onAddDependency(task.id, dependsOnId);
      setMessage({ kind: 'ok', text: 'Dependency added.' });
      setDependsOnId('');
    } catch (err) {
      setMessage({ kind: 'error', text: taskErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const markComplete = async () => {
    setBusy('complete');
    setMessage(null);
    try {
      await onMarkComplete(task.id);
      setMessage({ kind: 'ok', text: 'Task marked complete.' });
    } catch (err) {
      setMessage({ kind: 'error', text: taskErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="live-task-card">
      <header className="live-task-card__head">
        <div>
          <code>{task.id.slice(0, 10)}…</code>
          <h2>{task.title}</h2>
        </div>
        <b className={`task-table__status ${meta.className}`}>{meta.label}</b>
      </header>
      <p className="live-task-card__desc">{task.description}</p>

      <dl className="live-task-card__meta">
        <div><dt>Priority</dt><dd>{task.priority}</dd></div>
        <div><dt>Assigned</dt><dd>{assigned ? (assigned.agent?.name ?? assigned.agentId.slice(0, 10) + '…') : 'Unassigned'}</dd></div>
        {assigned?.assignmentSource && (
          <div><dt>Assigned via</dt><dd>{assigned.assignmentSource === 'HUMAN_PREFERENCE' ? 'Human preference' : 'Capability match'}</dd></div>
        )}
        {task.requiredCapabilities.length > 0 && (
          <div><dt>Needs</dt><dd>{task.requiredCapabilities.join(', ')}</dd></div>
        )}
        {task.filePaths.length > 0 && (
          <div><dt>Files</dt><dd>{task.filePaths.join(', ')}</dd></div>
        )}
      </dl>

      {dependencies.length > 0 && (
        <div className={`live-task-card__deps ${blockingDeps.length ? 'is-blocked' : 'is-ready'}`}>
          {blockingDeps.length > 0 ? (
            <span><Clock3 size={13} /> Waiting on {blockingDeps.length} of {dependencies.length} dependencies</span>
          ) : (
            <span><CheckCircle2 size={13} /> All {dependencies.length} dependencies satisfied</span>
          )}
        </div>
      )}

      {!assigned && !terminal && (
        <div className="live-task-card__actions">
          <label className="live-task-card__picker">
            <span className="sr-only">Assign agent</span>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Assign an agent…</option>
              {agentOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.status.toLowerCase()})</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={claim} disabled={busy !== null}>
            {busy === 'claim' ? 'Assigning…' : 'Assign'}
          </button>
          <button type="button" className="is-secondary" onClick={autoAssign} disabled={busy !== null}>
            {busy === 'auto' ? 'Coordinating…' : 'Auto assign'}
          </button>
        </div>
      )}

      {assigned && !terminal && (
        <div className="live-task-card__actions">
          <button type="button" onClick={markComplete} disabled={busy !== null}>
            {busy === 'complete' ? 'Completing…' : 'Mark complete'}
          </button>
        </div>
      )}

      {!terminal && taskOptions.length > 0 && (
        <div className="live-task-card__actions live-task-card__actions--dep">
          <label className="live-task-card__picker">
            <span className="sr-only">Depends on</span>
            <select value={dependsOnId} onChange={(e) => setDependsOnId(e.target.value)}>
              <option value="">Depends on…</option>
              {taskOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </label>
          <button type="button" className="is-secondary" onClick={addDependency} disabled={busy !== null}>
            {busy === 'dep' ? 'Adding…' : 'Add dependency'}
          </button>
        </div>
      )}

      {message && (
        <p className={`live-task-card__msg live-task-card__msg--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {assigned && <ExecutionPanel projectId={projectId} taskId={task.id} agentId={assigned.agentId} />}
    </article>
  );
}

/**
 * Real execution history and controls for one task, scoped to the agent
 * currently responsible for it. A distinct action from assignment (PRD-44):
 * the server only accepts a new execution for an agent that already holds a
 * responsibility here, never created automatically by assignment itself.
 *
 * "Start execution" is disabled while this task already has a non-terminal
 * execution as a client-side courtesy against accidental duplicates, not
 * because the server forbids a second one; the server has no such rule.
 */
function ExecutionPanel({ projectId, taskId, agentId }: { projectId: string; taskId: string; agentId: string }) {
  const { executions, loading, error, refetch, createExecution, cancelExecution } = useExecutions(projectId, taskId);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'error' | 'info' | 'ok'; text: string } | null>(null);

  const activeExecution = executions.find((e) => e.status === 'QUEUED' || e.status === 'RUNNING');

  const start = async () => {
    setBusy('start');
    setNote(null);
    try {
      const result = await createExecution({ agentId });
      setNote(
        result.kind === 'approval_required'
          ? { kind: 'info', text: `Pending human approval (request ${result.approvalRequestId.slice(0, 10)}…). ${result.message}` }
          : { kind: 'ok', text: 'Execution started.' },
      );
    } catch (err) {
      setNote({ kind: 'error', text: executionErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (executionId: string) => {
    setBusy(executionId);
    setNote(null);
    try {
      await cancelExecution(executionId);
      setNote({ kind: 'ok', text: 'Execution cancelled.' });
    } catch (err) {
      setNote({ kind: 'error', text: executionErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="live-task-card__executions">
      <div className="live-task-card__executions-head">
        <span>Executions</span>
        <button type="button" className="is-secondary" onClick={() => void start()} disabled={busy !== null || Boolean(activeExecution)}>
          {busy === 'start' ? 'Starting…' : 'Start execution'}
        </button>
      </div>

      {loading ? (
        <p className="live-task-card__msg" role="status">Loading executions…</p>
      ) : error ? (
        <div className="live-task-card__msg live-task-card__msg--error" role="alert">
          <span>{error}</span> <button type="button" onClick={() => void refetch()}>Retry</button>
        </div>
      ) : executions.length === 0 ? (
        <p className="live-task-card__executions-empty">No executions yet.</p>
      ) : (
        <ul className="live-task-card__execution-list">
          {executions.map((exec) => {
            const emeta = EXECUTION_STATUS_META[exec.status];
            const cancellable = exec.status === 'QUEUED' || exec.status === 'RUNNING';
            return (
              <li key={exec.id}>
                <b className={`task-table__status ${emeta.className}`}>{emeta.label}</b>
                <code>{exec.id.slice(0, 10)}…</code>
                {exec.error && <span className="live-task-card__execution-error">{exec.error}</span>}
                {cancellable && (
                  <button type="button" className="is-secondary" onClick={() => void cancel(exec.id)} disabled={busy !== null}>
                    {busy === exec.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {note && (
        <p className={`live-task-card__msg live-task-card__msg--${note.kind}`} role={note.kind === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
    </div>
  );
}

function LiveTasksView({ onOpenCanvas }: WorkspaceViewProps) {
  const projectId = currentProjectId();
  const { tasks, loading, error, refetch, createTask, claimTask, autoAssign, addDependency, updateStatus } = useTasks(projectId);
  const { agents: liveAgents } = useAgents(projectId);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // task and taskResponsibility (manual claim) are the two entities a real
  // change to this board actually broadcasts as; dependency and artifact
  // changes also affect a task's own displayed state (blocked/ready,
  // pending-approval), so they refetch the board too. Coordinator auto
  // assign broadcasts no taskResponsibility delta at all today (it only
  // emits a raw, unsequenced task.assigned message plus an indirect activity
  // delta), so an auto assignment made in another tab will not appear here
  // live; that gap is server-side, out of scope for this PRD.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useWorkspaceRealtime(
    projectId,
    useMemo(
      () => ({
        onDelta: (event: RealtimeDeltaEvent) => {
          if (
            event.entity === 'task' ||
            event.entity === 'taskResponsibility' ||
            event.entity === 'dependency' ||
            event.entity === 'artifact'
          ) {
            void refetchRef.current();
          }
        },
        // The fallback snapshot after a gap the buffer couldn't replay is
        // capped at 20 tasks (confirmed against the server), so on a big
        // enough gap it cannot carry the whole board back on its own.
        // Refetch the real list every time a snapshot lands to be sure.
        onResync: () => void refetchRef.current(),
      }),
      [],
    ),
  );

  const agentOptions = liveAgents.map((a) => ({ id: a.id, name: a.name, status: a.status }));

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const data = new FormData(e.currentTarget);
      const title = String(data.get('title') ?? '').trim();
      const description = String(data.get('description') ?? '').trim();
      const priority = String(data.get('priority') ?? 'MEDIUM') as LiveTaskPriority;
      const capsRaw = String(data.get('caps') ?? '').trim();
      const filesRaw = String(data.get('files') ?? '').trim();
      const requiredCapabilities = capsRaw ? capsRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const filePaths = filesRaw ? filesRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      await createTask({ title, description, priority, requiredCapabilities, filePaths });
      setFormOpen(false);
      e.currentTarget.reset();
    } catch (err) {
      // Real server validation message, never an invented one.
      setFormError(taskErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const runClaim = async (taskId: string, agentId: string) => {
    await claimTask(taskId, agentId);
  };

  const runAutoAssign = async (taskId: string) => {
    setNotice(null);
    const result = await autoAssign(taskId);
    if (result.assigned) {
      const via = result.source === 'HUMAN_PREFERENCE' ? 'human preference' : 'capability match';
      setNotice(`Coordinator assigned the task via ${via}${result.score !== undefined ? ` (score ${result.score}%)` : ''}.`);
    } else {
      // A declined assignment is a real 200 result, surfaced as its reason.
      setNotice(ASSIGN_FAILURE_LABEL[result.reason]);
    }
  };

  const runAddDependency = async (taskId: string, dependsOnTaskId: string) => {
    await addDependency(taskId, { dependsOnTaskId });
  };

  const runMarkComplete = async (taskId: string) => {
    await updateStatus(taskId, 'COMPLETED');
  };

  const openCount = tasks.filter((t) => (t.responsibilities ?? []).length === 0 && t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length;
  const assignedCount = tasks.filter((t) => (t.responsibilities ?? []).length > 0).length;

  return (
    <section className="workspace-view">
      <ViewHeader eyebrow="COORDINATOR / RESPONSIBILITY" title="Shared task board" description="Assign a preferred agent yourself, or let the coordinator match by capability." onOpenCanvas={onOpenCanvas} />
      <div className="workspace-metric-row">
        <article><FileJson2 /><div><strong>{tasks.length}</strong><span>tasks on the board</span></div></article>
        <article><Clock3 /><div><strong>{openCount}</strong><span>awaiting an agent</span></div></article>
        <article><CheckCircle2 /><div><strong>{assignedCount}</strong><span>assigned</span></div></article>
      </div>

      {projectId && (
        <div className="workspace-list-tools" style={{ gridTemplateColumns: '1fr auto' }}>
          <div />
          <button type="button" className="workspace-list-tools__primary" onClick={() => { setFormOpen(!formOpen); setFormError(''); }}>
            {formOpen ? 'Cancel' : 'New task'}
          </button>
        </div>
      )}
      {formOpen && (
        <form className="workspace-inline-form" onSubmit={create} style={{ marginBottom: 16 }}>
          <label>Title<input name="title" required placeholder="Wire up the payment API" /></label>
          <label>Description<input name="description" required placeholder="What needs doing and why" /></label>
          <label>Priority
            <select name="priority" defaultValue="MEDIUM">
              {LIVE_TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>Required capabilities <span style={{ opacity: 0.6 }}>(comma separated)</span><input name="caps" placeholder="language:solidity, domain:backend" /></label>
          <label>File paths <span style={{ opacity: 0.6 }}>(comma separated)</span><input name="files" placeholder="src/payment.ts" /></label>
          <button type="submit" className="workspace-list-tools__primary" disabled={busy}>{busy ? 'Creating…' : 'Create task'}</button>
          {formError && <p role="alert">{formError}</p>}
        </form>
      )}

      {notice && (
        <p className="workspace-view__note" role="status" style={{ marginBottom: 12 }}>{notice} <button type="button" onClick={() => setNotice(null)}>Dismiss</button></p>
      )}

      {!projectId ? (
        <p className="workspace-view__note"><Sparkles /> Open a project to see its shared task board.</p>
      ) : loading ? (
        <p role="status" className="workspace-view__note">Loading tasks…</p>
      ) : error ? (
        <div role="alert" className="workspace-view__note"><span>{error}</span> <button type="button" onClick={() => void refetch()}>Retry</button></div>
      ) : tasks.length === 0 ? (
        <p className="workspace-view__note"><Sparkles /> No tasks on this board yet. Create the first one.</p>
      ) : (
        <div className="live-task-board">
          {tasks.map((task) => (
            <LiveTaskCard
              key={task.id}
              projectId={projectId}
              task={task}
              agentOptions={agentOptions}
              taskOptions={tasks.filter((t) => t.id !== task.id).map((t) => ({ id: t.id, title: t.title }))}
              onClaim={runClaim}
              onAutoAssign={runAutoAssign}
              onAddDependency={runAddDependency}
              onMarkComplete={runMarkComplete}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DemoTasksView({ onOpenCanvas }: WorkspaceViewProps) {
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
