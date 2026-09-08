import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, LocateFixed, PanelRightOpen, Sparkles, X } from 'lucide-react';
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../features/workspace/workspace.css';
import '../../features/workspace/workspace-spatial.css';
import {
  ApprovalNode,
  ArtifactNode,
  CoordinatorNode,
  ProductAgentNode,
  ProductTaskBoardNode,
  type ProductNode,
} from '../../features/workspace/WorkspaceNodes';
import {
  agents,
  artifact,
  createWorkspaceState,
  owners,
  presence,
} from '../../features/workspace/workspace.mock';
import type { ProtocolEvent, ProductTask } from '../../features/workspace/workspace.types';

const nodeTypes = {
  productAgent: ProductAgentNode,
  productTasks: ProductTaskBoardNode,
  coordinator: CoordinatorNode,
  artifact: ArtifactNode,
  approval: ApprovalNode,
};
const initialPositions = {
  coordinator: { x: 430, y: 20 },
  orion: { x: 10, y: 190 },
  tasks: { x: 395, y: 170 },
  vega: { x: 850, y: 190 },
  artifact: { x: 710, y: 590 },
  approval: { x: 120, y: 590 },
};
const noop = () => undefined;
const seedNodes: ProductNode[] = [
  {
    id: 'coordinator',
    type: 'coordinator',
    position: initialPositions.coordinator,
    data: { activity: 'splitting PRD into tasks' },
  },
  {
    id: 'orion',
    type: 'productAgent',
    position: initialPositions.orion,
    className: 'canvas-owner-purple',
    data: { agent: agents[0], owner: owners[0] },
  },
  {
    id: 'tasks',
    type: 'productTasks',
    position: initialPositions.tasks,
    data: { tasks: createWorkspaceState().tasks, onClaim: noop },
  },
  {
    id: 'vega',
    type: 'productAgent',
    position: initialPositions.vega,
    className: 'canvas-owner-green',
    data: { agent: agents[1], owner: owners[1] },
  },
  { id: 'artifact', type: 'artifact', position: initialPositions.artifact, data: { artifact } },
  {
    id: 'approval',
    type: 'approval',
    position: initialPositions.approval,
    data: { request: createWorkspaceState().approval, onDecision: noop },
  },
];
const edgeBase = {
  type: 'smoothstep' as const,
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#648b83' },
  style: { stroke: '#648b83', strokeWidth: 1.6 },
  labelStyle: { fill: '#344b47', fontSize: 10 },
  labelBgStyle: { fill: '#fbfdf7', stroke: '#b7c9bd' },
  labelBgPadding: [5, 4] as [number, number],
};
const initialEdges: Edge[] = [
  {
    ...edgeBase,
    id: 'coordinator-tasks',
    source: 'coordinator',
    target: 'tasks',
    label: 'TASK_PROPOSAL',
  },
  { ...edgeBase, id: 'tasks-orion', source: 'tasks', target: 'orion', label: 'preference: AM-114' },
  { ...edgeBase, id: 'tasks-vega', source: 'tasks', target: 'vega', label: 'preference: AM-115' },
  {
    ...edgeBase,
    id: 'vega-artifact',
    source: 'vega',
    target: 'artifact',
    label: 'schema published',
  },
  {
    ...edgeBase,
    id: 'artifact-orion',
    source: 'artifact',
    target: 'orion',
    label: 'payment-api.json',
  },
  {
    ...edgeBase,
    id: 'vega-approval',
    source: 'vega',
    target: 'approval',
    label: 'deploy requested',
    style: { stroke: '#f0b458', strokeWidth: 1.4 },
  },
];
const timestamp = () => new Date().toLocaleTimeString([], { hour12: false });
const ownerFor = (agentId: string) => (agentId === 'orion' ? 'Anand-demo' : 'Swastik-demo');

