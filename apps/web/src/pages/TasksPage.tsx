import { useEffect, useState } from 'react';
import { CheckCircle2, ListChecks, Loader2, Plus, UserCheck, XCircle } from 'lucide-react';
import type { TaskDTO } from '@agentmesh/shared';
import { api, ArtifactItem } from '../lib/api';
import { useWorkspace } from '../state/WorkspaceContext';
import type { WorkspaceLiveState, TaskSummary } from '../hooks/useWorkspaceSocket';
import { StateNote } from '../components/status/StateNote';

type BadgeTone = 'success' | 'neutral' | 'warning' | 'danger';

const TASK_TONE: Record<TaskDTO['status'], BadgeTone> = {  TODO: 'neutral',
  IN_PROGRESS: 'warning',
  PENDING_APPROVAL: 'warning',
  BLOCKED: 'danger',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const TASK_LABEL: Record<TaskDTO['status'], string> = {
  TODO: 'Available',
  IN_PROGRESS: 'In progress',
  PENDING_APPROVAL: 'Awaiting review',
  BLOCKED: 'Blocked',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export interface TasksPageProps {
  live: WorkspaceLiveState;
  refresh: () => Promise<void>;
}

/**
 * Real tasks: created and persisted through the task API, assigned through
 * the coordinator (atomic server-side assignment), and advanced through the
 * live WebSocket status stream. Artifacts submitted by agents open the human
 * review gate (approve/reject) backed by the review API.
 */
export function TasksPage({ live, refresh }: TasksPageProps) {
  const { activeProjectId } = useWorkspace();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskDTO['priority']>('MEDIUM');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const onCreate = async () => {
    if (!activeProjectId || !title.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.createTask(activeProjectId, {
        title: title.trim(),
        description: description.trim(),
        priority,
      });
      setTitle('');
      setDescription('');
      await refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const onAssign = async (task: TaskSummary, agentId?: string) => {
    if (!activeProjectId) return;
    setAssigning(task.taskId);
    try {
      await api.assignTask(activeProjectId, task.taskId, agentId);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setAssigning(null);
    }
  };

  const onReview = async (projectId: string, artifact: ArtifactItem, approved: boolean) => {
    setReviewing(artifact.id);
    try {
      await api.reviewArtifact(
        projectId,
        artifact.id,
        approved ? { approved: true, note: 'Approved from workspace' } : { approved: false },
      );
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setReviewing(null);
    }
  };

  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">Tasks</h1>
        <p className="page__subtitle">
          Tasks are persisted server-side, claimable by connected agents, and advance through the
          live status stream (available → claimed → running → awaiting review → completed).
        </p>
      </div>

      <section className="panel">
        <div className="panel__title">Create task</div>
        <div className="panel__row panel__row--stack">
          <input
            className="field"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onCreate();
            }}
          />
          <div className="panel__row">
            <input
              className="field"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <select
              className="field field--select field--auto"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskDTO['priority'])}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
            <button
              className="btn btn--primary"
              onClick={() => void onCreate()}
              disabled={creating || !title.trim()}
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create task
            </button>
          </div>
        </div>
        {createError && <StateNote tone="error" text={createError} />}
      </section>

      <section className="panel">
        <div className="panel__title">Task board</div>
        {live.tasks.length === 0 ? (
          <StateNote tone="empty" text="No tasks yet. Create one above or wait for a connected agent." />
        ) : (
          <ul className="tasks-list">
            {live.tasks.map((task) => (
              <TaskRow
                key={task.taskId}
                task={task}
                live={live}
                assigning={assigning}
                reviewing={reviewing}
                onAssign={onAssign}
                onReview={onReview}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TaskStatusBadge({ status }: { status: TaskDTO['status'] }) {
  return (
    <span className={`task-status-badge task-status-badge--${TASK_TONE[status]}`}>
      {TASK_LABEL[status]}
    </span>
  );
}

function TaskRow({
  task,
  live,
  assigning,
  reviewing,
  onAssign,
  onReview,
}: {
  task: TaskSummary;
  live: WorkspaceLiveState;
  assigning: string | null;
  reviewing: string | null;
  onAssign: (task: TaskSummary, agentId?: string) => Promise<void>;
  onReview: (projectId: string, artifact: ArtifactItem, approved: boolean) => Promise<void>;
}) {
  const { activeProjectId } = useWorkspace();
  const availableAgents = live.agents.filter((a) => a.status === 'ONLINE');
  const isPending = task.status === 'PENDING_APPROVAL' || task.status === 'IN_PROGRESS';
  const [artifacts, setArtifacts] = useState<ArtifactItem[] | null>(null);

  useEffect(() => {
    if (!activeProjectId || !isPending) {
      setArtifacts(null);
      return;
    }
    let cancelled = false;
    api
      .listArtifacts(activeProjectId, task.taskId)
      .then((res) => {
        if (!cancelled) setArtifacts(res.items);
      })
      .catch(() => {
        if (!cancelled) setArtifacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, task.taskId, isPending]);

  const reviewable = artifacts?.find((a) => a.requiresReview && a.status === 'PENDING');

  return (
    <li className={`task-row task-row--${task.status.toLowerCase()}`}>
      <div className="task-row__main">
        <div className="task-row__title">
          <ListChecks size={14} strokeWidth={1.75} aria-hidden="true" />
          {task.title}
        </div>
        <div className="task-row__meta mono">
          {task.taskId.slice(0, 10)}… · {task.priority ?? 'MEDIUM'} priority
          {task.agentName ? ` · assignee: ${task.agentName}` : ''}
        </div>
        {typeof task.progress === 'number' && task.status === 'IN_PROGRESS' && (
          <div className="task-row__progress">
            <div className="task-row__progress-track">
              <div
                className="task-row__progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
              />
            </div>
            <span className="task-row__progress-label mono">
              {Math.min(100, Math.max(0, task.progress))}%
              {task.message ? ` · ${task.message}` : ''}
            </span>
          </div>
        )}
        {reviewable && (
          <div className="task-row__artifact mono">
            ↔ artifact: {reviewable.name} v{reviewable.version}
          </div>
        )}
      </div>

      <div className="task-row__actions">
        <TaskStatusBadge status={task.status} />

        {task.agentName ? null : (
          <select
            className="field field--select field--auto"
            defaultValue=""
            disabled={assigning === task.taskId}
            onChange={(e) => {
              const agentId = e.target.value || undefined;
              void onAssign(task, agentId);
              e.target.value = '';
            }}
          >
            <option value="" disabled>
              {availableAgents.length === 0 ? 'No agents online' : 'Assign to…'}
            </option>
            {availableAgents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.name}
              </option>
            ))}
          </select>
        )}

        {task.status === 'TODO' && !task.agentName && availableAgents.length > 0 && (
          <button
            className="btn btn--ghost"
            disabled={assigning === task.taskId}
            onClick={() => void onAssign(task)}
            title="Let the coordinator pick the best available agent"
          >
            {assigning === task.taskId ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <UserCheck size={13} />
            )}
            Auto-assign
          </button>
        )}

        {reviewable && (
          <>
            <button
              className="btn btn--success"
              disabled={reviewing === reviewable.id}
              onClick={() => void onReview(activeProjectId!, reviewable, true)}
            >
              <CheckCircle2 size={13} /> Approve
            </button>
            <button
              className="btn btn--danger"
              disabled={reviewing === reviewable.id}
              onClick={() => void onReview(activeProjectId!, reviewable, false)}
            >
              <XCircle size={13} /> Reject
            </button>
          </>
        )}
      </div>
    </li>
  );
}