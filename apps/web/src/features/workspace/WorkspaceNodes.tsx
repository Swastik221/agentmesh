import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type {
  ApprovalRequest,
  HumanOwner,
  ProductAgent,
  ProductTask,
  WorkspaceArtifact,
} from './workspace.types';

type AgentData = { agent: ProductAgent; owner: HumanOwner } & Record<string, unknown>;
type TaskData = { tasks: ProductTask[]; onClaim: (taskId: string) => void } & Record<
  string,
  unknown
>;
type CoordinatorData = { activity: string } & Record<string, unknown>;
type ArtifactData = { artifact: WorkspaceArtifact } & Record<string, unknown>;
type ApprovalData = {
  request: ApprovalRequest;
  onDecision: (decision: 'approved' | 'rejected') => void;
} & Record<string, unknown>;
export type ProductNode =
  | Node<AgentData, 'productAgent'>
  | Node<TaskData, 'productTasks'>
  | Node<CoordinatorData, 'coordinator'>
  | Node<ArtifactData, 'artifact'>
  | Node<ApprovalData, 'approval'>;

function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="in-left" className="product-handle" />
      <Handle type="target" position={Position.Top} id="in-top" className="product-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="product-handle" />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="product-handle" />
    </>
  );
}

export function ProductAgentNode({ data }: NodeProps<Node<AgentData, 'productAgent'>>) {
  return (
    <article className={`product-node product-agent product-owner--${data.owner.color}`}>
      <Ports />
      <header>
        <span className="product-window-dots">
          <i />
          <i />
          <i />
        </span>
        <strong>
          {data.agent.name} / {data.agent.provider}
        </strong>
        <span className="product-state product-state--connected">{data.agent.status}</span>
      </header>
      <div className="product-agent__identity">
        <span>{data.owner.name}</span>
        <small>
          human · {data.owner.ens} · {data.owner.address}
        </small>
        <b>
          agent · {data.agent.ens} · {data.agent.address}
        </b>
      </div>
      <div className="product-capabilities">
        {data.agent.capabilities.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <div className="product-terminal">
        {data.agent.logs.map((line, index) => (
          <p key={line}>
            <i>{String(index + 1).padStart(2, '0')}</i>
            <span>→</span>
            {line}
          </p>
        ))}
      </div>
    </article>
  );
}

export function CoordinatorNode({ data }: NodeProps<Node<CoordinatorData, 'coordinator'>>) {
  return (
    <article className="product-node product-coordinator">
      <Ports />
      <header>
        <strong>Mesh Coordinator</strong>
        <span className="product-state product-state--flow">live</span>
      </header>
      <div>
        <span className="product-coordinator__pulse" />
        {data.activity}
      </div>
      <p>protocol · deterministic assignment</p>
    </article>
  );
}

export function ProductTaskBoardNode({ data }: NodeProps<Node<TaskData, 'productTasks'>>) {
  return (
    <article className="product-node product-taskboard">
      <Ports />
      <header>
        <strong>Shared task board</strong>
        <span>{data.tasks.filter((task) => task.status === 'proposed').length} open</span>
      </header>
      <ul>
        {data.tasks.map((task) => (
          <li key={task.id} className={task.status === 'proposed' ? '' : 'is-assigned'}>
            <div>
              <code>{task.id}</code>
              <span className={`task-state task-state--${task.status}`}>{task.status}</span>
            </div>
            <strong>{task.title}</strong>
            <p>
              <span>{task.capability}</span>
              <small>suggested · {task.suggestedAgent}</small>
            </p>
            <footer>
              {task.status === 'proposed' ? (
                <>
                  <button className="nodrag nopan" onClick={() => data.onClaim(task.id)}>
                    Claim task
                  </button>
                  <time>{task.countdown}s to auto-assign</time>
                </>
              ) : (
                <>
                  <span>✓ {task.claimedBy}</span>
                  <small>{task.reason}</small>
                </>
              )}
            </footer>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function ArtifactNode({ data }: NodeProps<Node<ArtifactData, 'artifact'>>) {
  return (
    <article className="product-node product-artifact">
      <Ports />
      <header>
        <strong>
          {'{ }'} {data.artifact.name}
        </strong>
        <span className="product-state product-state--connected">published</span>
      </header>
      <dl>
        <div>
          <dt>schema</dt>
          <dd>{data.artifact.schema}</dd>
        </div>
        <div>
          <dt>hash</dt>
          <dd>{data.artifact.hash}</dd>
        </div>
        <div>
          <dt>from</dt>
          <dd>{data.artifact.publishedBy}</dd>
        </div>
        <div>
          <dt>used by</dt>
          <dd>{data.artifact.usedBy}</dd>
        </div>
      </dl>
    </article>
  );
}

export function ApprovalNode({ data }: NodeProps<Node<ApprovalData, 'approval'>>) {
  return (
    <article className={`product-node product-approval product-approval--${data.request.status}`}>
      <Ports />
      <header>
        <strong>Human approval required</strong>
        <span>{data.request.id}</span>
      </header>
      <div className="product-approval__risk">High-risk action</div>
      <h3>{data.request.action}</h3>
      <p>{data.request.detail}</p>
      <small>Agent can propose. Wallet owner holds final authority.</small>
      {data.request.status === 'pending' ? (
        <footer>
          <button className="nodrag nopan approve" onClick={() => data.onDecision('approved')}>
            Approve
          </button>
          <button className="nodrag nopan reject" onClick={() => data.onDecision('rejected')}>
            Reject
          </button>
        </footer>
      ) : (
        <div className="product-approval__decision">
          {data.request.status === 'approved' ? '✓ Approved by dev1.eth' : '× Rejected by dev1.eth'}
        </div>
      )}
    </article>
  );
}