function Inspector({
  selected,
  tasks,
  events,
  onClose,
}: {
  selected: ProductNode | undefined;
  tasks: ProductTask[];
  events: ProtocolEvent[];
  onClose: () => void;
}) {
  const title =
    selected?.type === 'productAgent'
      ? `${selected.data.agent.name} / ${selected.data.agent.provider}`
      : selected?.type === 'productTasks'
        ? 'Shared task board'
        : selected?.type === 'artifact'
          ? selected.data.artifact.name
          : selected?.type === 'approval'
            ? selected.data.request.action
            : 'Mesh Coordinator';
  const owner = selected?.type === 'productAgent' ? selected.data.owner : owners[0];
  const current =
    selected?.type === 'productAgent'
      ? tasks.find((task) => task.claimedBy === selected.data.agent.id)
      : undefined;
  return (
    <aside className="workspace-inspector-panel">
      <header>
        <div>
          <span>INSPECTOR</span>
          <b>Selected node</b>
        </div>
        <button type="button" className="workspace-panel__close" onClick={onClose}>
          <X size={14} />
          <span className="sr-only">Close inspector</span>
        </button>
      </header>
      <section>
        <small>{selected?.type ?? 'coordinator'}</small>
        <h2>{title}</h2>
        <dl>
          <div>
            <dt>Human owner</dt>
            <dd>{owner.name}</dd>
          </div>
          <div>
            <dt>Human identity</dt>
            <dd className="identity-value">{owner.ens}</dd>
          </div>
          <div>
            <dt>Wallet</dt>
            <dd>{owner.address}</dd>
          </div>
          {selected?.type === 'productAgent' && (
            <>
              <div>
                <dt>Agent identity</dt>
                <dd className="identity-value">{selected.data.agent.ens}</dd>
              </div>
              <div>
                <dt>Capabilities</dt>
                <dd>{selected.data.agent.capabilities.join(' · ')}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Current task</dt>
            <dd>{current ? `${current.id} · ${current.title}` : 'No active claim'}</dd>
          </div>
        </dl>
      </section>
      <section>
        <small>PERMISSIONS</small>
        <ul className="permission-list">
          <li className="yes">✓ Can read scoped repository</li>
          <li className="yes">✓ Can propose changes</li>
          <li>○ Code/task state off-chain</li>
          <li className="no">× Cannot deploy without approval</li>
          <li className="no">× Cannot access wallet keys</li>
        </ul>
      </section>
      <section className="inspector-events">
        <small>LATEST PROTOCOL EVENTS</small>
        <ol>
          {events
            .slice(-3)
            .reverse()
            .map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong>
                <span>{event.payload}</span>
              </li>
            ))}
        </ol>
      </section>
      <footer>
        ENS identity rail · optional
        <br />
        Structured workspace events · auditable
      </footer>
    </aside>
  );
}

