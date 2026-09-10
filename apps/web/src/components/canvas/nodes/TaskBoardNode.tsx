import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CheckCircle2, Clock, ListTodo } from 'lucide-react';
import type { Task } from '../../../adapters/types';

export interface TaskBoardNodeData {
  tasks: Task[];
  onClaimTask?: (taskId: string) => void;
}

export function TaskBoardNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as TaskBoardNodeData;
  const tasks = nodeData.tasks || [];
  const openCount = tasks.filter((t) => t.status === 'proposed').length;

  return (
    <article className={`product-node product-taskboard ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />

      {/* Header */}
      <header className="product-taskboard__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ListTodo size={16} color="var(--mesh-primary-green)" />
          <strong>Shared Task Board</strong>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            backgroundColor: 'var(--mesh-bg-card)',
            border: '1px solid var(--mesh-border-subtle)',
            padding: '2px 8px',
            borderRadius: 999,
            color: 'var(--mesh-text-muted)',
          }}
        >
          {openCount} proposed
        </span>
      </header>

      {/* Task List */}
      <ul className="product-taskboard__list nowheel">
        {tasks.map((task) => {
          const isProposed = task.status === 'proposed';
          const isClaimed = task.status === 'claimed';
          const isAuto = task.status === 'auto-assigned';

          return (
            <li key={task.id} className="product-taskboard__item">
              <div className="product-taskboard__item-head">
                <span className="product-taskboard__id">{task.id}</span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: 4,
                    backgroundColor: isProposed
                      ? '#EBF5FF'
                      : isClaimed
                        ? 'var(--mesh-soft-mint)'
                        : isAuto
                          ? '#F5E8FF'
                          : '#F0F2EE',
                    color: isProposed
                      ? '#0066CC'
                      : isClaimed
                        ? 'var(--mesh-primary-green)'
                        : isAuto
                          ? 'var(--mesh-owner-anand)'
                          : 'var(--mesh-text-muted)',
                  }}
                >
                  {task.status}
                </span>
              </div>

              <div className="product-taskboard__item-title">{task.title}</div>

              <div className="product-taskboard__item-footer">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontSize: 10,
                      backgroundColor: 'var(--mesh-bg-secondary)',
                      padding: '1px 5px',
                      borderRadius: 3,
                      fontFamily: 'var(--mesh-font-mono)',
                      color: 'var(--mesh-text-muted)',
                    }}
                  >
                    {task.capability}
                  </span>
                </div>

                {isProposed ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {typeof task.countdown === 'number' && task.countdown > 0 && (
                      <span className="product-taskboard__countdown">
                        <Clock size={10} style={{ display: 'inline', marginRight: 2 }} />
                        {task.countdown}s
                      </span>
                    )}
                    <button
                      type="button"
                      className="product-taskboard__claim-btn nodrag nopan"
                      onClick={() => nodeData.onClaimTask?.(task.id)}
                    >
                      Claim task
                    </button>
                  </div>
                ) : (
                  <div className="product-taskboard__assigned">
                    <CheckCircle2 size={11} color="var(--mesh-primary-green)" />
                    <span>
                      {task.claimedByName || task.claimedBy || task.suggestedAgent}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
