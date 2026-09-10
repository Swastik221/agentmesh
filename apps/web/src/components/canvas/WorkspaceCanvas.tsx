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
  type NodeMouseHandler,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import '../../features/workspace/workspace.css';
import '../../features/workspace/workspace-spatial.css';
import '../../features/workspace/autumn-workspace.css';
import '../../features/workspace/chrome.css';

import { PixelSceneryBackground } from './PixelSceneryBackground';
import { workspaceNodeTypes } from './nodes';
import { ProtocolEdge } from './ProtocolEdge';
import { ToolDock, type DockToolType } from './ToolDock';
import { CommandComposer } from './CommandComposer';
import { MultiplayerCursors } from './MultiplayerCursors';
import { DemoReplayController, REPLAY_STEPS } from './DemoReplayController';

import {
  adapters,
  INITIAL_DEMO_AGENTS,
  INITIAL_DEMO_TASKS,
  INITIAL_DEMO_APPROVAL,
  DEMO_ARTIFACTS,
} from '../../adapters';
import { useDemo } from '../../demo/DemoProvider';
import { PREPARED_PRD } from '../../demo/demo.fixtures';

const edgeTypes = {
  protocol: ProtocolEdge,
};

const initialPositions = {
  coordinator: { x: 420, y: 30 },
  orion: { x: 30, y: 190 },
  tasks: { x: 370, y: 180 },
  vega: { x: 790, y: 190 },
  artifact: { x: 640, y: 560 },
  approval: { x: 100, y: 560 },
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

const initialEdges: Edge[] = [
  {
    ...edgeBase,
    id: 'coordinator-tasks',
    source: 'coordinator',
    target: 'tasks',
    label: 'TASK_PROPOSAL',
    data: { protocolType: 'TASK_PROPOSAL' },
  },
  {
    ...edgeBase,
    id: 'tasks-orion',
    source: 'tasks',
    target: 'orion',
    label: 'TASK_CLAIMED: AM-114',
    style: { stroke: '#2F7D5C', strokeWidth: 1.8 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: '#2F7D5C',
    },
    data: { protocolType: 'TASK_CLAIMED' },
  },
  {
    ...edgeBase,
    id: 'tasks-vega',
    source: 'tasks',
    target: 'vega',
    label: 'TASK_CLAIMED: AM-115',
    style: { stroke: '#2F7D5C', strokeWidth: 1.8 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: '#2F7D5C',
    },
    data: { protocolType: 'TASK_CLAIMED' },
  },
  {
    ...edgeBase,
    id: 'vega-artifact',
    source: 'vega',
    target: 'artifact',
    label: 'ARTIFACT_PUBLISHED',
    data: { protocolType: 'ARTIFACT_PUBLISHED' },
  },
  {
    ...edgeBase,
    id: 'artifact-orion',
    source: 'artifact',
    target: 'orion',
    label: 'payment-api.json',
    style: { stroke: '#8B6FE8', strokeWidth: 1.8 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: '#8B6FE8',
    },
    data: { protocolType: 'DEPENDENCY_REQUEST' },
  },
  {
    ...edgeBase,
    id: 'orion-approval',
    source: 'orion',
    target: 'approval',
    label: 'APPROVAL_REQUIRED: 0.35 ETH',
    style: { stroke: '#D99A32', strokeWidth: 1.8 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: '#D99A32',
    },
    data: { protocolType: 'APPROVAL_REQUIRED' },
  },
];

interface WorkspaceCanvasInnerProps {
  focusView: boolean;
  onFocusViewChange: (focused: boolean) => void;
}

function WorkspaceCanvasInner({ focusView, onFocusViewChange }: WorkspaceCanvasInnerProps) {
  const {
    state: demoState,
    profile,
    claimTask,
    decideApproval,
    submitPrd,
    openBrowser,
  } = useDemo();

  const workspace = demoState.workspace;

  // Build seed nodes using adapter models
  const initialNodes = useMemo<Node[]>(() => {
    return [
      {
        id: 'coordinator',
        type: 'coordinator',
        position: initialPositions.coordinator,
        data: {
          activity: 'splitting PRD into tasks',
          onOpenPrd: () => setPrdOpen(true),
        },
      },
      {
        id: 'orion',
        type: 'productAgent',
        position: initialPositions.orion,
        data: { agent: INITIAL_DEMO_AGENTS[0] },
      },
      {
        id: 'tasks',
        type: 'productTasks',
        position: initialPositions.tasks,
        data: {
          tasks: INITIAL_DEMO_TASKS,
          onClaimTask: (id: string) => claimTask(id),
        },
      },
      {
        id: 'vega',
        type: 'productAgent',
        position: initialPositions.vega,
        data: { agent: INITIAL_DEMO_AGENTS[1] },
      },
      {
        id: 'artifact',
        type: 'artifact',
        position: initialPositions.artifact,
        data: { artifact: DEMO_ARTIFACTS[0] },
      },
      {
        id: 'approval',
        type: 'approval',
        position: initialPositions.approval,
        data: {
          request: INITIAL_DEMO_APPROVAL,
          onDecision: (dec: 'approved' | 'rejected') => decideApproval(dec),
          onOpenModal: () => setApprovalModalOpen(true),
        },
      },
    ];
  }, [claimTask, decideApproval]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  /* Drives the board's connecting affordances: every handle comes up and the
     card under the pointer reads as the drop target. */
  const [connecting, setConnecting] = useState(false);
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;

  const [selectedId, setSelectedId] = useState('orion');
  const [movingNode, setMovingNode] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [prdOpen, setPrdOpen] = useState(false);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);

  // Demo Replay state
  const [replayActive, setReplayActive] = useState(false);
  const [replayStep, setReplayStep] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);

  const { fitView, screenToFlowPosition } = useReactFlow();

  // Keep tasks and approval synced with demo state
  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((n) => {
        if (n.id === 'tasks') {
          return {
            ...n,
            data: {
              ...n.data,
              tasks: workspace.tasks,
              onClaimTask: (id: string) => claimTask(id),
            },
          };
        }
        if (n.id === 'approval') {
          return {
            ...n,
            data: {
              ...n.data,
              request: workspace.approval,
              onDecision: (dec: 'approved' | 'rejected') => decideApproval(dec),
              onOpenModal: () => setApprovalModalOpen(true),
            },
          };
        }
        return n;
      })
    );
  }, [workspace.tasks, workspace.approval, claimTask, decideApproval, setNodes]);

  // Sync edge labels when tasks are claimed or approval granted
  const displayEdges = useMemo(() => {
    return edges.map((edge) => {
      if (edge.id === 'tasks-orion') {
        const am114 = workspace.tasks.find((t) => t.id === 'AM-114');
        if (am114 && am114.status === 'claimed') {
          return {
            ...edge,
            label: 'TASK_CLAIMED: AM-114 (Orion)',
            style: { stroke: 'var(--mesh-primary-green)', strokeWidth: 2 },
          };
        }
      }
      if (edge.id === 'tasks-vega') {
        const am115 = workspace.tasks.find((t) => t.id === 'AM-115');
        if (am115 && am115.status === 'claimed') {
          return {
            ...edge,
            label: 'TASK_CLAIMED: AM-115 (Vega)',
            style: { stroke: 'var(--mesh-primary-green)', strokeWidth: 2 },
          };
        }
      }
      if (edge.id === 'orion-approval') {
        if (workspace.approval.status === 'approved') {
          return {
            ...edge,
            label: 'APPROVAL_GRANTED: dev1.eth',
            style: { stroke: 'var(--mesh-primary-green)', strokeWidth: 2 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
              color: 'var(--mesh-primary-green)',
            },
          };
        } else if (workspace.approval.status === 'rejected') {
          return {
            ...edge,
            label: 'APPROVAL_REJECTED: dev1.eth',
            style: { stroke: 'var(--mesh-error-red)', strokeWidth: 2 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
              color: 'var(--mesh-error-red)',
            },
          };
        }
      }
      return edge;
    });
  }, [edges, workspace.approval.status, workspace.tasks]);

  // Add Tool to canvas (Click or Drag-and-Drop)
  const addTool = useCallback(
    (tool: DockToolType, flowPosition?: { x: number; y: number }) => {
      const position =
        flowPosition ??
        screenToFlowPosition({
          x: window.innerWidth * 0.45 + (Math.random() * 80 - 40),
          y: window.innerHeight * 0.35 + (Math.random() * 80 - 40),
        });

      const newId = `node-${tool}-${Date.now().toString(36)}`;
      let newNode: Node;

      if (tool === 'codex') {
        newNode = {
          id: newId,
          type: 'productAgent',
          position,
          data: { agent: INITIAL_DEMO_AGENTS[0] },
        };
      } else if (tool === 'claude') {
        newNode = {
          id: newId,
          type: 'productAgent',
          position,
          data: { agent: INITIAL_DEMO_AGENTS[1] },
        };
      } else if (tool === 'gemini') {
        newNode = {
          id: newId,
          type: 'productAgent',
          position,
          data: { agent: INITIAL_DEMO_AGENTS[2] },
        };
      } else if (tool === 'coordinator') {
        newNode = {
          id: newId,
          type: 'coordinator',
          position,
          data: {
            activity: 'Splitting PRD into tasks',
            onOpenPrd: () => setPrdOpen(true),
          },
        };
      } else if (tool === 'taskboard') {
        newNode = {
          id: newId,
          type: 'productTasks',
          position,
          data: {
            tasks: workspace.tasks,
            onClaimTask: (id: string) => claimTask(id),
          },
        };
      } else if (tool === 'approval') {
        newNode = {
          id: newId,
          type: 'approval',
          position,
          data: {
            request: workspace.approval,
            onDecision: (dec: 'approved' | 'rejected') => decideApproval(dec),
            onOpenModal: () => setApprovalModalOpen(true),
          },
        };
      } else if (tool === 'artifact') {
        newNode = {
          id: newId,
          type: 'artifact',
          position,
          data: { artifact: DEMO_ARTIFACTS[0] },
        };
      } else if (tool === 'browser') {
        newNode = {
          id: newId,
          type: 'browser',
          position,
          data: { initialUrl: 'agentmesh://preview/checkout' },
        };
      } else if (tool === 'terminal') {
        newNode = {
          id: newId,
          type: 'terminal',
          position,
          data: {
            agentId: 'orion',
            onExecuteCommand: (cmd: string) => {
              if (cmd.includes('claim')) {
                const parts = cmd.split(' ');
                const target = parts[parts.length - 1];
                if (target) claimTask(target.toUpperCase());
              }
              if (cmd.includes('approve')) {
                decideApproval('approved');
              }
            },
          },
        };
      } else if (tool === 'note') {
        newNode = {
          id: newId,
          type: 'note',
          position,
          data: { text: undefined },
        };
      } else {
        // 'file'
        newNode = {
          id: newId,
          type: 'file',
          position,
          data: {},
        };
      }

      setNodes((current) => [...current, newNode]);
      setSelectedId(newId);
    },
    [claimTask, decideApproval, screenToFlowPosition, setNodes, workspace.approval, workspace.tasks]
  );

  // Command composer natural language processing
  const handleRunCommand = useCallback(
    (commandText: string): string => {
      const lower = commandText.toLowerCase().trim();

      if (lower.includes('two') && lower.includes('agent')) {
        addTool('codex', { x: 60, y: 200 });
        addTool('claude', { x: 780, y: 200 });
        if (lower.includes('prd') || lower.includes('task')) {
          submitPrd();
        }
        return 'Two AI coding agents deployed to canvas';
      }

      if (lower.includes('connect')) {
        setEdges(initialEdges);
        return 'Multi-agent protocol edges connected';
      }

      if (lower.includes('prd') || lower.includes('split')) {
        submitPrd();
        return 'Coordinator received PRD and split 4 tasks';
      }

      if (lower.includes('claim')) {
        const match = commandText.match(/am-\d+/i);
        const taskId = match ? match[0].toUpperCase() : 'AM-114';
        claimTask(taskId);
        return `Task ${taskId} claimed by developer`;
      }

      if (lower.includes('approve') || lower.includes('deploy')) {
        decideApproval('approved');
        return 'Human approval granted. Simulated signature accepted';
      }

      const matchTool: DockToolType | undefined = (
        [
          'codex',
          'claude',
          'gemini',
          'terminal',
          'browser',
          'note',
          'file',
          'taskboard',
          'approval',
          'coordinator',
          'artifact',
        ] as DockToolType[]
      ).find((t) => lower.includes(t));

      if (matchTool) {
        addTool(matchTool);
        return `${matchTool} node added to workspace`;
      }

      return 'Command executed · Try "add two agents", "claim AM-114", or "split PRD"';
    },
    [addTool, claimTask, decideApproval, setEdges, submitPrd]
  );

  // Replay Execution Engine (19 Steps)
  const executeReplayStep = useCallback(
    (stepIndex: number) => {
      const step = REPLAY_STEPS[stepIndex];
      if (!step) return;

      if (step.action === 'init') {
        setNodes([]);
        setEdges([]);
      } else if (step.action === 'orion-agent') {
        setNodes((prev) => [
          ...prev.filter((n) => n.id !== 'orion'),
          {
            id: 'orion',
            type: 'productAgent',
            position: initialPositions.orion,
            data: { agent: INITIAL_DEMO_AGENTS[0] },
          },
        ]);
      } else if (step.action === 'vega-agent') {
        setNodes((prev) => [
          ...prev.filter((n) => n.id !== 'vega'),
          {
            id: 'vega',
            type: 'productAgent',
            position: initialPositions.vega,
            data: { agent: INITIAL_DEMO_AGENTS[1] },
          },
        ]);
      } else if (step.action === 'coordinator') {
        setNodes((prev) => [
          ...prev.filter((n) => n.id !== 'coordinator'),
          {
            id: 'coordinator',
            type: 'coordinator',
            position: initialPositions.coordinator,
            data: {
              activity: 'Splitting PRD into tasks',
              onOpenPrd: () => setPrdOpen(true),
            },
          },
        ]);
      } else if (step.action === 'taskboard') {
        setNodes((prev) => [
          ...prev.filter((n) => n.id !== 'tasks'),
          {
            id: 'tasks',
            type: 'productTasks',
            position: initialPositions.tasks,
            data: {
              tasks: INITIAL_DEMO_TASKS,
              onClaimTask: (id: string) => claimTask(id),
            },
          },
        ]);
      } else if (step.action === 'proposals') {
        submitPrd();
        setEdges((prev) => [
          ...prev.filter((e) => e.id !== 'coordinator-tasks'),
          initialEdges[0],
        ]);
      } else if (step.action === 'claim-frontend') {
        claimTask('AM-114');
        setEdges((prev) => [
          ...prev.filter((e) => e.id !== 'tasks-orion'),
          initialEdges[1],
        ]);
      } else if (step.action === 'claim-backend') {
        claimTask('AM-115');
        setEdges((prev) => [
          ...prev.filter((e) => e.id !== 'tasks-vega'),
          initialEdges[2],
        ]);
      } else if (step.action === 'publish-api') {
        setNodes((prev) => [
          ...prev.filter((n) => n.id !== 'artifact'),
          {
            id: 'artifact',
            type: 'artifact',
            position: initialPositions.artifact,
            data: { artifact: DEMO_ARTIFACTS[0] },
          },
        ]);
        setEdges((prev) => [
          ...prev.filter((e) => e.id !== 'vega-artifact'),
          initialEdges[3],
        ]);
      } else if (step.action === 'dependency') {
        setEdges((prev) => [
          ...prev.filter((e) => e.id !== 'artifact-orion'),
          initialEdges[4],
        ]);
      } else if (step.action === 'approval-req') {
        setNodes((prev) => [
          ...prev.filter((n) => n.id !== 'approval'),
          {
            id: 'approval',
            type: 'approval',
            position: initialPositions.approval,
            data: {
              request: INITIAL_DEMO_APPROVAL,
              onDecision: (dec: 'approved' | 'rejected') => decideApproval(dec),
              onOpenModal: () => setApprovalModalOpen(true),
            },
          },
        ]);
        setEdges((prev) => [
          ...prev.filter((e) => e.id !== 'orion-approval'),
          initialEdges[5],
        ]);
        setApprovalModalOpen(true);
      } else if (step.action === 'approved') {
        decideApproval('approved');
        setApprovalModalOpen(false);
      } else if (step.action === 'synced') {
        setNodes(initialNodes);
        setEdges(initialEdges);
      }
    },
    [claimTask, decideApproval, initialNodes, setEdges, setNodes, submitPrd]
  );

  // Step advance timer
  useEffect(() => {
    if (!replayActive || !replayPlaying) return;

    const timer = window.setTimeout(() => {
      if (replayStep < REPLAY_STEPS.length - 1) {
        const nextStep = replayStep + 1;
        setReplayStep(nextStep);
        executeReplayStep(nextStep);
      } else {
        setReplayPlaying(false);
      }
    }, 1600);

    return () => clearTimeout(timer);
  }, [executeReplayStep, replayActive, replayPlaying, replayStep]);

  // Listen to TopBar "agentmesh:replay" event
  useEffect(() => {
    const handleReplayEvent = () => {
      setReplayActive(true);
      setReplayStep(0);
      setReplayPlaying(true);
      executeReplayStep(0);
    };
    window.addEventListener('agentmesh:replay', handleReplayEvent);
    return () => window.removeEventListener('agentmesh:replay', handleReplayEvent);
  }, [executeReplayStep]);

  // Auto-fit view when canvas mounts
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.12, maxZoom: 0.95, duration: 400 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView]);

  // Node selection handler
  const onNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    setSelectedId(node.id);
    if (node.id === 'artifact') {
      openBrowser('agentmesh://artifact/payment-api');
    }
    if (node.id === 'approval' && workspace.approval.status === 'pending') {
      setApprovalModalOpen(true);
    }
  }, [openBrowser, workspace.approval.status]);

  /* A link between two agents is a dependency; anything else is context being
     attached to whatever it was dropped on. */
  const linkLabel = useCallback(
    (source: string | null, target: string | null) => {
      const kind = (id: string | null) => nodesRef.current.find((node) => node.id === id)?.type;
      return kind(source) === 'productAgent' && kind(target) === 'productAgent'
        ? 'DEPENDENCY_REQUEST'
        : 'CONTEXT_LINK';
    },
    []
  );

  const linkNodes = useCallback(
    (connection: Connection) =>
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            ...edgeBase,
            id: `edge-${Date.now()}`,
            label: linkLabel(connection.source, connection.target),
            data: { protocolType: 'DEPENDENCY_REQUEST' },
          },
          current
        )
      ),
    [setEdges, linkLabel]
  );

  const onConnect = useCallback((connection: Connection) => linkNodes(connection), [linkNodes]);

  /**
   * Dropping the arrow anywhere on a node connects to it.
   *
   * React Flow only completes a connection when the pointer is released on a
   * handle, which means aiming at a 9px dot. Handles have a wide invisible hit
   * area and the connection radius snaps near misses, but a release over the
   * middle of a card would still be thrown away. This finishes those: if the
   * drag ended over some other node and React Flow did not already make the
   * edge, link the two directly.
   */
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      setConnecting(false);
      if (connectionState.isValid) return;
      const from = connectionState.fromNode?.id;
      if (!from) return;
      /* React Flow reports a target node only when the release lands on a
         handle, and not having to hit the handle is the whole point, so the
         card under the pointer is looked up directly. */
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const landed = document
        .elementFromPoint(point.clientX, point.clientY)
        ?.closest('.react-flow__node');
      const to = landed instanceof HTMLElement ? landed.dataset.id : undefined;
      if (!to || to === from) return;
      if (edgesRef.current.some((edge) => edge.source === from && edge.target === to)) return;
      linkNodes({ source: from, target: to, sourceHandle: null, targetHandle: null });
    },
    [linkNodes]
  );

  const arrangeAgents = useCallback(() => {
    setNodes((current) =>
      current.map((n) => ({
        ...n,
        position:
          initialPositions[n.id as keyof typeof initialPositions] ?? n.position,
      }))
    );
    fitView({ padding: 0.12, duration: 400 });
  }, [fitView, setNodes]);

  const selectedNode = nodes.find((n) => n.id === selectedId);

  return (
    <div
      className={`product-workspace ${inspectorOpen ? 'is-inspector-open' : ''} ${
        activityOpen ? 'is-activity-open' : ''
      }`}
    >
      <div className={`product-canvas${connecting ? ' is-connecting' : ''}`}>
        {/* Context bar inside canvas */}
        <div className="canvas-context">
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mesh-primary-green)' }}>
              ✳ AGENTMESH MULTIPLAYER CANVAS
            </span>
            <b style={{ marginLeft: 6, fontSize: 12 }}>
              {workspace.tasks.length} tasks · {nodes.length} nodes active
            </b>
          </div>

          <div className="canvas-context__tools">
            <button
              type="button"
              aria-pressed={focusView}
              onClick={() => onFocusViewChange(!focusView)}
            >
              {focusView ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              {focusView ? 'Exit focus' : 'Focus'}
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
              Activity <b>{workspace.events.length}</b>
            </button>
          </div>
        </div>

        {/* Scenic Pixel Background with Mt. Fuji & Falling Leaves */}
        <PixelSceneryBackground />

        {/* 19-Step Replay Controller Bar */}
        {replayActive && (
          <DemoReplayController
            activeStep={replayStep}
            isPlaying={replayPlaying}
            onPlay={() => setReplayPlaying(true)}
            onPause={() => setReplayPlaying(false)}
            onNext={() => {
              if (replayStep < REPLAY_STEPS.length - 1) {
                const next = replayStep + 1;
                setReplayStep(next);
                executeReplayStep(next);
              }
            }}
            onRestart={() => {
              setReplayStep(0);
              setReplayPlaying(true);
              executeReplayStep(0);
            }}
            onClose={() => {
              setReplayActive(false);
              setReplayPlaying(false);
              setNodes(initialNodes);
              setEdges(initialEdges);
            }}
          />
        )}

        {/* ReactFlow Canvas */}
        <ReactFlow
          nodes={nodes}
          edges={displayEdges}
          nodeTypes={workspaceNodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          /* Loose mode lets any handle both start and receive a link, so an
             agent can be joined to a note, a browser or a board in either
             direction rather than only source-to-target. The wider radius
             means the drop does not have to land exactly on the dot. */
          connectionMode={ConnectionMode.Loose}
          /* Generous enough that releasing near a card's edge snaps to its
             nearest handle rather than doing nothing. */
          connectionRadius={60}
          onConnectStart={() => setConnecting(true)}
          onConnectEnd={onConnectEnd}
          connectionLineStyle={{ stroke: '#177E89', strokeWidth: 2 }}
          onNodeClick={onNodeClick}
          onNodeDragStart={(_e, node) => setMovingNode(node.id)}
          onNodeDragStop={(_e, node) => {
            setMovingNode(null);
            adapters.workspaceRealtime.publishNodeMovement(
              'checkout-demo',
              node.id,
              node.position,
              profile.name
            );
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const tool = e.dataTransfer.getData('application/agentmesh-tool') as DockToolType;
            if (tool) {
              const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
              addTool(tool, flowPos);
            }
          }}
          minZoom={0.3}
          maxZoom={1.5}
          fitView
          fitViewOptions={{ padding: 0.1, maxZoom: 0.95 }}
        >
          <Background color="var(--mesh-border-strong)" gap={28} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap
            className="product-minimap"
            nodeColor={(node) =>
              node.id === 'orion'
                ? 'var(--mesh-owner-anand)'
                : node.id === 'vega'
                  ? 'var(--mesh-owner-swastik)'
                  : node.id === 'coordinator'
                    ? 'var(--mesh-coordinator-lime)'
                    : node.id === 'approval'
                      ? 'var(--mesh-approval-amber)'
                      : 'var(--mesh-border-strong)'
            }
            maskColor="rgba(246, 244, 236, 0.7)"
            pannable
            zoomable
            position="bottom-right"
          />

          {/* Multiplayer Collaborator Cursors */}
          <MultiplayerCursors
            currentUserId={profile.id}
            isReplayActive={replayActive}
          />
        </ReactFlow>

        {/* Moving status indicator */}
        {movingNode && (
          <div
            style={{
              position: 'absolute',
              bottom: 120,
              left: 20,
              zIndex: 10,
              backgroundColor: 'var(--mesh-bg-card)',
              border: '1px solid var(--mesh-primary-green)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              color: 'var(--mesh-primary-green)',
              boxShadow: 'var(--mesh-shadow-node)',
            }}
          >
            Moving {movingNode}…
          </div>
        )}

        {/* Bottom Floating Command Composer & Tool Dock */}
        <div className="mesh-canvas-controls">
          <CommandComposer
            onAddTool={(tool) => addTool(tool)}
            onRunNaturalCommand={handleRunCommand}
          />
          <ToolDock onAddTool={(tool, pos) => addTool(tool, pos)} />
        </div>

        {/* Canvas floating quick-actions */}
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: 24,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {/* Styled in chrome.css with the rest of the bottom controls, so the
              whole lower edge reads as one dark system. */}
          <button type="button" className="chrome-canvas-btn" onClick={arrangeAgents}>
            Arrange agents
          </button>
          <button
            type="button"
            className="chrome-canvas-btn"
            onClick={() => fitView({ padding: 0.12, duration: 400 })}
          >
            <LocateFixed size={12} />
            Fit view
          </button>
        </div>

        {/* PRD Input Modal */}
        {prdOpen && (
          <div
            className="workspace-modal-backdrop"
            role="presentation"
            onMouseDown={() => setPrdOpen(false)}
          >
            <section
              className="workspace-modal"
              role="dialog"
              aria-modal="true"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header>
                <div>
                  <span>COORDINATOR PRD INPUT</span>
                  <h2>Submit Product Requirement</h2>
                </div>
                <button
                  type="button"
                  aria-label="Close PRD dialog"
                  onClick={() => setPrdOpen(false)}
                >
                  <X size={15} />
                </button>
              </header>
              <p>
                The Mesh Coordinator will parse the PRD, identify required skills (frontend,
                backend, security, contract), and propose structured tasks with auto-assign timers.
              </p>
              <textarea
                id="demo-prd"
                defaultValue={PREPARED_PRD}
                style={{
                  width: '100%',
                  minHeight: 110,
                  padding: 10,
                  borderRadius: 6,
                  border: '1px solid var(--mesh-border-strong)',
                  fontFamily: 'var(--mesh-font-sans)',
                  fontSize: 12,
                }}
              />
              <footer>
                <button type="button" onClick={() => setPrdOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => {
                    submitPrd();
                    setPrdOpen(false);
                  }}
                >
                  Generate 4 tasks
                </button>
              </footer>
            </section>
          </div>
        )}

        {/* Human Web3 Approval Gate Modal */}
        {approvalModalOpen && (
          <div className="workspace-modal-backdrop" role="presentation">
            <section
              className="workspace-modal workspace-approval-dialog"
              role="dialog"
              aria-modal="true"
            >
              <header>
                <div>
                  <span>HUMAN APPROVAL REQUIRED</span>
                  <h2>Deploy Checkout Contract</h2>
                </div>
              </header>
              <dl>
                <div>
                  <dt>Requested by</dt>
                  <dd>Orion / Codex (codex.dev1.eth)</dd>
                </div>
                <div>
                  <dt>Human owner</dt>
                  <dd>Anand / dev1.eth</dd>
                </div>
                <div>
                  <dt>Spend threshold</dt>
                  <dd>0.35 ETH</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>contracts/CheckoutEscrow.sol</dd>
                </div>
              </dl>
              <p>
                High-risk action: Deploying modifies public on-chain escrow state. The AI agent can
                propose changes, but only the human wallet owner holds signing authority.
              </p>
              <footer>
                <button
                  type="button"
                  className="is-reject"
                  onClick={() => {
                    decideApproval('rejected');
                    setApprovalModalOpen(false);
                  }}
                >
                  Reject deployment
                </button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => {
                    decideApproval('approved');
                    setApprovalModalOpen(false);
                  }}
                >
                  Sign & Approve (0.35 ETH)
                </button>
              </footer>
            </section>
          </div>
        )}
      </div>

      {/* Inspector Panel */}
      {inspectorOpen && (
        <aside className="workspace-inspector-panel">
          <header>
            <div>
              <span>INSPECTOR</span>
              <b>Selected node</b>
            </div>
            <button
              type="button"
              className="workspace-panel__close"
              onClick={() => setInspectorOpen(false)}
            >
              <X size={14} />
            </button>
          </header>
          <section>
            <small>{selectedNode?.type ?? 'node'}</small>
            <h2>{selectedNode?.id}</h2>
            <dl>
              <div>
                <dt>Workspace</dt>
                <dd>Checkout protocol</dd>
              </div>
              <div>
                <dt>Human Owner</dt>
                <dd>{profile.name} ({profile.ens})</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd style={{ color: 'var(--mesh-primary-green)', fontWeight: 600 }}>Active</dd>
              </div>
            </dl>
          </section>
        </aside>
      )}

      {/* Activity Feed Side Rail */}
      {activityOpen && (
        <section className="protocol-rail">
          <header>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={14} color="var(--mesh-flow-cyan)" />
              <b>LIVE PROTOCOL ACTIVITY</b>
            </div>
            <button
              type="button"
              className="workspace-panel__close"
              onClick={() => setActivityOpen(false)}
            >
              <X size={14} />
            </button>
          </header>
          <div className="protocol-events nowheel">
            {workspace.events.slice(-12).map((event) => (
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
      )}
    </div>
  );
}

export function WorkspaceCanvas({
  focusView,
  onFocusViewChange,
}: WorkspaceCanvasInnerProps) {
  return (
    <div className="workspace-canvas">
      <ReactFlowProvider>
        <WorkspaceCanvasInner
          focusView={focusView}
          onFocusViewChange={onFocusViewChange}
        />
      </ReactFlowProvider>
    </div>
  );
}