function ActivityRail({ events, onClose }: { events: ProtocolEvent[]; onClose: () => void }) {
  return (
    <section className="protocol-rail">
      <header>
        <div>
          <i /> LIVE PROTOCOL ACTIVITY
        </div>
        <div className="protocol-rail__actions">
          <span>{events.length} events · structured messages</span>
          <button type="button" className="workspace-panel__close" onClick={onClose}>
            <X size={14} />
            <span className="sr-only">Close activity</span>
          </button>
        </div>
      </header>
      <div className="protocol-events">
        {events.slice(-9).map((event) => (
          <article key={event.id}>
            <time>{event.time}</time>
            <strong>{event.type}</strong>
            <span>
              {event.sender} → {event.receiver}
            </span>
            <p>{event.payload}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Canvas() {
  const [workspace, setWorkspace] = useState(createWorkspaceState);
  const [baseNodes, setBaseNodes, onNodesChange] = useNodesState<ProductNode>(seedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const [selectedId, setSelectedId] = useState('orion');
  const [moving, setMoving] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const { fitView } = useReactFlow<ProductNode>();

  const claim = useCallback(
    (taskId: string) =>
      setWorkspace((current) => {
        const task = current.tasks.find((item) => item.id === taskId);
        if (!task || task.status !== 'proposed') return current;
        return {
          ...current,
          tasks: current.tasks.map((item) =>
            item.id === taskId
              ? { ...item, status: 'claimed', claimedBy: item.suggestedAgent, countdown: undefined }
              : item,
          ),
          events: [
            ...current.events,
            {
              id: `claim-${Date.now()}`,
              time: timestamp(),
              sender: ownerFor(task.suggestedAgent),
              receiver: task.suggestedAgent,
              type: 'TASK_CLAIMED',
              payload: `${task.id} · ${task.reason}`,
            },
          ],
        };
      }),
    [],
  );
  const decide = useCallback(
    (decision: 'approved' | 'rejected') =>
      setWorkspace((current) => ({
        ...current,
        approval: { ...current.approval, status: decision },
        events: [
          ...current.events,
          {
            id: `approval-${Date.now()}`,
            time: timestamp(),
            sender: 'dev1.eth',
            receiver: 'Vega',
            type: decision === 'approved' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
            payload: `${current.approval.action} · ${decision}`,
          },
        ],
      })),
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(
      () =>
        setWorkspace((current) => {
          const expired = current.tasks.filter(
            (task) => task.status === 'proposed' && task.countdown === 1,
          );
          return {
            ...current,
            tasks: current.tasks.map((task) =>
              task.status !== 'proposed' || !task.countdown
                ? task
                : task.countdown === 1
                  ? {
                      ...task,
                      status: 'auto-assigned',
                      claimedBy: task.suggestedAgent,
                      countdown: undefined,
                    }
                  : { ...task, countdown: task.countdown - 1 },
            ),
            events: expired.length
              ? [
                  ...current.events,
                  ...expired.map((task) => ({
                    id: `auto-${task.id}-${Date.now()}`,
                    time: timestamp(),
                    sender: 'coordinator',
                    receiver: task.suggestedAgent,
                    type: 'TASK_CLAIMED' as const,
                    payload: `${task.id} auto-assigned · ${task.reason}`,
                  })),
                ]
              : current.events,
          };
        }),
      1000,
    );
    const replay = () => {
      setWorkspace(createWorkspaceState());
      setBaseNodes(seedNodes);
      setEdges(initialEdges);
      setSelectedId('orion');
    };
    window.addEventListener('agentmesh:replay', replay);
    return () => {
      clearInterval(timer);
      window.removeEventListener('agentmesh:replay', replay);
    };
  }, [setBaseNodes, setEdges]);

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      fitView({ padding: 0.1, maxZoom: 0.82, duration: 280 }),
    );
    const settled = window.setTimeout(
      () => fitView({ padding: 0.1, maxZoom: 0.82, duration: 420 }),
      260,
    );
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settled);
    };
  }, [activityOpen, fitView, inspectorOpen]);

  const nodes = useMemo<ProductNode[]>(
    () =>
      baseNodes.map((node) =>
        node.type === 'productTasks'
          ? { ...node, data: { tasks: workspace.tasks, onClaim: claim } }
          : node.type === 'approval'
            ? { ...node, data: { request: workspace.approval, onDecision: decide } }
            : node,
      ),
    [baseNodes, workspace.tasks, workspace.approval, claim, decide],
  );
  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        if (edge.id === 'tasks-orion' || edge.id === 'tasks-vega') {
          const agentId = edge.id === 'tasks-orion' ? 'orion' : 'vega';
          const assigned =
            workspace.tasks.find(
              (task) => task.claimedBy === agentId && task.status === 'claimed',
            ) ??
            workspace.tasks.find(
              (task) => task.claimedBy === agentId && task.status === 'auto-assigned',
            );
          return assigned
            ? {
                ...edge,
                label: `${assigned.status === 'claimed' ? 'claimed' : 'auto-assigned'}: ${assigned.id}`,
              }
            : edge;
        }
        if (edge.id === 'vega-approval' && workspace.approval.status !== 'pending') {
          const approved = workspace.approval.status === 'approved';
          return {
            ...edge,
            label: `deploy ${workspace.approval.status}`,
            style: { stroke: approved ? '#42d69a' : '#f06a61', strokeWidth: 1.6 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
              color: approved ? '#42d69a' : '#f06a61',
            },
          };
        }
        return edge;
      }),
    [edges, workspace.approval.status, workspace.tasks],
  );
  const selected = nodes.find((node) => node.id === selectedId);
  const onNodeClick = useCallback<NodeMouseHandler<ProductNode>>((_event, node) => {
    setSelectedId(node.id);
    setInspectorOpen(true);
  }, []);
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) =>
        addEdge(
          { ...connection, ...edgeBase, id: `edge-${Date.now()}`, label: 'dependency' },
          current,
        ),
      ),
    [setEdges],
  );
  const frameWorkspace = useCallback(
    () => fitView({ padding: 0.1, maxZoom: 0.82, duration: 520 }),
    [fitView],
  );
  const arrangeWorkspace = useCallback(() => {
    setBaseNodes((current) =>
      current.map((node) => ({
        ...node,
        position: initialPositions[node.id as keyof typeof initialPositions] ?? node.position,
      })),
    );
    requestAnimationFrame(frameWorkspace);
  }, [frameWorkspace, setBaseNodes]);
  return (
    <div
      className={`product-workspace${inspectorOpen ? ' is-inspector-open' : ''}${activityOpen ? ' is-activity-open' : ''}${navigating ? ' is-navigating' : ''}`}
    >
      <div className="product-canvas">
        <div className="canvas-context">
          <div>
            <span>✳ AGENTMESH / CHECKOUT PROTOCOL</span>
            <b>Live coordination canvas</b>
          </div>
          <div className="canvas-context__tools">
            <div className="canvas-legend" aria-label="Canvas legend">
              <span>
                <i className="is-online" /> online
              </span>
              <span>
                <i className="is-owner" /> owner
              </span>
              <span>
                <i className="is-dependency" /> dependency
              </span>
            </div>
            <span className="canvas-sync">
              <i /> synced · local-first
            </span>
            <button
              type="button"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((open) => !open)}
            >
              {inspectorOpen ? <X size={14} /> : <PanelRightOpen size={14} />}
              Inspector
            </button>
            <button
              type="button"
              aria-pressed={activityOpen}
              onClick={() => setActivityOpen((open) => !open)}
            >
              {activityOpen ? <X size={14} /> : <Activity size={14} />}
              Activity <b>{workspace.events.length}</b>
            </button>
          </div>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDragStart={(_event, node) => setMoving(node.id)}
          onNodeDragStop={() => setMoving(null)}
          onMoveStart={() => setNavigating(true)}
          onMoveEnd={() => setNavigating(false)}
          minZoom={0.35}
          maxZoom={1.4}
          fitView
          fitViewOptions={{ padding: 0.08, maxZoom: 0.82 }}
        >
          <Background color="#9bae9e" gap={28} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap
            className="product-minimap"
            nodeColor={(node) =>
              node.id === 'orion'
                ? '#a78bfa'
                : node.id === 'vega'
                  ? '#42d69a'
                  : node.id === 'approval'
                    ? '#f0b458'
                    : '#69c8d6'
            }
            maskColor="rgb(238 246 230 / 72%)"
            pannable
            zoomable
            position="bottom-right"
          />
          <ViewportPortal>
            {presence.map((session) => {
              const node = nodes.find((item) => item.id === session.agentId);
              const owner = owners.find((item) => item.id === session.humanOwnerId);
              if (!node || !owner) return null;
              const isOrion = node.id === 'orion';
              return (
                <div
                  key={session.id}
                  className={`product-presence product-presence--${owner.color}`}
                  style={{
                    transform: `translate(${node.position.x + (isOrion ? 265 : 40)}px, ${node.position.y - 36}px)`,
                  }}
                >
                  <svg viewBox="0 0 20 24">
                    <path d="M2 2L18 14L10 16L6 22Z" fill="currentColor" />
                  </svg>
                  <span>
                    {moving === node.id
                      ? `${owner.name} is moving ${isOrion ? 'Orion' : 'Vega'}`
                      : owner.name}
                  </span>
                </div>
              );
            })}
          </ViewportPortal>
        </ReactFlow>
        <div className="canvas-command-dock" aria-label="Canvas controls">
          <span className="canvas-command-dock__status">
            <Sparkles size={14} />
            <i /> 2 agents coordinating in this workspace
          </span>
          <button type="button" onClick={arrangeWorkspace}>
            Arrange agents
          </button>
          <button type="button" onClick={frameWorkspace} aria-label="Fit workspace to view">
            <LocateFixed size={15} />
            Fit view
          </button>
        </div>
        <div className="canvas-navigation-hint">DRAG TO PAN · SCROLL TO ZOOM</div>
      </div>
      {inspectorOpen && (
        <Inspector
          selected={selected}
          tasks={workspace.tasks}
          events={workspace.events}
          onClose={() => setInspectorOpen(false)}
        />
      )}
      {activityOpen && (
        <ActivityRail events={workspace.events} onClose={() => setActivityOpen(false)} />
      )}
    </div>
  );
}

export function WorkspaceCanvas() {
  return (
    <div className="workspace-canvas">
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </div>
  );
}
