import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CheckCircle2, Clock, ListTodo, Plus, Users } from 'lucide-react';
import type { LiveTask, OfferCandidate } from '../../../adapters/live/task.adapter';

/**
 * A task as the board draws it. Derived from the real LiveTask rather than
 * stored separately, so the board can never show a state the server does not
 * have.
 */
export interface BoardTask {
  id: string;
  title: string;
  /** Open to any agent: offerExpiresAt is in the future and nobody owns it. */
  open: boolean;
  /** Seconds left before the coordinator assigns it, or null if not an offer. */
  secondsLeft: number | null;
  ownerName: string | null;
  /** True when the owner took it for itself rather than being assigned. */
  selfClaimed: boolean;
  status: string;
}

export interface TaskBoardNodeData {
  tasks: BoardTask[];
  candidates: OfferCandidate[];
  onCreateOffer: (title: string, offerSeconds: number) => Promise<void>;
  onClaimFor: (taskId: string, agentId: string) => Promise<void>;
  error?: string | null;
}

/** Offer windows the board offers. Short enough to demo, long enough to act. */
const OFFER_WINDOWS = [15, 30, 60, 120];

/**
 * Turn the real task rows into what the board draws.
 *
 * Kept next to the component so the canvas does not have to duplicate the
 * rules about what counts as an open offer.
 */
export function toBoardTask(task: LiveTask, now: number): BoardTask {
  const owner = task.responsibilities?.[0];
  const expiresAt = task.offerExpiresAt ? new Date(task.offerExpiresAt).getTime() : null;
  const open = !owner && expiresAt !== null;

  return {
    id: task.id,
    title: task.title,
    open,
    secondsLeft: open && expiresAt !== null ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null,
    ownerName: owner?.agent?.name ?? null,
    selfClaimed: owner?.assignmentSource === 'SELF_CLAIMED',
    status: task.status,
  };
}

export function TaskBoardNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as TaskBoardNodeData;
  const tasks = nodeData.tasks ?? [];
  const candidates = nodeData.candidates ?? [];

  const [title, setTitle] = useState('');
  const [window, setWindow] = useState(OFFER_WINDOWS[1]);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const openCount = tasks.filter((t) => t.open).length;
  const freeAgents = useMemo(() => candidates.filter((c) => !c.busy), [candidates]);

  // Clear the picker when the offer it belonged to stops being open, so a
  // resolved task cannot leave a dangling menu behind.
  useEffect(() => {
    if (claimingId && !tasks.some((t) => t.id === claimingId && t.open)) {
      setClaimingId(null);
    }
  }, [tasks, claimingId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setBusy(true);
    setLocalError(null);
    try {
      await nodeData.onCreateOffer(trimmed, window);
      setTitle('');
    } catch (reason) {
      // The server's own message, never a friendlier invention.
      setLocalError(reason instanceof Error ? reason.message : 'Could not post that task.');
    } finally {
      setBusy(false);
    }
  };

  const claimFor = async (taskId: string, agentId: string) => {
    setBusy(true);
    setLocalError(null);
    try {
      await nodeData.onClaimFor(taskId, agentId);
      setClaimingId(null);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'Could not give out that task.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`product-node product-taskboard ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />

      <header className="product-taskboard__header">
        <div className="product-taskboard__heading">
          <ListTodo size={16} color="var(--mesh-primary-green)" />
          <strong>Shared Task Board</strong>
        </div>
        <span className="product-taskboard__badge">
          {openCount} open · {freeAgents.length} free
        </span>
      </header>

      {/* Post work to the board without naming an agent. */}
      <form className="product-taskboard__compose nodrag nopan" onSubmit={submit}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs doing? Every agent will see it."
          aria-label="Task for any agent"
          disabled={busy}
        />
        <select
          value={window}
          onChange={(event) => setWindow(Number(event.target.value))}
          aria-label="Seconds before it is auto assigned"
          disabled={busy}
        >
          {OFFER_WINDOWS.map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds}s
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !title.trim()}>
          <Plus size={13} /> Post
        </button>
      </form>
      <p className="product-taskboard__hint">
        Any agent can claim it. If none does within the window, it goes to whichever agent
        is free.
      </p>

      {(localError || nodeData.error) && (
        <p role="alert" className="product-taskboard__error">
          {localError || nodeData.error}
        </p>
      )}

      <ul className="product-taskboard__list nowheel">
        {tasks.length === 0 && (
          <li className="product-taskboard__empty">
            Nothing on the board yet. Post the first task above.
          </li>
        )}

        {tasks.map((task) => (
          <li key={task.id} className="product-taskboard__item">
            <div className="product-taskboard__item-head">
              <span className="product-taskboard__id">{task.id.slice(-8)}</span>
              <span
                className={`product-taskboard__status product-taskboard__status--${
                  task.open ? 'open' : task.selfClaimed ? 'claimed' : 'assigned'
                }`}
              >
                {task.open ? 'open to all' : task.selfClaimed ? 'claimed' : 'assigned'}
              </span>
            </div>

            <div className="product-taskboard__item-title">{task.title}</div>

            <div className="product-taskboard__item-footer">
              {task.open ? (
                <>
                  <span className="product-taskboard__countdown">
                    <Clock size={10} />
                    {task.secondsLeft}s to auto assign
                  </span>
                  {claimingId === task.id ? (
                    <div className="product-taskboard__picker nodrag nopan">
                      {candidates.length === 0 && <span>No agents online</span>}
                      {candidates.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          disabled={busy || candidate.busy}
                          title={candidate.busy ? `${candidate.name} is busy` : `Give it to ${candidate.name}`}
                          onClick={() => void claimFor(task.id, candidate.id)}
                        >
                          {candidate.name}
                          {candidate.busy ? ' (busy)' : ''}
                        </button>
                      ))}
                      <button type="button" onClick={() => setClaimingId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="product-taskboard__claim-btn nodrag nopan"
                      onClick={() => setClaimingId(task.id)}
                    >
                      <Users size={11} /> Give to an agent
                    </button>
                  )}
                </>
              ) : (
                <div className="product-taskboard__assigned">
                  <CheckCircle2 size={11} color="var(--mesh-primary-green)" />
                  <span>
                    {task.ownerName
                      ? `${task.ownerName}${task.selfClaimed ? ' took this' : ' was assigned'}`
                      : task.status.toLowerCase().replace('_', ' ')}
                  </span>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
