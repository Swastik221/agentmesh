import { Handle, Position, type NodeProps } from '@xyflow/react';
import { StatusBadge, type BadgeTone } from '@agentmesh/ui';
import type { TaskBoardFlowNode, TaskStatus } from '../../types';

/**
 * Task status drives colour, and colour alone should be enough to read the
 * board: nothing has claimed it yet, an agent claimed it, or the mesh assigned
 * it automatically and it is still awaiting confirmation.
 */
const TASK_TONE: Record<TaskStatus, BadgeTone> = {
  proposed: 'neutral',
  claimed: 'accent',
  'auto-assigned': 'warning',
};

/** The shared board every connected agent negotiates against. */
export function TaskBoardNode({ data }: NodeProps<TaskBoardFlowNode>) {
  return (
    <div className="am-node am-node--board">
      <Handle type="target" position={Position.Left} id="in-left" className="am-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="am-handle" />

      <div className="am-node__titlebar">
        <span className="am-node__title">{data.title}</span>
        <span className="am-board__count">{data.tasks.length} open</span>
      </div>

      <ul className="am-board__list">
        {data.tasks.map((task) => (
          <li className="am-board__task" key={task.id}>
            <div className="am-board__taskhead">
              <span className="am-board__taskid">{task.id}</span>
              <StatusBadge tone={TASK_TONE[task.status]}>{task.status}</StatusBadge>
            </div>
            <div className="am-board__tasktitle">{task.title}</div>
            <div className="am-board__taskmeta">
              <span className="am-board__ref">{task.ref}</span>
              {task.claimedBy ? <span className="am-board__owner">{task.claimedBy}</span> : null}
            </div>
          </li>
        ))}
      </ul>

      <Handle type="source" position={Position.Right} id="out-right" className="am-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="am-handle" />
    </div>
  );
}
