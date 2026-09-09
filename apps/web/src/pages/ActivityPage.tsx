import { Activity, Bot, GitCommit, User, FileWarning } from 'lucide-react';
import type { ActivityEventItem } from '../lib/api';
import type { WorkspaceLiveState } from '../hooks/useWorkspaceSocket';
import { StateNote } from '../components/status/StateNote';

function actorIcon(actorType: string) {
  switch (actorType) {
    case 'agent':
      return <Bot size={13} strokeWidth={1.75} />;
    case 'human':
      return <User size={13} strokeWidth={1.75} />;
    case 'coordinator':
    case 'system':
      return <Activity size={13} strokeWidth={1.75} />;
    default:
      return <FileWarning size={13} strokeWidth={1.75} />;
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export interface ActivityPageProps {
  activity: WorkspaceLiveState['activity'];
  connected: boolean;
}

/**
 * Persisted activity feed: fetched from the backend on load, then appended
 * live from ACTIVITY_CREATED events over the WebSocket stream.
 */
export function ActivityPage({ activity, connected }: ActivityPageProps) {
  return (
    <div className="page">
      <div className="page__head">
        <h1 className="page__title">Activity</h1>
        <p className="page__subtitle">
          Workspace event feed, persisted server-side and streamed live
          {connected ? '' : ' (reconnecting…)'}.
        </p>
      </div>

      <section className="panel">
        {activity.length === 0 ? (
          <StateNote
            tone="empty"
            text="No activity yet. Creating tasks, connecting agents and reviewing artifacts all appear here."
          />
        ) : (
          <ol className="activity-list">
            {activity.map((event) => (
              <ActivityRow key={event.id} event={event} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export function ActivityRow({ event }: { event: ActivityEventItem }) {
  const label = event.actorName ?? (event.actorType === 'agent' ? event.actorId.slice(0, 12) : event.actorType);
  return (
    <li className="activity-row">
      <span className="activity-row__icon">{actorIcon(event.actorType)}</span>
      <div className="activity-row__body">
        <div className="activity-row__line">
          <span className="activity-row__type mono">{event.type}</span>
          <span className="activity-row__time mono">{formatTime(event.createdAt)}</span>
        </div>
        {event.message && <div className="activity-row__message">{event.message}</div>}
        <div className="activity-row__meta mono">
          {label}
          {event.taskId ? (
            <>
              {' '}
              · <GitCommit size={10} className="inline" /> task {event.taskId.slice(0, 8)}…
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}