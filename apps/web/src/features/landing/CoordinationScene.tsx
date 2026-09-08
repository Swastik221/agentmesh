const DEPENDENCY_PATH = 'M540 230C615 270 720 270 795 230';
const ARTIFACT_PATH = 'M850 134C775 42 605 42 500 134';

function AgentCard({
  x,
  name,
  owner,
  identity,
  capability,
  side,
}: {
  x: number;
  name: string;
  owner: string;
  identity: string;
  capability: string;
  side: 'orion' | 'vega';
}) {
  return (
    <g className={`coord-agent coord-agent--${side}`} transform={`translate(${x} 125)`}>
      <rect width="220" height="108" rx="7" fill="#0d1117" stroke="#232c40" />
      <path d="M0 34H220" stroke="#232c40" />
      <circle cx="14" cy="17" r="3" fill="#3ddc97" />
      <text x="25" y="21" className="coord-primary">
        {name}
      </text>
      <text className="coord-agent-idle" x="207" y="21" textAnchor="end">
        IDLE
      </text>
      <text className="coord-agent-working" x="207" y="21" textAnchor="end">
        WORKING
      </text>
      {side === 'orion' && (
        <text className="coord-agent-blocked" x="207" y="21" textAnchor="end">
          WAITING
        </text>
      )}
      <text x="14" y="53" className="coord-owner">
        owner · {owner}
      </text>
      <text x="14" y="72" className="coord-muted">
        {identity}
      </text>
      <text x="14" y="93" className="coord-capability">
        ↳ {capability}
      </text>
    </g>
  );
}

function Cursor({ side, label }: { side: 'anand' | 'swastik'; label: string }) {
  return (
    <g className={`coord-cursor coord-cursor--${side}`}>
      <path d="M2 2L19 14L11 17L7 25Z" fill="currentColor" stroke="#0a0e17" strokeWidth="2" />
      <rect x="17" y="-5" width="112" height="25" rx="4" fill="currentColor" />
      <text x="26" y="11" className="coord-cursor-label">
        {label}
      </text>
    </g>
  );
}

function TaskRow({
  y,
  id,
  title,
  skill,
  state,
}: {
  y: number;
  id: string;
  title: string;
  skill: string;
  state: string;
}) {
  return (
    <g transform={`translate(0 ${y})`}>
      <path d="M0 0H360" stroke="#232c40" />
      <text x="13" y="18" className="coord-task-id">
        {id}
      </text>
      <text x="65" y="18" className="coord-primary coord-task-title">
        {title}
      </text>
      <text x="65" y="34" className="coord-muted">
        {skill}
      </text>
      <rect
        x="287"
        y="10"
        width="61"
        height="22"
        rx="3"
        className={`coord-status coord-status--${state.toLowerCase()}`}
      />
      <text
        x="317"
        y="25"
        textAnchor="middle"
        className={`coord-status-text coord-status-text--${state.toLowerCase()}`}
      >
        {state}
      </text>
      {(id === 'AM-114' || id === 'AM-115') && (
        <g className={`coord-claimed-status coord-claimed-status--${id === 'AM-114' ? 'a' : 'b'}`}>
          <rect x="287" y="10" width="61" height="22" rx="3" />
          <text x="317" y="25" textAnchor="middle">
            CLAIMED
          </text>
        </g>
      )}
    </g>
  );
}

function Chip({
  className,
  x,
  y,
  children,
}: {
  className: string;
  x: number;
  y: number;
  children: string;
}) {
  return (
    <g className={`coord-chip ${className}`} transform={`translate(${x} ${y})`}>
      <rect width="148" height="25" rx="4" />
      <text x="10" y="17">
        {children}
      </text>
    </g>
  );
}

