import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  FileJson2,
  FolderGit2,
  Radio,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  UserPlus,
  Users,
} from 'lucide-react';
import { currentProjectId } from '../../utils/currentProjectId';
import { useAgents } from '../../hooks/useAgents';
import { useTasks } from '../../hooks/useTasks';
import { useExecutions } from '../../hooks/useExecutions';
import { useApprovals } from '../../hooks/useApprovals';
import { useArtifacts } from '../../hooks/useArtifacts';
import { useProjectMembers, useProjectInvitations, type ProjectRole } from '../../hooks/useInvitations';
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
import {
  approvalErrorMessage,
  type ApprovalRequestRecord,
} from '../../adapters/live/approval.adapter';
import {
  artifactErrorMessage,
  type LiveArtifactDetail,
} from '../../adapters/live/artifact.adapter';



interface WorkspaceViewProps {
  onOpenCanvas(): void;
}

const AGENT_STATUS_META: Record<LiveAgentStatus, { label: string; className: string }> = {
  ONLINE: { label: 'online', className: 'is-online' },
  BUSY: { label: 'busy', className: 'is-busy' },
  OFFLINE: { label: 'offline', className: 'is-offline' },
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
  return <LiveAgentsView {...props} />;
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



export function TasksView(props: WorkspaceViewProps) {
  return <LiveTasksView {...props} />;
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
  approvals,
  onApprove,
  onReject,
  onRefetchApprovals,
}: {
  projectId: string;
  task: LiveTask;
  agentOptions: Array<{ id: string; name: string; status: LiveAgentStatus }>;
  taskOptions: Array<{ id: string; title: string }>;
  onClaim: (taskId: string, agentId: string) => Promise<void>;
  onAutoAssign: (taskId: string) => Promise<void>;
  onAddDependency: (taskId: string, dependsOnTaskId: string) => Promise<void>;
  onMarkComplete: (taskId: string) => Promise<void>;
  approvals: ApprovalRequestRecord[];
  onApprove: (approvalId: string) => Promise<ApprovalRequestRecord>;
  onReject: (approvalId: string) => Promise<ApprovalRequestRecord>;
  onRefetchApprovals: () => Promise<void>;
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

      {assigned && (
        <ExecutionPanel
          projectId={projectId}
          taskId={task.id}
          agentId={assigned.agentId}
          approvals={approvals}
          onApprove={onApprove}
          onReject={onReject}
          onRefetchApprovals={onRefetchApprovals}
        />
      )}
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
 *
 * PRD-45 left the 202 path as a one-shot local toast with no persisted
 * state at all: reload the page, or open the task in a second tab, and
 * there was zero indication a request was pending. PRD-47 closes that gap
 * here, in this exact panel, rather than a separate approvals screen: a
 * pending approval for this task (correlated via the metadata task.execute
 * stores at creation, `taskId`/`agentId`, the only linkage the API exposes
 * since an ApprovalRequest has no taskId column of its own) is now real,
 * fetched state from `useApprovals`, so it survives a reload and shows up
 * in a second tab on its next poll. Approving resolves the request AND
 * resumes the blocked action server side (confirmed directly against
 * approval.service.ts's resumeBlockedAction): a real TaskExecution row
 * already exists by the time the approve call returns, using the original
 * requester's identity, not the approver's. No retry of the original
 * create call is needed here, only a refetch of this task's executions.
 */
function ExecutionPanel({
  projectId,
  taskId,
  agentId,
  approvals,
  onApprove,
  onReject,
  onRefetchApprovals,
}: {
  projectId: string;
  taskId: string;
  agentId: string;
  approvals: ApprovalRequestRecord[];
  onApprove: (approvalId: string) => Promise<ApprovalRequestRecord>;
  onReject: (approvalId: string) => Promise<ApprovalRequestRecord>;
  onRefetchApprovals: () => Promise<void>;
}) {
  const { executions, loading, error, refetch, createExecution, cancelExecution } = useExecutions(projectId, taskId);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'error' | 'info' | 'ok'; text: string } | null>(null);

  const activeExecution = executions.find((e) => e.status === 'QUEUED' || e.status === 'RUNNING');

  const pendingApproval = approvals.find(
    (a) =>
      a.action === 'task.execute' &&
      a.status === 'PENDING' &&
      (a.metadata as { taskId?: string } | null)?.taskId === taskId,
  );

  const start = async () => {
    setBusy('start');
    setNote(null);
    try {
      const result = await createExecution({ agentId });
      if (result.kind === 'approval_required') {
        setNote({ kind: 'info', text: 'Pending human approval.' });
        // The board-level approvals list has no way to know about this new
        // request until its own next poll; refetch it now so the persisted
        // pending state (with real Approve/Reject buttons) below appears
        // immediately, not up to a few seconds later.
        await onRefetchApprovals();
      } else {
        setNote({ kind: 'ok', text: 'Execution started.' });
      }
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

  const approve = async () => {
    if (!pendingApproval) return;
    setBusy('approve');
    setNote(null);
    try {
      await onApprove(pendingApproval.id);
      setNote({ kind: 'ok', text: 'Approved. Execution started.' });
      // The execution resumeBlockedAction created server side already
      // exists by the time approve resolves; refetch to reveal it now
      // rather than waiting for the next poll tick.
      await refetch();
    } catch (err) {
      setNote({ kind: 'error', text: approvalErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!pendingApproval) return;
    setBusy('reject');
    setNote(null);
    try {
      await onReject(pendingApproval.id);
      setNote({ kind: 'ok', text: 'Rejected. No execution was started.' });
    } catch (err) {
      setNote({ kind: 'error', text: approvalErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="live-task-card__executions">
      <div className="live-task-card__executions-head">
        <span>Executions</span>
        <button
          type="button"
          className="is-secondary"
          onClick={() => void start()}
          disabled={busy !== null || Boolean(activeExecution) || Boolean(pendingApproval)}
        >
          {busy === 'start' ? 'Starting…' : 'Start execution'}
        </button>
      </div>

      {pendingApproval && (
        <div className="live-task-card__msg live-task-card__msg--info" role="status">
          <p>
            Pending human approval, requested by{' '}
            {pendingApproval.requestedByUser?.displayName ||
              (pendingApproval.requestedByUser?.walletAddress
                ? pendingApproval.requestedByUser.walletAddress.slice(0, 10) + '…'
                : pendingApproval.requestedByUserId.slice(0, 10) + '…')}
            .{pendingApproval.reason ? ` ${pendingApproval.reason}` : ''}
          </p>
          <div>
            <button type="button" className="is-secondary" onClick={() => void approve()} disabled={busy !== null}>
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" className="is-secondary" onClick={() => void reject()} disabled={busy !== null}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </div>
      )}

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
  // Lifted here rather than fetched once per ExecutionPanel: approvals are
  // project scoped, not task scoped (an ApprovalRequest has no taskId
  // column of its own), so one fetch/poll per board serves every task card
  // instead of one redundant poll per assigned task.
  const { approvals, approve: approveRequest, reject: rejectRequest, refetch: refetchApprovals } = useApprovals(projectId);
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
              approvals={approvals}
              onApprove={approveRequest}
              onReject={rejectRequest}
              onRefetchApprovals={refetchApprovals}
            />
          ))}
        </div>
      )}
    </section>
  );
}



function LiveFilesView({ onOpenCanvas }: WorkspaceViewProps) {
  const projectId = currentProjectId();
  const { tasks, loading: tasksLoading, error: tasksError } = useTasks(projectId);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');

  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [tasks, selectedTaskId]);

  const {
    artifacts,
    loading: artifactsLoading,
    error: artifactsError,
    refetch,
    getArtifactDetail,
    reviewArtifact,
  } = useArtifacts(projectId, selectedTaskId);

  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [artifactDetail, setArtifactDetail] = useState<LiveArtifactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');

  // Auto-select first artifact when list changes
  useEffect(() => {
    if (artifacts.length > 0 && (!selectedArtifactId || !artifacts.some((a) => a.id === selectedArtifactId))) {
      setSelectedArtifactId(artifacts[0].id);
    } else if (artifacts.length === 0) {
      setSelectedArtifactId(null);
    }
  }, [artifacts, selectedArtifactId]);

  useEffect(() => {
    const targetArtifactId = selectedArtifactId;
    if (!targetArtifactId) {
      setArtifactDetail(null);
      return;
    }
    let canceled = false;
    setDetailLoading(true);
    setDetailError(null);
    getArtifactDetail(targetArtifactId)
      .then((detail) => {
        if (!canceled) {
          setArtifactDetail(detail);
          setDetailLoading(false);
        }
      })
      .catch((err) => {
        if (!canceled) {
          setDetailError(artifactErrorMessage(err));
          setDetailLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [selectedArtifactId, getArtifactDetail]);

  const handleReview = async (approved: boolean) => {
    if (!selectedArtifactId) return;
    setReviewBusy(true);
    setReviewError('');
    try {
      await reviewArtifact(selectedArtifactId, { approved, note: reviewNote.trim() || undefined });
      const updated = await getArtifactDetail(selectedArtifactId);
      setArtifactDetail(updated);
      setReviewNote('');
    } catch (err) {
      setReviewError(artifactErrorMessage(err));
    } finally {
      setReviewBusy(false);
    }
  };

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  return (
    <section className="workspace-view">
      <ViewHeader
        eyebrow="ARTIFACTS / SCOPED FILES"
        title="Workspace files"
        description="Review real persisted artifacts, content hash integrity, and producer lineage."
        onOpenCanvas={onOpenCanvas}
      />

      <div className="workspace-list-tools" style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          <label style={{ flex: '0 0 auto', color: 'var(--canvas-dim)', fontSize: '13px', fontWeight: 500 }}>
            Task filter:
          </label>
          <select
            aria-label="Select task"
            value={selectedTaskId}
            onChange={(e) => {
              setSelectedTaskId(e.target.value);
              setSelectedArtifactId(null);
            }}
            style={{
              minWidth: '280px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--canvas-line-strong)',
              background: 'rgb(255 255 255 / 0.9)',
              color: 'var(--canvas-copy)',
              fontSize: '13px',
            }}
          >
            {!tasks.length && <option value="">No tasks available</option>}
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="file-layout">
        <aside className="file-tree">
          <h2>
            <FolderGit2 /> Artifacts {selectedTask ? `(${selectedTask.title})` : ''}
          </h2>

          {tasksLoading || artifactsLoading ? (
            <p className="workspace-empty">Loading artifacts...</p>
          ) : tasksError ? (
            <div className="workspace-empty">
              <p>{tasksError}</p>
            </div>
          ) : artifactsError ? (
            <div className="workspace-empty">
              <p>{artifactsError}</p>
              <button type="button" onClick={() => void refetch()} style={{ marginTop: '8px' }}>
                Retry
              </button>
            </div>
          ) : !tasks.length ? (
            <p className="workspace-empty">No tasks found in project. Create a task to generate artifacts.</p>
          ) : !artifacts.length ? (
            <p className="workspace-empty">No artifacts have been created for this task yet.</p>
          ) : (
            <ul>
              {artifacts.map((item) => (
                <li
                  key={item.id}
                  className={item.id === selectedArtifactId ? 'is-selected' : ''}
                  onClick={() => setSelectedArtifactId(item.id)}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <FileJson2 size={16} /> {item.name} <small>v{item.version}</small>
                  </span>
                  <b className={`task-table__status task-table__status--${item.status.toLowerCase()}`}>
                    {item.status}
                  </b>
                </li>
              ))}
            </ul>
          )}

          <footer>
            <ShieldCheck /> Secrets and .env stay excluded
          </footer>
        </aside>

        <article className="artifact-preview">
          {!selectedArtifactId ? (
            <div className="workspace-empty">Select an artifact from the list to inspect details.</div>
          ) : detailLoading ? (
            <div className="workspace-empty">Loading artifact details...</div>
          ) : detailError ? (
            <div className="workspace-empty">
              <p>{detailError}</p>
            </div>
          ) : artifactDetail ? (
            <>
              <header>
                <div>
                  <FileJson2 />
                  <span>
                    <small>{artifactDetail.type.toUpperCase()} · VERSION {artifactDetail.version}</small>
                    <h2>{artifactDetail.name}</h2>
                  </span>
                </div>
                <b className={`task-table__status task-table__status--${artifactDetail.status.toLowerCase()}`}>
                  {artifactDetail.status}
                </b>
              </header>

              <dl>
                <div>
                  <dt>Type</dt>
                  <dd>{artifactDetail.type}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>v{artifactDetail.version}</dd>
                </div>
                <div>
                  <dt>Content hash</dt>
                  <dd><code>{artifactDetail.contentHash}</code></dd>
                </div>
                <div>
                  <dt>Producer Agent</dt>
                  <dd>
                    {artifactDetail.agent?.name
                      ? `${artifactDetail.agent.name} (${artifactDetail.agent.provider})`
                      : artifactDetail.agentId}
                  </dd>
                </div>
                <div>
                  <dt>Task</dt>
                  <dd>{artifactDetail.task?.title ?? artifactDetail.taskId}</dd>
                </div>
                <div>
                  <dt>Execution ID</dt>
                  <dd>{artifactDetail.executionId || 'N/A'}</dd>
                </div>
                <div>
                  <dt>Owner User</dt>
                  <dd>
                    {artifactDetail.ownerUser?.displayName ?? artifactDetail.ownerUserId}
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(artifactDetail.createdAt).toLocaleString()}</dd>
                </div>
              </dl>

              {Array.isArray((artifactDetail.payload as Record<string, unknown>)?.consumedArtifacts) &&
                ((artifactDetail.payload as Record<string, unknown>).consumedArtifacts as Array<{ artifactId: string; contentHash?: string; name?: string }>).length > 0 && (
                <div style={{ marginTop: '16px', padding: '12px 16px', border: '1px solid var(--canvas-line-strong)', borderRadius: '8px', background: 'rgba(255,255,255,0.7)' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--canvas-copy)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ShieldCheck size={15} /> Provenance &amp; Consumed Artifacts
                  </h3>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {((artifactDetail.payload as Record<string, unknown>).consumedArtifacts as Array<{ artifactId: string; contentHash?: string; name?: string }>).map((c, i) => (
                      <li key={c.artifactId || i} style={{ fontSize: '12px', padding: '6px 0', borderBottom: i < ((artifactDetail.payload as Record<string, unknown>).consumedArtifacts as Array<unknown>).length - 1 ? '1px solid var(--canvas-line)' : 'none' }}>
                        <div><strong>Source Artifact ID:</strong> <code>{c.artifactId}</code></div>
                        {c.contentHash && <div><strong>Content Hash:</strong> <code>{c.contentHash}</code></div>}
                        {c.name && <div><strong>Source Artifact Name:</strong> {c.name}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <pre>
                <code>{JSON.stringify(artifactDetail.payload, null, 2)}</code>
              </pre>

              {artifactDetail.requiresReview && artifactDetail.status === 'PENDING' && (
                <div style={{ marginTop: '16px', padding: '16px', border: '1px solid var(--canvas-line)', borderRadius: '8px', background: 'rgba(255,255,255,0.5)' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Human Review Required</h3>
                  <textarea
                    placeholder="Optional review note..."
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    disabled={reviewBusy}
                    style={{
                      width: '100%',
                      minHeight: '60px',
                      padding: '8px',
                      borderRadius: '6px',
                      border: '1px solid var(--canvas-line-strong)',
                      marginBottom: '8px',
                      fontSize: '13px',
                    }}
                  />
                  {reviewError && <p style={{ color: 'var(--canvas-red)', fontSize: '12px', marginBottom: '8px' }}>{reviewError}</p>}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      disabled={reviewBusy}
                      onClick={() => void handleReview(true)}
                      style={{ background: 'var(--canvas-green)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      {reviewBusy ? 'Submitting...' : 'Approve Artifact'}
                    </button>
                    <button
                      type="button"
                      disabled={reviewBusy}
                      onClick={() => void handleReview(false)}
                      style={{ background: 'var(--canvas-red)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      {reviewBusy ? 'Submitting...' : 'Reject Artifact'}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </article>
      </div>
    </section>
  );
}



export function FilesView(props: WorkspaceViewProps) {
  return <LiveFilesView {...props} />;
}

const eventGroups: Array<{ label: string; types: string[] }> = [
  { label: 'All events', types: [] },
  { label: 'Tasks', types: ['task', 'taskResponsibility'] },
  { label: 'Artifacts', types: ['artifact', 'dependency'] },
  { label: 'Approvals', types: ['approval'] },
];

export function ActivityView({ onOpenCanvas }: WorkspaceViewProps) {
  const projectId = currentProjectId();
  const [events, setEvents] = useState<Array<{ id: string; type: string; payload: string; time: string }>>([]);
  const [group, setGroup] = useState(0);

  useWorkspaceRealtime(
    projectId,
    useMemo(
      () => ({
        onDelta: (event: RealtimeDeltaEvent) => {
          setEvents((prev) => [
            {
              id: `${event.entity}-${event.entityId}-${Date.now()}`,
              type: event.entity.toUpperCase(),
              payload: `${event.operation} ${event.entity} ${event.entityId.slice(0, 8)}`,
              time: new Date().toLocaleTimeString(),
            },
            ...prev,
          ]);
        },
      }),
      [],
    ),
  );

  const filteredEvents = useMemo(() => {
    if (group === 0) return events;
    const allowed = eventGroups[group].types;
    return events.filter((e) => allowed.includes(e.type.toLowerCase()));
  }, [group, events]);

  return (
    <section className="workspace-view">
      <ViewHeader
        eyebrow="AUDIT / PROTOCOL"
        title="Live activity"
        description="Every task, artifact and approval remains attributable to a human or agent identity."
        onOpenCanvas={onOpenCanvas}
      />
      <div className="activity-layout">
        <aside>
          <span>FILTER EVENTS</span>
          {eventGroups.map((item, index) => (
            <button
              type="button"
              className={group === index ? 'is-active' : ''}
              onClick={() => setGroup(index)}
              key={item.label}
            >
              {item.label} <b>{index === 0 ? events.length : events.filter((e) => item.types.includes(e.type.toLowerCase())).length}</b>
            </button>
          ))}
        </aside>
        <div className="activity-stream">
          {filteredEvents.length === 0 ? (
            <p className="workspace-view__note" style={{ padding: 24 }}>
              <Sparkles /> Realtime protocol events will appear here as team activities occur.
            </p>
          ) : (
            filteredEvents.map((item) => (
              <article key={item.id}>
                <i />
                <time>{item.time}</time>
                <div>
                  <span>{item.type}</span>
                  <h2>{item.payload}</h2>
                </div>
                <code>{item.id.slice(0, 16)}</code>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export function TeamView({ onOpenCanvas }: WorkspaceViewProps) {
  const projectId = currentProjectId();
  const { members, loading: membersLoading, refetch: refetchMembers } = useProjectMembers(projectId ?? undefined);
  const { invitations, createInvitation, refetch: refetchInvitations } = useProjectInvitations(projectId ?? undefined);

  const [formOpen, setFormOpen] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [roleInput, setRoleInput] = useState<ProjectRole>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const refetchMembersRef = useRef(refetchMembers);
  const refetchInvitationsRef = useRef(refetchInvitations);
  refetchMembersRef.current = refetchMembers;
  refetchInvitationsRef.current = refetchInvitations;

  useWorkspaceRealtime(
    projectId,
    useMemo(
      () => ({
        onDelta: (event: RealtimeDeltaEvent) => {
          if ((event.entity as string) === 'invitation' || event.entity === 'member') {
            void refetchMembersRef.current();
            void refetchInvitationsRef.current();
          }
        },
        onResync: () => {
          void refetchMembersRef.current();
          void refetchInvitationsRef.current();
        },
      }),
      [],
    ),
  );

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!targetInput.trim()) return;
    setBusy(true);
    setFormError('');
    setSuccessMsg('');
    try {
      await createInvitation(targetInput.trim(), roleInput);
      setSuccessMsg(`Invitation sent to ${targetInput.trim()}`);
      setTargetInput('');
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workspace-view">
      <ViewHeader
        eyebrow="TEAM / COLLABORATION"
        title="Project members & invitations"
        description="Invite teammates by wallet address or ENS name to collaborate on this workspace."
        onOpenCanvas={onOpenCanvas}
      />

      <div className="activity-layout" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Team Members ({members.length})</h2>
            <p style={{ fontSize: '13px', color: 'var(--canvas-dim)', margin: '4px 0 0 0' }}>
              Users with access to this workspace and its agents.
            </p>
          </div>
          <button
            type="button"
            className="demo-primary"
            onClick={() => {
              setFormOpen(!formOpen);
              setFormError('');
              setSuccessMsg('');
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '6px',
              background: 'var(--canvas-accent, #3b82f6)',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <UserPlus size={16} /> Invite teammate
          </button>
        </div>

        {formOpen && (
          <form
            onSubmit={(e) => void handleInvite(e)}
            style={{
              padding: '20px',
              borderRadius: '8px',
              border: '1px solid var(--canvas-line-strong, #ccc)',
              background: 'rgba(255, 255, 255, 0.95)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              maxWidth: '500px',
            }}
          >
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Invite New Teammate</h3>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Wallet Address (0x...) or ENS Name (.eth)
              </label>
              <input
                type="text"
                required
                placeholder="0x... or name.eth"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--canvas-line-strong, #ccc)',
                  fontSize: '14px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Role
              </label>
              <select
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value as ProjectRole)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--canvas-line-strong, #ccc)',
                  fontSize: '14px',
                }}
              >
                <option value="ADMIN">ADMIN (Full management access)</option>
                <option value="MEMBER">MEMBER (Create tasks & agents)</option>
                <option value="VIEWER">VIEWER (Read-only access)</option>
              </select>
            </div>
            {formError && <p style={{ color: 'var(--canvas-red, #ef4444)', fontSize: '13px', margin: 0 }}>{formError}</p>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--canvas-line-strong)',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'var(--canvas-accent, #3b82f6)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {busy ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </form>
        )}

        {successMsg && (
          <p style={{ color: 'var(--canvas-green, #10b981)', fontSize: '14px', fontWeight: 500, margin: 0 }}>
            {successMsg}
          </p>
        )}

        <div style={{ display: 'grid', gap: '12px' }}>
          {membersLoading ? (
            <p style={{ color: 'var(--canvas-dim)' }}>Loading team members...</p>
          ) : members.length === 0 ? (
            <p style={{ color: 'var(--canvas-dim)' }}>No members found.</p>
          ) : (
            members.map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--canvas-line-strong, #e5e7eb)',
                  background: '#fff',
                }}
              >
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>
                    {m.user?.displayName || m.user?.ensName || m.user?.walletAddress || 'Member'}
                  </h3>
                  {m.user?.walletAddress && (
                    <code style={{ fontSize: '12px', color: 'var(--canvas-dim)' }}>{m.user.walletAddress}</code>
                  )}
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: m.role === 'OWNER' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                    color: m.role === 'OWNER' ? '#2563eb' : '#4b5563',
                  }}
                >
                  {m.role}
                </span>
              </div>
            ))
          )}
        </div>

        {invitations.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>
              Pending Invitations ({invitations.length})
            </h3>
            <div style={{ display: 'grid', gap: '12px' }}>
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--canvas-line-strong, #e5e7eb)',
                    background: 'rgba(249, 250, 251, 0.8)',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>{inv.invitedWallet}</span>
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--canvas-dim)', textTransform: 'uppercase' }}>
                      ({inv.role})
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--canvas-dim)', fontStyle: 'italic' }}>
                    Pending Acceptance
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

