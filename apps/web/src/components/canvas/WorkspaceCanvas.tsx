import { useCallback, useMemo } from 'react';
import {
  addEdge,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { AgentNode } from './AgentNode';
import { CanvasBackground } from './CanvasBackground';
import { TaskBoardNode } from './TaskBoardNode';
import { edgeDefaults, initialEdges, initialNodes } from '../../data/workspace';
import type { WorkspaceNode } from '../../types';

/** Defined once at module scope — React Flow warns if this identity changes. */
const nodeTypes = {
  agent: AgentNode,
  taskBoard: TaskBoardNode,
};

function Canvas() {
  const [nodes, , onNodesChange] = useNodesState<WorkspaceNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => {
      // New user-drawn edges inherit the shared presentation and start with a
      // placeholder label, so every relationship on the canvas is nameable.
      setEdges((current) =>
        addEdge({ ...connection, ...edgeDefaults, label: 'dependency: unnamed' }, current),
      );
    },
    [setEdges],
  );

  // Placeholder interaction: selection highlighting is handled by React Flow,
  // and the real inspector panel arrives with the Agents/Tasks sections.
  const onNodeClick = useCallback<NodeMouseHandler<WorkspaceNode>>((_event, node) => {
    console.log('[canvas] node selected', { id: node.id, type: node.type });
  }, []);

  const onEdgeClick = useCallback<EdgeMouseHandler<Edge>>((_event, edge) => {
    console.log('[canvas] edge selected', { id: edge.id, label: edge.label });
  }, []);

  /** Double-click an edge to rename it — crude on purpose, pending a real editor. */
  const onEdgeDoubleClick = useCallback<EdgeMouseHandler<Edge>>(
    (_event, edge) => {
      const next = window.prompt('Edge label', String(edge.label ?? ''));
      if (next === null) return;
      setEdges((current) =>
        current.map((item) => (item.id === edge.id ? { ...item, label: next } : item)),
      );
    },
    [setEdges],
  );

  const defaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 0.85 }), []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onEdgeDoubleClick={onEdgeDoubleClick}
      defaultViewport={defaultViewport}
      minZoom={0.3}
      maxZoom={1.75}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
    >
      <CanvasBackground />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

/**
 * The workspace canvas. Wrapped in its own provider so canvas state stays
 * scoped here rather than leaking into the surrounding shell.
 */
export function WorkspaceCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
