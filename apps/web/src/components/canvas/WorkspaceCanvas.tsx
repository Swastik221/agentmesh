import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from 'react';
import { LocateFixed } from 'lucide-react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import '../../features/workspace/workspace.css';
import '../../features/workspace/workspace-spatial.css';
import '../../features/workspace/autumn-workspace.css';
import '../../features/workspace/chrome.css';

import { workspaceNodeTypes } from './nodes';
import { toCanvasAgent } from './nodes/AgentNode';
import { toBoardTask } from './nodes/TaskBoardNode';
import type { OfferCandidate } from '../../adapters/live/task.adapter';
import { ProtocolEdge } from './ProtocolEdge';
import { ToolDock, type DockToolType } from './ToolDock';
import { MultiplayerCursors } from './MultiplayerCursors';

import { currentProjectId } from '../../utils/currentProjectId';
import { authSessionService } from '../../services/auth-session';
import { useAgents } from '../../hooks/useAgents';
import { useTasks } from '../../hooks/useTasks';
import { useWorkspaceRealtime, type RealtimeFrame } from '../../hooks/useWorkspaceRealtime';
import { listTerminalSessions, type LiveTerminalSession } from '../../adapters/live/terminal.adapter';
import { CoordinationMessageType } from '@agentmesh/agent-protocol';

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

type Positions = Record<string, { x: number; y: number }>;
interface LocalNote {
  id: string;
  text: string;
  position: { x: number; y: number };
}

/** Per-viewer layout: where you dragged things, and your private notes. Device-local by design. */
const layoutKey = (projectId: string | null) => `agentmesh:canvas-layout:${projectId ?? 'none'}`;
function loadLayout(projectId: string | null): { positions: Positions; notes: LocalNote[] } {
  try {
    const raw = localStorage.getItem(layoutKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw) as { positions?: Positions; notes?: LocalNote[] };
      return { positions: parsed.positions ?? {}, notes: parsed.notes ?? [] };
    }
  } catch {
    // Storage blocked or corrupt: fall back to the default layout.
  }
  return { positions: {}, notes: [] };
}
function saveLayout(projectId: string | null, layout: { positions: Positions; notes: LocalNote[] }): void {
  try {
    localStorage.setItem(layoutKey(projectId), JSON.stringify(layout));
  } catch {
    // Best effort.
  }
}

const ACTIVE_TASK = new Set(['TODO', 'IN_PROGRESS', 'PENDING_APPROVAL', 'BLOCKED']);

