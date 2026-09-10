import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Background,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  getSmoothStepPath,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentNode } from '../../components/canvas/AgentNode';
import { TaskBoardNode } from '../../components/canvas/TaskBoardNode';
import type { WorkspaceNode } from '../../types';
import { artifact } from './landing.content';
import { mix as lerp } from './motion';
import { BEATS, CAPTIONS, beatOpacity, workspaceTimeline, type Layout } from './workspaceTimeline';

/**
 * React Flow hands every node its absolute position as a prop, so a node
 * component re-renders on each viewport frame — sixty times a second while the
 * canvas is being scrubbed. Nothing inside a terminal depends on where that
 * terminal sits, and re-rendering the log lines under a moving transform is
 * what made the text flicker mid-move. Comparing only the props that can
 * change the markup lets the browser move the whole block as one painted
 * layer, with its contents untouched.
 */
const sameContent = (
  a: { data: unknown; selected?: boolean; dragging?: boolean },
  b: { data: unknown; selected?: boolean; dragging?: boolean },
) => a.data === b.data && a.selected === b.selected && a.dragging === b.dragging;
const nodeTypes = {
  agent: memo(AgentNode, sameContent),
  taskBoard: memo(TaskBoardNode, sameContent),
};

/** A drawn arrowhead, so the wire's tip can fade in with the line it ends. */
function arrowHead(x: number, y: number, side: Position) {
  if (side === Position.Top) return `M${x} ${y}L${x - 5} ${y - 9}L${x + 5} ${y - 9}Z`;
  if (side === Position.Bottom) return `M${x} ${y}L${x - 5} ${y + 9}L${x + 5} ${y + 9}Z`;
  if (side === Position.Right) return `M${x} ${y}L${x + 9} ${y - 5}L${x + 9} ${y + 5}Z`;
  return `M${x} ${y}L${x - 9} ${y - 5}L${x - 9} ${y + 5}Z`;
}

/*
 * The wires are drawn here rather than handed to React Flow as edges.
 *
 * React Flow decides for itself whether an edge can be rendered, from node
 * measurements it takes asynchronously; under a scrubbed scroll that decision
 * was observed to go the wrong way and drop all three wires for the rest of
 * the scene, which is the worst version of the flicker this scene must not
 * have. The scene already owns every position, so it can own the geometry too:
 * `getSmoothStepPath` is the same routing function React Flow would have used,
 * and nothing but scroll progress can now take a wire off the canvas.
 *
 * Terminal sizes are fixed by the section's own CSS, so the handle a wire
 * leaves from is a constant offset rather than a measurement.
 */
const AGENT = { width: 330, height: 235 };
const BOARD = { width: 360, height: 264 };
const NO_EDGES: never[] = [];

type Wire = {
  id: string;
  from: { x: number; y: number; side: Position };
  to: { x: number; y: number; side: Position };
  draw: number;
  arrive: number;
};

