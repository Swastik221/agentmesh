import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from 'react';
import {
  Activity,
  LocateFixed,
  Maximize2,
  Minimize2,
  PanelRightOpen,
  X,
} from 'lucide-react';
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  ConnectionMode,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import '../../features/workspace/workspace.css';
import '../../features/workspace/workspace-spatial.css';
import '../../features/workspace/autumn-workspace.css';
import '../../features/workspace/chrome.css';

import { workspaceNodeTypes } from './nodes';
import { ProtocolEdge } from './ProtocolEdge';
import { ToolDock, type DockToolType } from './ToolDock';
import { CommandComposer } from './CommandComposer';
import { MultiplayerCursors } from './MultiplayerCursors';

import { currentProjectId } from '../../utils/currentProjectId';
import { useAgents } from '../../hooks/useAgents';
import { useTasks } from '../../hooks/useTasks';
import { useWorkspaceRealtime } from '../../hooks/useWorkspaceRealtime';

const edgeTypes = {
  protocol: ProtocolEdge,
};

const edgeBase = {
  type: 'protocol' as const,
  animated: true,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 14,
    height: 14,
    color: '#177E89',
  },
  style: { stroke: '#177E89', strokeWidth: 1.8 },
};

interface WorkspaceCanvasInnerProps {
  focusView: boolean;
  onFocusViewChange: (focused: boolean) => void;
}

function WorkspaceCanvasInner({ focusView, onFocusViewChange }: WorkspaceCanvasInnerProps) {
  const projectId = currentProjectId();
  const { agents: liveAgents, refetch: refetchAgents } = useAgents(projectId);
  const { tasks: liveTasks, refetch: refetchTasks, claimTask } = useTasks(projectId);

  const refetchAgentsRef = useRef(refetchAgents);
  refetchAgentsRef.current = refetchAgents;
  const refetchTasksRef = useRef(refetchTasks);
  refetchTasksRef.current = refetchTasks;

  useWorkspaceRealtime(
    projectId,
    useMemo(
      () => ({
        onDelta: (event) => {
          if (event.entity === 'agent' || event.entity === 'presence') {
            void refetchAgentsRef.current();
          } else if (event.entity === 'task' || event.entity === 'taskResponsibility') {
            void refetchTasksRef.current();
          }
        },
        onResync: () => {
          void refetchAgentsRef.current();
          void refetchTasksRef.current();
        },
      }),
      [],
    ),
  );

  const initialNodes = useMemo<Node[]>(() => {
    const coordinatorNode: Node = {
      id: 'coordinator',
      type: 'coordinator',
      position: { x: 420, y: 30 },
      data: {
        activity: 'coordinating real project work',
      },
    };

    const tasksNode: Node = {
      id: 'tasks',
      type: 'productTasks',
      position: { x: 370, y: 180 },
      data: {
        tasks: liveTasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status === 'COMPLETED' ? 'claimed' : 'proposed',
          claimedBy: t.preferredAgentId ?? undefined,
        })),
        onClaimTask: (id: string) => {
          if (liveAgents.length > 0) {
            void claimTask(id, liveAgents[0].id);
          }
        },
      },
    };

    const agentNodes: Node[] = liveAgents.map((agent, index) => ({
      id: agent.id,
      type: 'productAgent',
      position: { x: 30 + index * 320, y: 380 },
      data: {
        agent: {
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          ens: agent.ensName ?? 'unlinked.eth',
          capabilities: (agent.capabilities ?? []).map((c) => c.capability),
        },
      },
    }));

    return [coordinatorNode, tasksNode, ...agentNodes];
  }, [liveAgents, liveTasks, claimTask]);

  const initialEdges = useMemo<Edge[]>(() => {
    const edges: Edge[] = [
      {
        ...edgeBase,
        id: 'coordinator-tasks',
        source: 'coordinator',
        target: 'tasks',
        label: 'TASK_PROPOSAL',
        data: { protocolType: 'TASK_PROPOSAL' },
      },
    ];

    liveAgents.forEach((agent) => {
      edges.push({
        ...edgeBase,
        id: `tasks-${agent.id}`,
        source: 'tasks',
        target: agent.id,
        label: 'TASK_ASSIGNED',
        style: { stroke: '#2F7D5C', strokeWidth: 1.8 },
        data: { protocolType: 'TASK_CLAIMED' },
      });
    });

    return edges;
  }, [liveAgents]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const { fitView } = useReactFlow();

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, ...edgeBase }, eds));
    },
    [setEdges],
  );

  const handleToolAdd = useCallback(
    (toolType: DockToolType) => {
      const id = `${toolType}-${Date.now()}`;
      const title =
        toolType === 'note'
          ? 'Project Note'
          : toolType === 'file'
            ? 'Project File'
            : toolType === 'browser'
              ? 'Browser Preview'
              : 'Terminal Node';
      const text =
        toolType === 'note'
          ? 'Add your project notes here...'
          : toolType === 'file'
            ? '// Workspace file'
            : toolType === 'browser'
              ? 'https://localhost:3001'
              : '$ agentmesh status';

      const newNode: Node = {
        id,
        type: 'utility',
        position: { x: 300, y: 300 },
        data: {
          kind: toolType,
          title,
          text,
          onEdit: (updatedText: string) => {
            setNodes((nds) =>
              nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, text: updatedText } } : n)),
            );
          },
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
  );

  return (
    <div className={`workspace-canvas-container${focusView ? ' is-focus-view' : ''}`}>
      <div className="workspace-canvas">
        <div className="canvas-header-bar">
          <div className="canvas-header-bar__meta">
            <span className="canvas-header-bar__badge">REALTIME PROTOCOL</span>
            <h2>{projectId ? `Project Canvas (${projectId.slice(0, 8)}…)` : 'Project Canvas'}</h2>
          </div>
          <div className="canvas-header-bar__actions">
            <button
              type="button"
              title={focusView ? 'Exit focus view' : 'Focus canvas'}
              onClick={() => onFocusViewChange(!focusView)}
            >
              {focusView ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              {focusView ? 'Exit focus' : 'Focus'}
            </button>
            <button type="button" title="Center graph" onClick={() => fitView({ duration: 400 })}>
              <LocateFixed size={13} />
              Reset view
            </button>
            <button
              type="button"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen(!inspectorOpen)}
            >
              {inspectorOpen ? <X size={13} /> : <PanelRightOpen size={13} />}
              Inspector
            </button>
            <button
              type="button"
              aria-pressed={activityOpen}
              onClick={() => setActivityOpen(!activityOpen)}
            >
              {activityOpen ? <X size={13} /> : <Activity size={13} />}
              Activity <b>{liveTasks.length}</b>
            </button>
          </div>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={workspaceNodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          fitView
        >
          <Background color="var(--mesh-border-subtle)" gap={24} size={1} />
          <Controls showInteractive={false} />
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
          <MultiplayerCursors />
        </ReactFlow>

        <ToolDock onAddTool={handleToolAdd} />
        <CommandComposer
          onAddTool={handleToolAdd}
          onRunNaturalCommand={(cmd) => `Executed command: ${cmd}`}
        />
      </div>
    </div>
  );
}

export function WorkspaceCanvas(props: WorkspaceCanvasInnerProps) {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