function WorkspaceCanvasInner() {
  const projectId = currentProjectId();
  const { agents: liveAgents, refetch: refetchAgents } = useAgents(projectId);
  const {
    tasks: liveTasks,
    refetch: refetchTasks,
    createOffer,
    claimOffer,
    listOfferCandidates,
  } = useTasks(projectId);

  // Who could take an offer right now. Refreshed whenever agents or tasks
  // change, so the board's free/busy badges track the real roster.
  const [candidates, setCandidates] = useState<OfferCandidate[]>([]);

  // Open offers count down to an auto assignment that happens server-side.
  // This tick only redraws the remaining seconds; it never decides anything.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const hasOpenOffer = liveTasks.some(
      (task) => task.offerExpiresAt && !(task.responsibilities?.length),
    );
    if (!hasOpenOffer) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [liveTasks]);

  const refetchAgentsRef = useRef(refetchAgents);
  refetchAgentsRef.current = refetchAgents;
  const refetchTasksRef = useRef(refetchTasks);
  refetchTasksRef.current = refetchTasks;

  // Rolling per-agent terminal lines, fed by real `agent.log` activity deltas
  // (see activity.service.ts / websocket.server.ts). The rolling window here
  // is local-only and resets on reload; the lines themselves are genuinely
  // persisted (ActivityEvent.payload.message), so a fresh GET on
  // /projects/:id/activity still has them even after this resets.
  const [agentLogs, setAgentLogs] = useState<Record<string, string[]>>({});
  const MAX_AGENT_LOG_LINES = 20;

  // Connected terminals you may see (yours + shared), kept live by
  // terminal.session.changed frames on the shared workspace socket.
  const [terminals, setTerminals] = useState<LiveTerminalSession[]>([]);
  const viewerId = authSessionService.getCurrentUser()?.id ?? null;
  const loadTerminals = useCallback(async () => {
    if (!projectId) return;
    try {
      setTerminals(await listTerminalSessions(projectId));
    } catch {
      // The node shows the last known list; the Terminals view surfaces errors.
    }
  }, [projectId]);
  useEffect(() => {
    void loadTerminals();
  }, [loadTerminals]);
  const loadTerminalsRef = useRef(loadTerminals);
  loadTerminalsRef.current = loadTerminals;

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
          if (event.entity === 'activity' && event.fields?.type === 'agent.log') {
            const actorId = event.fields.actorId as string | undefined;
            const message = event.fields.message as string | undefined;
            if (actorId && message) {
              setAgentLogs((prev) => ({
                ...prev,
                [actorId]: [...(prev[actorId] ?? []), message].slice(-MAX_AGENT_LOG_LINES),
              }));
            }
          }
        },
        onResync: () => {
          void refetchAgentsRef.current();
          void refetchTasksRef.current();
          void loadTerminalsRef.current();
        },
        onMessage: (frame: RealtimeFrame) => {
          if (frame.type !== CoordinationMessageType.TERMINAL_SESSION_CHANGED) return;
          const session = (frame.payload as { session: LiveTerminalSession }).session;
          setTerminals((prev) => {
            const visible = session.status !== 'CLOSED' && (session.visibility === 'SHARED' || session.owner.userId === viewerId);
            const rest = prev.filter((t) => t.terminalId !== session.terminalId);
            return visible ? [session, ...rest] : rest;
          });
        },
      }),
      [viewerId],
    ),
  );

  useEffect(() => {
    let cancelled = false;
    void listOfferCandidates()
      .then((rows) => {
        if (!cancelled) setCandidates(rows);
      })
      // A candidates lookup that fails leaves the board's free/busy badges
      // stale rather than breaking the canvas; posting and claiming still work.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [listOfferCandidates, liveAgents, liveTasks]);

  // Resolved synchronously from the session the route guard already fetched;
  // used only to label and colour agents the signed-in user owns.
  const viewerUserId = authSessionService.getCurrentUser()?.id ?? null;

  const initialNodes = useMemo<Node[]>(() => {
    const onlineAgents = liveAgents.filter(
      (a) => a.status === 'ONLINE' || a.status === 'BUSY',
    ).length;
    const coordinatorNode: Node = {
      id: 'coordinator',
      type: 'coordinator',
      position: { x: 420, y: 30 },
      data: {
        // Real, live summary rather than a canned string.
        activity: `${onlineAgents} agent${onlineAgents === 1 ? '' : 's'} online · ${liveTasks.length} task${liveTasks.length === 1 ? '' : 's'}`,
      },
    };

    const tasksNode: Node = {
      id: 'tasks',
      type: 'productTasks',
      position: { x: 370, y: 180 },
      data: {
        tasks: liveTasks.map((task) => toBoardTask(task, now, liveTasks)),
        candidates,
        onCreateOffer: async (title: string, offerSeconds: number) => {
          await createOffer({ title, offerSeconds });
        },
        onClaimFor: async (taskId: string, agentId: string) => {
          await claimOffer(taskId, agentId);
        },
      },
    };

    const agentNodes: Node[] = liveAgents.map((agent, index) => ({
      id: agent.id,
      type: 'productAgent',
      position: { x: 30 + index * 320, y: 380 },
      data: {
        agent: { ...toCanvasAgent(agent, viewerUserId), logs: agentLogs[agent.id] ?? [] },
      },
    }));

    const terminalsNode: Node = {
      id: 'terminals',
      type: 'terminals',
      position: { x: 900, y: 180 },
      data: {
        sessions: terminals,
        viewerUserId,
        onOpen: () => window.dispatchEvent(new CustomEvent('agentmesh:open-section', { detail: 'terminals' })),
      },
    };

    return [coordinatorNode, tasksNode, terminalsNode, ...agentNodes];
  }, [liveAgents, liveTasks, createOffer, claimOffer, candidates, now, viewerUserId, agentLogs, terminals]);

  // Edges are drawn only for relationships that exist in the data: an agent
  // is linked to the board when it actually holds active work there.
  const initialEdges = useMemo<Edge[]>(() => {
    const held = new Map<string, number>();
    for (const task of liveTasks) {
      if (!ACTIVE_TASK.has(task.status)) continue;
      for (const r of task.responsibilities ?? []) held.set(r.agentId, (held.get(r.agentId) ?? 0) + 1);
    }
    return liveAgents
      .filter((agent) => held.has(agent.id))
      .map((agent) => ({
        ...edgeBase,
        id: `tasks-${agent.id}`,
        source: 'tasks',
        target: agent.id,
        label: `${held.get(agent.id)} active task${held.get(agent.id) === 1 ? '' : 's'}`,
        style: { stroke: '#2F7D5C', strokeWidth: 1.8 },
        data: { protocolType: 'TASK_ASSIGNED' },
      }));
  }, [liveAgents, liveTasks]);

  const layoutRef = useRef(loadLayout(projectId));
  useEffect(() => {
    layoutRef.current = loadLayout(projectId);
  }, [projectId]);

  const noteNode = useCallback(
    (note: LocalNote): Node => ({
      id: note.id,
      type: 'note',
      position: note.position,
      data: {
        text: note.text,
        onEdit: (text: string) => {
          const layout = layoutRef.current;
          layout.notes = layout.notes.map((n) => (n.id === note.id ? { ...n, text } : n));
          saveLayout(projectId, layout);
        },
      },
    }),
    [projectId],
  );

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  // Merge fresh data into the existing nodes instead of replacing them: keep
  // where the viewer dragged things (and their selection), keep their notes.
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      const saved = layoutRef.current.positions;
      const dataNodes = initialNodes.map((n) => {
        const existing = byId.get(n.id);
        return {
          ...n,
          position: existing?.position ?? saved[n.id] ?? n.position,
          selected: existing?.selected,
        };
      });
      const notes = layoutRef.current.notes.map((note) => {
        const existing = byId.get(note.id);
        return existing ? { ...noteNode(note), position: existing.position, selected: existing.selected } : noteNode(note);
      });
      return [...dataNodes, ...notes];
    });
  }, [initialNodes, setNodes, noteNode]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChangeBase(changes);
      let dirty = false;
      const layout = layoutRef.current;
      for (const change of changes) {
        if (change.type === 'position' && change.position && change.dragging === false) {
          if (layout.notes.some((n) => n.id === change.id)) {
            layout.notes = layout.notes.map((n) => (n.id === change.id ? { ...n, position: change.position! } : n));
          } else {
            layout.positions[change.id] = change.position;
          }
          dirty = true;
        } else if (change.type === 'remove' && layout.notes.some((n) => n.id === change.id)) {
          layout.notes = layout.notes.filter((n) => n.id !== change.id);
          dirty = true;
        }
      }
      if (dirty) saveLayout(projectId, layout);
    },
    [onNodesChangeBase, projectId],
  );

  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;

  const { fitView } = useReactFlow();

  const handleToolAdd = useCallback(
    (toolType: DockToolType) => {
      if (toolType !== 'note') return;
      const note: LocalNote = { id: `note-${Date.now()}`, text: '', position: { x: 300, y: 300 } };
      const layout = layoutRef.current;
      layout.notes = [...layout.notes, note];
      saveLayout(projectId, layout);
      setNodes((nds) => [...nds, noteNode(note)]);
    },
    [projectId, setNodes, noteNode],
  );

  // The sidebar's Notes item asks for a note.
  useEffect(() => {
    const add = () => handleToolAdd('note');
    window.addEventListener('agentmesh:add-note', add);
    return () => window.removeEventListener('agentmesh:add-note', add);
  }, [handleToolAdd]);

  return (
    <div className="workspace-canvas-container">
      <div className="workspace-canvas">
        <div className="canvas-header-bar">
          <div className="canvas-header-bar__meta">
            <span className="canvas-header-bar__badge">REALTIME PROTOCOL</span>
            <h2>{projectId ? `Project Canvas (${projectId.slice(0, 8)}…)` : 'Project Canvas'}</h2>
          </div>
          {/* Inspector, Activity and Focus used to sit here. Inspector and
              Activity toggled state that nothing rendered, and Focus only
              added a CSS class, so all three were controls that appeared to do
              something and did not. Reset view is kept because it really does
              recentre the graph. */}
          <div className="canvas-header-bar__actions">
            <button type="button" title="Center graph" onClick={() => fitView({ duration: 400 })}>
              <LocateFixed size={13} />
              Reset view
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
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.3 }}
        >
          <Background color="var(--mesh-border-subtle)" gap={24} size={1} />
          <Controls showInteractive={false} />
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
          <MultiplayerCursors />
        </ReactFlow>

        <ToolDock onAddTool={handleToolAdd} />
      </div>
    </div>
  );
}

export function WorkspaceCanvas() {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvasInner />
    </ReactFlowProvider>
  );
}