function CanvasWires({ wires }: { wires: Wire[] }) {
  return (
    <svg className="canvas-wires" aria-hidden="true">
      {wires.map((wire) => {
        const [path] = getSmoothStepPath({
          sourceX: wire.from.x,
          sourceY: wire.from.y,
          sourcePosition: wire.from.side,
          targetX: wire.to.x,
          targetY: wire.to.y,
          targetPosition: wire.to.side,
        });
        return (
          <g className="canvas-edge" key={wire.id}>
            <path
              className="canvas-drawing-edge"
              d={path}
              pathLength="1"
              fill="none"
              stroke="var(--am-cyan)"
              strokeWidth="2"
              strokeDasharray="1"
              strokeDashoffset={1 - wire.draw}
            />
            <path
              className="canvas-edge-arrow"
              d={arrowHead(wire.to.x, wire.to.y, wire.to.side)}
              fill="var(--am-cyan)"
              opacity={wire.arrive}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Two stacked lines that hand over by opacity — no text is ever swapped. */
function Crossfade({ className, lines }: { className: string; lines: [string, number][] }) {
  return (
    <span className={className}>
      {lines.map(([text, opacity]) => (
        <span key={text} style={{ opacity }}>
          {text}
        </span>
      ))}
    </span>
  );
}

function CanvasScene({ progress, beat }: { progress: number; beat: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>('desktop');
  const [manual, setManual] = useState<Record<string, { x: number; y: number }>>({});
  const { fitBounds } = useReactFlow();
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mode = innerWidth < 700 ? 'phone' : innerWidth < 1000 ? 'tablet' : 'desktop';
        setLayout(mode);
        void fitBounds(
          mode === 'phone'
            ? { x: -35, y: -10, width: 400, height: 850 }
            : mode === 'tablet'
              ? { x: -70, y: -65, width: 875, height: 710 }
              : { x: -130, y: -85, width: 1420, height: 570 },
          { padding: 0.06, duration: 0 },
        );
      });
    };
    const observer = new ResizeObserver(resize);
    if (ref.current) observer.observe(ref.current);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitBounds]);
  useEffect(() => {
    if (progress < 1) setManual((current) => (Object.keys(current).length ? {} : current));
  }, [progress]);

  const timeline = workspaceTimeline(progress, layout);
  const { orionNode, vegaNode, anandCursor, swastikCursor, board } = timeline;

  /*
   * Terminal copy is the one thing that cannot crossfade — it lives inside the
   * shared node components. It is therefore keyed on the debounced beat, so it
   * settles once per beat and never strobes across a threshold, and the data
   * object identity holds for the whole beat so a scrubbed frame only moves
   * the block.
   */
  const content = useMemo(
    () => ({
      orion: {
        name: 'Orion / Codex',
        ens: 'Anand · demo / owner',
        address: '',
        status: (beat >= 3 ? 'working' : 'connected') as 'working' | 'connected',
        log: [
          { block: '01', hash: '→', message: 'frontend / identity' },
          {
            block: '02',
            hash: '→',
            message:
              beat >= 6
                ? 'receiving payment-api.json'
                : beat >= 3
                  ? 'working on AM-114'
                  : 'awaiting shared task',
          },
          {
            block: '03',
            hash: '✓',
            message: beat >= 6 ? 'Dependency connected' : 'Local agent ready',
          },
        ],
      },
      board: {
        title: 'Shared task board',
        tasks: [
          {
            id: 'AM-114',
            title: 'Build wallet identity panel',
            ref: 'frontend',
            status: (beat >= 3 ? 'claimed' : 'proposed') as 'claimed' | 'proposed',
            claimedBy: beat >= 3 ? 'Orion · Anand' : undefined,
          },
          {
            id: 'AM-115',
            title: 'Build payment API',
            ref: 'backend',
            status: (beat >= 6 ? 'claimed' : 'proposed') as 'claimed' | 'proposed',
            claimedBy: beat >= 6 ? 'Vega · Swastik' : undefined,
          },
        ],
      },
      vega: {
        name: 'Vega / Claude',
        ens: 'Swastik · demo / owner',
        address: '',
        status: (beat >= 6 ? 'working' : 'connected') as 'working' | 'connected',
        log: [
          { block: '01', hash: '→', message: 'backend / devops' },
          {
            block: '02',
            hash: '→',
            message:
              beat >= 6
                ? 'published payment-api.json'
                : beat >= 4
                  ? 'ready for AM-115'
                  : 'awaiting shared task',
          },
          { block: '03', hash: '✓', message: beat >= 6 ? 'Artifact shared' : 'Local agent ready' },
        ],
      },
    }),
    [beat],
  );

  // The scripted values live in `style` rather than in class names: held, lean
  // and lift are all continuous, so nothing has an on state to snap into.
  const held = (node: { hold: number; tilt: number }) =>
    ({
      transformOrigin: '128px 20px',
      rotate: `${node.tilt}deg`,
      scale: String(1 + node.hold * 0.018),
      '--held': node.hold,
    }) as CSSProperties;
  const nodes = useMemo<WorkspaceNode[]>(
    () => [
      {
        id: 'orion',
        type: 'agent',
        position: manual.orion ?? { x: orionNode.x, y: orionNode.y },
        data: content.orion,
        className: 'scripted-agent owner-anand',
        style: held(orionNode),
      },
      {
        id: 'board',
        type: 'taskBoard',
        position: manual.board ?? board,
        data: content.board,
      },
      {
        id: 'vega',
        type: 'agent',
        position: manual.vega ?? { x: vegaNode.x, y: vegaNode.y },
        data: content.vega,
        className: 'scripted-agent owner-swastik',
        style: held(vegaNode),
      },
    ],
    // Every scripted value the nodes read, listed individually: the timeline
    // hands back fresh objects each frame, so identity would never match.
    [
      content,
      manual,
      board.x,
      board.y,
      orionNode.x,
      orionNode.y,
      orionNode.hold,
      orionNode.tilt,
      vegaNode.x,
      vegaNode.y,
      vegaNode.hold,
      vegaNode.tilt,
    ],
  );
  // Wires run between the same handles React Flow would have used, read off
  // the positions this scene already owns.
  const orionAt = nodes[0].position,
    boardAt = nodes[1].position,
    vegaAt = nodes[2].position;
  const boardInlet = { x: boardAt.x, y: boardAt.y + BOARD.height / 2, side: Position.Left };
  const vegaOutlet = {
    x: vegaAt.x + AGENT.width / 2,
    y: vegaAt.y + AGENT.height,
    side: Position.Bottom,
  };
  const wires: Wire[] = [
    {
      id: 'orion-board',
      from: { x: orionAt.x + AGENT.width, y: orionAt.y + AGENT.height / 2, side: Position.Right },
      to: boardInlet,
      ...timeline.activeEdges[0],
    },
    { id: 'board-vega', from: vegaOutlet, to: boardInlet, ...timeline.activeEdges[1] },
    {
      id: 'artifact-handoff',
      from: vegaOutlet,
      to: { x: orionAt.x + AGENT.width / 2, y: orionAt.y, side: Position.Top },
      ...timeline.activeEdges[2],
    },
  ];
  const onNodesChange = (changes: NodeChange<WorkspaceNode>[]) => {
    if (progress < 1) return;
    for (const change of changes)
      if (change.type === 'position' && change.position)
        setManual((current) => ({ ...current, [change.id]: change.position! }));
  };

  const live = progress >= 1;
  const start = nodes[2].position;
  const end = nodes[0].position;
  const cursors = [
    { state: anandCursor, node: orionNode, owner: 'Anand', agent: 'Orion' },
    { state: swastikCursor, node: vegaNode, owner: 'Swastik', agent: 'Vega' },
  ];
  return (
    <div
      className="scroll-canvas"
      ref={ref}
      data-canvas-progress={progress}
      data-live={String(live)}
    >
      <ReactFlow
        nodes={nodes}
        edges={NO_EDGES}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        /* Once the demo has played the canvas is handed over: the terminals
           can be dragged and the board panned and pinched. Wheel zoom stays
           off and scrolling is never captured, so the page still scrolls
           normally over the top of it. */
        nodesDraggable={live}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        panOnDrag={live}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={live}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background color="var(--am-border-dark)" gap={28} size={1} />
        <ViewportPortal>
          <CanvasWires wires={wires} />
          {cursors.map(({ state, owner }, i) => (
            <div
              key={owner}
              className={`workspace-cursor cursor-${i}`}
              data-mode={state.mode}
              style={{
                transform: `translate(${state.x}px, ${state.y}px)`,
                // In at the start, and out at the end: once the demo has
                // played, the canvas is the reader's, and two illustrative
                // pointers should not compete with their own.
                opacity: Math.min(1, progress / 0.06) * (1 - Math.max(0, (progress - 0.93) / 0.06)),
              }}
            >
              {/* Both pointers are drawn; closing the hand is a crossfade, not
                  a swapped path, so the grab reads as one movement. */}
              <svg width="23" height="28" viewBox="0 0 23 28" aria-hidden="true">
                <path
                  d="M2 2L20 15L11 17L7 25Z"
                  fill="currentColor"
                  stroke="var(--am-ink-950)"
                  strokeWidth="2"
                  opacity={1 - state.hold}
                />
                <path
                  d="M5 14V9Q5 6 8 9V5Q9 2 11 5V9Q13 5 15 8V11Q18 8 19 12V20L15 25H8L3 18Q1 14 5 14Z"
                  fill="currentColor"
                  stroke="var(--am-ink-950)"
                  strokeWidth="2"
                  opacity={state.hold}
                />
              </svg>
              <span>
                {owner} <small>· demo</small>
              </span>
            </div>
          ))}
          {cursors.map(({ node, owner, agent }, i) => (
            <div
              key={agent}
              className={`canvas-attribution cursor-${i}`}
              style={{
                // Above the cursor's own name tag, which sits just over the
                // title bar it is holding, so the two never overlap.
                transform: `translate(${nodes[i ? 2 : 0].position.x}px, ${
                  nodes[i ? 2 : 0].position.y - 78
                }px)`,
              }}
            >
              <Crossfade
                className="canvas-attribution-lines"
                lines={[
                  [`${owner} selected ${agent}`, node.selected],
                  [`${owner} moved ${agent}`, node.moved],
                ]}
              />
            </div>
          ))}
          <div
            className="canvas-schema-packet"
            style={{
              opacity: timeline.packetOpacity,
              // It comes to rest just under the receiving terminal rather than
              // across its identity line.
              transform: `translate(${lerp(start.x + 190, end.x + 96, timeline.packet)}px, ${
                lerp(start.y + 235, end.y + 258, timeline.packet) -
                Math.sin(timeline.packet * Math.PI) * 26
              }px)`,
            }}
          >
            {'{ }'} artifact: payment-api.json
          </div>
        </ViewportPortal>
      </ReactFlow>
      <Crossfade
        className="canvas-task-event"
        lines={[
          ['TASK_CLAIMED · Orion · AM-114', timeline.taskEvents[0]],
          ['TASK_CLAIMED · Vega · AM-115', timeline.taskEvents[1]],
        ]}
      />
    </div>
  );
}

/**
 * The beat that terminal copy follows. It advances on its boundary but only
 * falls back once progress has retreated past it by a clear margin, so a wheel
 * that wobbles on a threshold cannot flip a status badge back and forth.
 */
const MARGIN = 0.006;
function useBeat(progress: number) {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    setBeat((current) => {
      let next = current;
      while (next < BEATS.length && progress >= BEATS[next]) next += 1;
      while (next > 0 && progress < BEATS[next - 1] - MARGIN) next -= 1;
      return next;
    });
  }, [progress]);
  return beat;
}