/** Static SVG structure: scroll changes only styles and transforms in the painter. */
export function CoordinationScene() {
  return (
    <g className="coord-workflow" transform="translate(170 50) scale(.83)">
      <AgentCard
        x={420}
        name="Orion / Codex"
        owner="Anand"
        identity="codex.dev1.eth"
        capability="frontend / identity"
        side="orion"
      />
      <AgentCard
        x={760}
        name="Vega / Claude"
        owner="Swastik"
        identity="claude.dev2.eth"
        capability="backend / API"
        side="vega"
      />

      <g className="coord-board" transform="translate(530 285)">
        <rect width="360" height="207" rx="7" fill="#0d1117" stroke="#232c40" />
        <path d="M0 42H360" stroke="#232c40" />
        <text x="14" y="26" className="coord-primary">
          Shared task board
        </text>
        <text x="344" y="26" textAnchor="end" className="coord-muted">
          04 tasks
        </text>
        <TaskRow
          y={42}
          id="AM-114"
          title="Wallet identity panel"
          skill="frontend"
          state="PROPOSED"
        />
        <TaskRow y={83} id="AM-115" title="Payment API schema" skill="backend" state="PROPOSED" />
        <TaskRow y={124} id="AM-116" title="Approval modal" skill="security" state="WAITING" />
        <TaskRow y={165} id="AM-117" title="Artifact handoff" skill="protocol" state="UNASSIGNED" />
      </g>

      <path
        className="coord-proposal-line coord-proposal-line--orion"
        pathLength="1"
        d="M710 285C650 255 585 245 530 233"
      />
      <path
        className="coord-proposal-line coord-proposal-line--vega"
        pathLength="1"
        d="M710 285C770 255 820 245 870 233"
      />
      <path className="coord-dependency-base" d={DEPENDENCY_PATH} pathLength="1" />
      <path className="coord-dependency-live" d={DEPENDENCY_PATH} pathLength="1" />
      <path className="coord-artifact-path" d={ARTIFACT_PATH} pathLength="1" />

      <g className="coord-task-token coord-task-token--114">
        <rect width="118" height="31" rx="5" />
        <text x="10" y="20">
          AM-114 · frontend
        </text>
      </g>
      <g className="coord-task-token coord-task-token--115">
        <rect width="118" height="31" rx="5" />
        <text x="10" y="20">
          AM-115 · backend
        </text>
      </g>

      <Cursor side="anand" label="Anand · frontend" />
      <Cursor side="swastik" label="Swastik · backend" />

      <g className="coord-dependency-chip">
        <rect width="151" height="27" rx="4" />
        <text x="10" y="18">
          DEPENDENCY_REQUEST
        </text>
      </g>
      <g className="coord-artifact">
        <rect x="-65" y="-20" width="130" height="40" rx="5" />
        <text x="0" y="-3" textAnchor="middle">
          payment-api.json
        </text>
        <text x="0" y="12" textAnchor="middle">
          Vega → Orion
        </text>
      </g>
      <circle className="coord-packet" r="4" />

      <Chip className="coord-event-proposal" x={420} y={515}>
        TASK_PROPOSAL
      </Chip>
      <Chip className="coord-event-claim-a" x={575} y={515}>
        TASK_CLAIMED · ANAND
      </Chip>
      <Chip className="coord-event-claim-b" x={730} y={515}>
        TASK_CLAIMED · SWASTIK
      </Chip>
      <Chip className="coord-event-dependency" x={420} y={546}>
        DEPENDENCY_REQUEST
      </Chip>
      <Chip className="coord-event-artifact" x={575} y={546}>
        ARTIFACT_PUBLISHED
      </Chip>
      <Chip className="coord-event-unblocked" x={730} y={546}>
        TASK_UNBLOCKED
      </Chip>

      <g className="coord-caption-stack">
        {[
          'Two developers enter one shared workspace.',
          'The coordinator proposes work to every connected agent.',
          'Each developer chooses the task that fits their agent.',
          'Claims are visible and attributed.',
          'A blocked agent asks for the missing dependency.',
          'One agent’s output becomes another agent’s input.',
          'The team stays coordinated without manual back-and-forth.',
        ].map((caption, index) => (
          <text
            key={caption}
            className={`coord-caption coord-caption-${index}`}
            x="700"
            y="610"
            textAnchor="middle"
          >
            {caption}
          </text>
        ))}
      </g>
    </g>
  );
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const range = (p: number, from: number, to: number) => clamp((p - from) / (to - from));
const smooth = (t: number) => t * t * (3 - 2 * t);
const out = (t: number) => 1 - (1 - t) ** 3;
const bezier = (a: number, b: number, c: number, t: number) =>
  (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c;
const point = (a: [number, number], b: [number, number], c: [number, number], t: number) => ({
  x: bezier(a[0], b[0], c[0], t),
  y: bezier(a[1], b[1], c[1], t),
});

export function paintCoordinationScene(scene: HTMLElement, progress: number) {
  const set = (name: string, value: number) =>
    scene.style.setProperty(`--coord-${name}`, String(value));
  // Finish before the runway ends, then hold the resolved composition long
  // enough to read it before the sticky cover releases into the next chapter.
  const presence = out(range(progress, 0, 0.1));
  const proposal = smooth(range(progress, 0.1, 0.23));
  const choose = smooth(range(progress, 0.23, 0.39));
  const taskFollow = smooth(range(progress, 0.27, 0.39));
  const claim = smooth(range(progress, 0.39, 0.51));
  const dependency = smooth(range(progress, 0.51, 0.64));
  const handoff = smooth(range(progress, 0.64, 0.78));
  const complete = smooth(range(progress, 0.78, 0.84));
  set('presence', presence);
  set('proposal', proposal);
  set('choose', choose);
  set('claim', claim);
  set('dependency', dependency);
  set('handoff', handoff);
  set('complete', complete);
  set('claimed-a', claim);
  set('claimed-b', claim);
  set('blocked', dependency * (1 - complete));
  set('unblocked', complete);
  set('artifact-visible', smooth(range(progress, 0.62, 0.69)));
  set(
    'task-token',
    smooth(range(progress, 0.23, 0.28)) * (1 - smooth(range(progress, 0.46, 0.51))),
  );
  set('cursor-opacity', presence * (1 - smooth(range(progress, 0.47, 0.54))));
  set('dependency-chip', dependency * (1 - smooth(range(progress, 0.66, 0.72))));
  set(
    'packet-opacity',
    smooth(range(progress, 0.65, 0.69)) * (1 - smooth(range(progress, 0.78, 0.83))),
  );
  set('dependency-amber', dependency * (1 - complete));
  set('proposal-event', smooth(range(progress, 0.1, 0.17)));
  set('claim-event', smooth(range(progress, 0.39, 0.46)));
  set('dependency-event', smooth(range(progress, 0.51, 0.58)));
  set('artifact-event', smooth(range(progress, 0.64, 0.71)));
  set('unblocked-event', complete);

  const cursorA =
    progress < 0.23
      ? point([330, 286], [360, 248], [385, 250], presence)
      : choose < 0.38
        ? point([385, 250], [455, 275], [555, 340], out(choose / 0.38))
        : point([555, 340], [520, 280], [490, 220], smooth((choose - 0.38) / 0.62));
  const cursorB =
    progress < 0.23
      ? point([1050, 286], [1020, 248], [1000, 250], presence)
      : choose < 0.38
        ? point([1000, 250], [950, 290], [865, 381], out(choose / 0.38))
        : point([865, 381], [860, 285], [825, 220], smooth((choose - 0.38) / 0.62));
  scene
    .querySelector('.coord-cursor--anand')
    ?.setAttribute('transform', `translate(${cursorA.x} ${cursorA.y})`);
  scene
    .querySelector('.coord-cursor--swastik')
    ?.setAttribute('transform', `translate(${cursorB.x} ${cursorB.y})`);

  const taskA = point([550, 337], [525, 278], [446, 215], taskFollow);
  const taskB = point([550, 378], [720, 330], [786, 215], taskFollow);
  scene
    .querySelector('.coord-task-token--114')
    ?.setAttribute('transform', `translate(${taskA.x} ${taskA.y})`);
  scene
    .querySelector('.coord-task-token--115')
    ?.setAttribute('transform', `translate(${taskB.x} ${taskB.y})`);

  const dependencyPath = scene.querySelector<SVGPathElement>('.coord-dependency-base');
  const dependencyChip = scene.querySelector<SVGGElement>('.coord-dependency-chip');
  if (dependencyPath && dependencyChip) {
    const p = dependencyPath.getPointAtLength(dependencyPath.getTotalLength() * dependency);
    dependencyChip.setAttribute('transform', `translate(${p.x - 75} ${p.y - 14})`);
  }
  const artifactPath = scene.querySelector<SVGPathElement>('.coord-artifact-path');
  if (artifactPath) {
    const p = artifactPath.getPointAtLength(artifactPath.getTotalLength() * handoff);
    scene
      .querySelector('.coord-artifact')
      ?.setAttribute(
        'transform',
        `translate(${p.x} ${p.y}) scale(${1 + Math.sin(handoff * Math.PI) * 0.015})`,
      );
    scene
      .querySelector('.coord-packet')
      ?.setAttribute('transform', `translate(${p.x - 72} ${p.y})`);
  }

  const boundaries = [0, 0.1, 0.23, 0.39, 0.51, 0.64, 0.78, 1];
  for (let index = 0; index < 7; index += 1) {
    const enter =
      index === 0
        ? 1
        : smooth(range(progress, boundaries[index] - 0.025, boundaries[index] + 0.025));
    const leave =
      index === 6
        ? 0
        : smooth(range(progress, boundaries[index + 1] - 0.025, boundaries[index + 1] + 0.025));
    set(`caption-${index}`, enter * (1 - leave));
  }
}