/**
 * The demo's own clock, in seconds.
 *
 * This section used to be pinned and scrubbed: the reader's wheel was the
 * transport, so the whole assembly ran at whatever pace and direction they
 * happened to scroll, and scrolling back up took the workspace apart again. It
 * now plays once, evenly, the first time it comes into view, and then simply
 * stays — and the canvas becomes a real one you can drag and pan.
 */
const DEMO_SECONDS = 13;

export function ScrollWorkspace() {
  const ref = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [take, setTake] = useState(0);
  useEffect(() => {
    const root = ref.current!;
    const settle = (value: number) => {
      setProgress(value);
      root.dataset.progress = String(value);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settle(1);
      return;
    }
    settle(0);
    let frame = 0;
    let opened = 0;
    let disposed = false;
    const draw = (now: number) => {
      if (disposed) return;
      if (!opened) opened = now;
      const value = Math.min(1, (now - opened) / (DEMO_SECONDS * 1000));
      settle(value);
      if (value < 1) frame = requestAnimationFrame(draw);
    };
    // Starts when the section is properly on screen, so the reader arrives at
    // the beginning of the demo rather than in the middle of it.
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        frame = requestAnimationFrame(draw);
      },
      { threshold: 0.35 },
    );
    watch.observe(root);
    return () => {
      disposed = true;
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [take]);
  const beat = useBeat(progress);
  return (
    <section
      id="workspace"
      ref={ref}
      className="workspace-scroll"
      data-theme="dark"
      aria-label="Two agents assembling a shared workspace"
      title="Open the live AgentMesh canvas"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.workspace-replay, .workspace-inspector')) return;
        window.location.assign('/canvas');
      }}
    >
      <div className="workspace-story-heading">
        <span className="eyebrow">I / THE SHARED CANVAS</span>
        <h2>
          Work, <em>together.</em>
        </h2>
        <span className="workspace-local">
          <i /> Local preview · 2 agents
        </span>
      </div>
      <ReactFlowProvider>
        <CanvasScene progress={progress} beat={beat} />
      </ReactFlowProvider>
      <div className="workspace-story-footer">
        {/* All seven captions are mounted and stacked in one grid cell: they
            hand over by opacity, so the line never reflows or pops. */}
        <p className="workspace-caption">
          {CAPTIONS.map((text, index) => (
            <span key={text} style={{ opacity: beatOpacity(progress, index) }}>
              {text}
            </span>
          ))}
        </p>
        <span>
          {progress >= 1 ? (
            <>
              Drag the terminals, pan the canvas.{' '}
              <button type="button" className="workspace-replay" onClick={() => setTake(take + 1)}>
                Replay
              </button>
            </>
          ) : (
            'Anand + Swastik / illustrative cursors'
          )}
        </span>
        <div>
          <i style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>
      <details className="workspace-inspector">
        <summary>Inspect schema</summary>
        <pre>{JSON.stringify({ ...artifact, actor: 'vega', owner: 'swastik-demo' }, null, 2)}</pre>
      </details>
    </section>
  );
}
