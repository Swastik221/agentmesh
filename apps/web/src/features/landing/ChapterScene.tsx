import { useEffect, useRef, type ReactNode } from 'react';
import { FlatCoder, poseCoder, type CoderRole } from './FlatCoder';
import { CoordinationScene, paintCoordinationScene } from './CoordinationScene';
import { easeOut, mix, smoothStep } from './motion';

export const sceneCopy = {
  agents: 'One developer. Their own tools. A shared direction.',
  coordination: 'Two developers. Two agents. One shared plan.',
  control: 'Inspect the request. Keep the decision human.',
  identity: 'Follow every agent back to its owner.',
  developers: 'Write. Inspect. Build together.',
  questions: 'A little context makes the next step clearer.',
  closing: 'Your next project starts with a connection.',
} as const;
export type SceneRole = keyof typeof sceneCopy;
const roles: Record<SceneRole, CoderRole> = {
  agents: 'typing',
  coordination: 'repair',
  control: 'control',
  identity: 'identity',
  developers: 'audit',
  questions: 'wave',
  closing: 'connect',
};

function Panel({
  x,
  y,
  title,
  children,
  className = '',
}: {
  x: number;
  y: number;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`scene-panel ${className}`}>
        <rect
          width="270"
          height="166"
          rx="10"
          fill="var(--am-ink-900)"
          stroke="var(--am-border-dark)"
        />
        <path d="M0 39H270" stroke="var(--am-border-dark)" />
        <circle cx="17" cy="20" r="3" fill="var(--am-amber)" />
        <circle cx="28" cy="20" r="3" fill="var(--am-green)" />
        <text x="43" y="24" fill="var(--am-text-on-dark)" fontSize="12">
          {title}
        </text>
        {children}
      </g>
    </g>
  );
}

/**
 * The editor-to-agent wire. One definition, because the line and the traffic
 * that runs along it have to share exactly the same curve.
 */
const AGENT_WIRE = 'M610 255C450 320 875 270 865 385';

/**
 * Chapter II plays itself. The loop starts the first time the section comes
 * near the viewport — so the reader does not arrive after it has finished —
 * and from then on it simply keeps running. Reduced motion is painted once, at
 * its settled state, and never animated.
 */
function useWorkshopClock(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scene = ref.current;
    if (!enabled || !scene) return;
    paintWorkshop(scene, 0);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paintWorkshop(scene, INTRO_SECONDS);
      return;
    }
    let frame = 0;
    let opened = 0;
    const draw = (now: number) => {
      if (!opened) opened = now;
      paintWorkshop(scene, (now - opened) / 1000);
      frame = requestAnimationFrame(draw);
    };
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        frame = requestAnimationFrame(draw);
      },
      { rootMargin: '300px' },
    );
    watch.observe(scene);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return ref;
}

const CONTROL_SECONDS = 8;
const IDENTITY_SECONDS = 7.2;
const DEVELOPERS_SECONDS = 7.6;

/** Plays the policy checkpoint once at an even pace and holds the outcome. */
function useControlClock(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scene = ref.current;
    if (!enabled || !scene) return;
    paintControlAnimation(scene, 0);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paintControlAnimation(scene, CONTROL_SECONDS);
      return;
    }
    let frame = 0;
    let opened = 0;
    const draw = (now: number) => {
      if (!opened) opened = now;
      const seconds = (now - opened) / 1000;
      paintControlAnimation(scene, seconds);
      if (seconds < CONTROL_SECONDS) frame = requestAnimationFrame(draw);
    };
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        frame = requestAnimationFrame(draw);
      },
      { rootMargin: '-12% 0px -12% 0px', threshold: 0.2 },
    );
    watch.observe(scene);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return ref;
}

/** Builds the identity chain once, then leaves the ownership graph in place. */
function useIdentityClock(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scene = ref.current;
    if (!enabled || !scene) return;
    paintIdentityAnimation(scene, 0);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paintIdentityAnimation(scene, IDENTITY_SECONDS);
      return;
    }
    let frame = 0;
    let opened = 0;
    const draw = (now: number) => {
      if (!opened) opened = now;
      const seconds = (now - opened) / 1000;
      paintIdentityAnimation(scene, seconds);
      if (seconds < IDENTITY_SECONDS) frame = requestAnimationFrame(draw);
    };
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        frame = requestAnimationFrame(draw);
      },
      { rootMargin: '-12% 0px -12% 0px', threshold: 0.2 },
    );
    watch.observe(scene);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return ref;
}

/** Appends a readable development trace once and leaves the audit trail intact. */
function useDevelopersClock(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scene = ref.current;
    if (!enabled || !scene) return;
    paintDevelopersAnimation(scene, 0);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paintDevelopersAnimation(scene, DEVELOPERS_SECONDS);
      return;
    }
    let frame = 0;
    let opened = 0;
    const draw = (now: number) => {
      if (!opened) opened = now;
      const seconds = (now - opened) / 1000;
      paintDevelopersAnimation(scene, seconds);
      if (seconds < DEVELOPERS_SECONDS) frame = requestAnimationFrame(draw);
    };
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        frame = requestAnimationFrame(draw);
      },
      { rootMargin: '-12% 0px -12% 0px', threshold: 0.2 },
    );
    watch.observe(scene);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return ref;
}

/** Each chapter has its own physical action and product metaphor. */
export function ChapterScene({ role }: { role: SceneRole }) {
  const workshop = useWorkshopClock(role === 'agents');
  const control = useControlClock(role === 'control');
  const identity = useIdentityClock(role === 'identity');
  const developers = useDevelopersClock(role === 'developers');
  const sceneRef =
    role === 'agents'
      ? workshop
      : role === 'control'
        ? control
        : role === 'identity'
          ? identity
          : role === 'developers'
            ? developers
            : undefined;
  return (
    <div
      className={`chapter-scene scene--${role}`}
      data-scene-role={role}
      ref={sceneRef}
      aria-hidden="true"
    >
      <svg className="scene-objects" viewBox="0 0 1000 640" fill="none">
        <g className="scene-orbit" stroke="#26364c">
          <ellipse cx="735" cy="340" rx="245" ry="232" />
          <ellipse cx="735" cy="340" rx="185" ry="175" strokeDasharray="2 12" />
        </g>
        {role === 'agents' && (
          <>
            <Panel x={470} y={95} title="Local editor / your session" className="scene-float-a">
              {[0, 1, 2, 3].map((i) => (
                <path
                  className={`scene-code-line scene-code-line-${i}`}
                  key={i}
                  pathLength="1"
                  d={`M20 ${64 + i * 23}H${i % 2 ? 160 : 235}`}
                  stroke={i % 2 ? 'var(--am-purple)' : 'var(--am-green)'}
                  strokeWidth="4"
                />
              ))}
              {/* The caret blinks on its own clock inside a wrapper that carries
                  the typing ramp, so the two opacities multiply: it is already
                  blinking before it is visible, and never switches on. */}
              <g className="scene-caret-wrap">
                <path
                  className="scene-editor-caret"
                  d="M20 145V158"
                  stroke="var(--am-cyan)"
                  strokeWidth="3"
                />
              </g>
            </Panel>
            <g className="scene-float-b">
              <rect
                x="800"
                y="385"
                width="155"
                height="73"
                rx="9"
                fill="#172638"
                stroke="#2b3a52"
              />
              {/* Activation is a second border fading in over the resting one,
                  rather than one stroke changing colour on a threshold. */}
              <rect
                className="scene-agent-border"
                x="800"
                y="385"
                width="155"
                height="73"
                rx="9"
                fill="none"
                stroke="var(--am-cyan)"
              />
              <text
                className="scene-agent-waiting"
                x="820"
                y="415"
                fill="var(--am-technical-label)"
                fontSize="14"
              >
                agent.waiting
              </text>
              <text
                className="scene-agent-ready"
                x="820"
                y="415"
                fill="var(--am-text-on-dark)"
                fontSize="14"
              >
                agent.ready
              </text>
              <text
                className="scene-agent-capabilities"
                x="820"
                y="438"
                fill="var(--am-text-muted)"
                fontSize="10"
              >
                Capabilities declared
              </text>
              <circle
                className="scene-agent-indicator"
                cx="934"
                cy="410"
                r="4"
                fill="var(--am-green)"
              />
            </g>
            <path
              className="scene-agent-connection"
              pathLength="1"
              d={AGENT_WIRE}
              stroke="var(--am-cyan)"
              strokeWidth="2"
            />
            {/* The scroll-driven packet: it carries the first signal across as
                you scroll, and fades into the card's own indicator on arrival. */}
            <circle className="scene-data-packet" r="4" fill="var(--am-green)" />
            {/* The settled state's traffic, on its own clock so the finished
                scene is never completely still. It runs from load and is only
                ever revealed by opacity, so it has nothing to switch on. */}
            <circle className="scene-data-loop" r="3.5" fill="var(--am-green)">
              <animateMotion dur="4.5s" repeatCount="indefinite" path={AGENT_WIRE} />
            </circle>
          </>
        )}
        {role === 'coordination' && <CoordinationScene />}
        {role === 'control' && (
          <>
            <Panel x={435} y={105} title="Task scope / AM-115" className="control-scope">
              <text x="19" y="75" fill="var(--am-green)" fontSize="12">
                ✓ src/payment.ts
              </text>
              <text x="19" y="103" fill="var(--am-amber)" fontSize="12">
                × .env — excluded
              </text>
              <text x="19" y="133" fill="var(--am-text-muted)" fontSize="10">
                Review before execution
              </text>
            </Panel>
            <path
              className="control-check-path"
              pathLength="1"
              d="M570 272V288C570 309 614 311 650 320"
              stroke="var(--am-cyan)"
              strokeWidth="1.5"
              strokeDasharray="4 7"
            />
            <path
              className="control-boundary-ghost"
              d="M748 92V500"
              stroke="var(--am-amber)"
              strokeWidth="1"
            />
            <path
              className="control-boundary"
              pathLength="1"
              d="M748 92V500"
              stroke="var(--am-amber)"
              strokeWidth="3"
            />
            <text
              className="control-boundary-label"
              x="764"
              y="116"
              fill="var(--am-amber)"
              fontSize="9"
              letterSpacing="2"
            >
              HUMAN CONTROL
            </text>
            <g className="scene-request">
              <rect
                x="0"
                y="0"
                width="160"
                height="58"
                rx="7"
                fill="#2a241b"
                stroke="var(--am-amber)"
              />
              <text x="14" y="19" fill="var(--am-text-muted)" fontSize="8" letterSpacing="1.3">
                AGENT ACTION
              </text>
              <text x="14" y="40" fill="var(--am-amber)" fontSize="12">
                deploy.request
              </text>
              <circle cx="146" cy="30" r="4" fill="var(--am-amber)" />
            </g>
            <g className="control-human-token">
              <circle cx="800" cy="190" r="23" fill="#172638" stroke="var(--am-purple)" />
              <path d="M800 178V191" stroke="#f8f5ec" strokeWidth="2" />
              <circle cx="800" cy="198" r="1.8" fill="#f8f5ec" />
              <text x="832" y="186" fill="var(--am-purple)" fontSize="9">
                DEV1.ETH
              </text>
              <text x="832" y="202" fill="var(--am-text-muted)" fontSize="8">
                owner decision
              </text>
            </g>
            <g className="control-approval-state" transform="translate(446 446)">
              <rect width="230" height="45" rx="7" fill="#151f29" stroke="var(--am-amber)" />
              <circle cx="17" cy="15" r="3" fill="var(--am-amber)" />
              <text x="29" y="18" fill="var(--am-amber)" fontSize="9" letterSpacing="1.1">
                ACTION PAUSED
              </text>
              <text x="17" y="34" fill="var(--am-technical-label)" fontSize="8">
                Owner decision required
              </text>
            </g>
          </>
        )}
        {role === 'identity' && (
          <>
            <g className="identity-wallet">
              <rect
                x="480"
                y="115"
                width="224"
                height="48"
                rx="9"
                fill="#101722"
                stroke="var(--am-purple)"
              />
              <circle cx="499" cy="139" r="5" fill="var(--am-purple)" />
              <text x="513" y="134" fill="var(--am-text-muted)" fontSize="8" letterSpacing="1.2">
                WALLET CONNECTED
              </text>
              <text x="513" y="149" fill="var(--am-text-on-dark)" fontSize="11">
                0x1a2b...9f3c
              </text>
            </g>
            <path
              className="identity-resolve-line"
              pathLength="1"
              d="M592 163V192"
              stroke="var(--am-purple)"
              strokeWidth="1.5"
            />
            <g className="identity-owner">
              <rect
                x="450"
                y="192"
                width="284"
                height="98"
                rx="10"
                fill="var(--am-ink-900)"
                stroke="var(--am-purple)"
              />
              <circle cx="477" cy="222" r="14" fill="#1b2034" stroke="var(--am-purple)" />
              <text x="473" y="227" fill="var(--am-purple)" fontSize="12">
                A
              </text>
              <text x="500" y="216" fill="var(--am-text-muted)" fontSize="8" letterSpacing="1.1">
                HUMAN OWNER
              </text>
              <text x="500" y="237" fill="var(--am-text-on-dark)" fontSize="14">
                dev1.eth
              </text>
              <g className="identity-verified">
                <circle cx="474" cy="266" r="3" fill="var(--am-green)" />
                <text x="484" y="269" fill="var(--am-green)" fontSize="8">
                  ENS VERIFIED
                </text>
                <text x="630" y="269" fill="var(--am-text-muted)" fontSize="8">
                  owns this identity
                </text>
              </g>
            </g>
            <path
              className="identity-branch-line"
              pathLength="1"
              d="M592 290V340"
              stroke="var(--am-purple)"
              strokeWidth="1.5"
            />
            <circle
              className="identity-branch-node"
              cx="592"
              cy="307"
              r="4"
              fill="var(--am-ink-950)"
              stroke="var(--am-purple)"
            />
            <g className="identity-agent">
              <rect
                x="470"
                y="340"
                width="326"
                height="152"
                rx="10"
                fill="var(--am-ink-900)"
                stroke="var(--am-border-dark)"
              />
              <path d="M470 384H796" stroke="var(--am-border-dark)" />
              <circle cx="493" cy="362" r="4" fill="var(--am-purple)" />
              <text x="506" y="358" fill="var(--am-text-muted)" fontSize="8" letterSpacing="1.1">
                AGENT SUBNAME
              </text>
              <text x="506" y="375" fill="var(--am-text-on-dark)" fontSize="12">
                codex.dev1.eth
              </text>
              <text x="681" y="366" fill="var(--am-purple)" fontSize="9">
                Orion / Codex
              </text>
              <g className="identity-capability identity-capability-1">
                <rect
                  x="490"
                  y="401"
                  width="70"
                  height="23"
                  rx="11.5"
                  fill="#17152a"
                  stroke="var(--am-purple)"
                />
                <text x="506" y="416" fill="var(--am-purple)" fontSize="8">
                  frontend
                </text>
              </g>
              <g className="identity-capability identity-capability-2">
                <rect
                  x="568"
                  y="401"
                  width="76"
                  height="23"
                  rx="11.5"
                  fill="#101d1a"
                  stroke="var(--am-green)"
                />
                <text x="584" y="416" fill="var(--am-green)" fontSize="8">
                  repo:read
                </text>
              </g>
              <g className="identity-capability identity-capability-3">
                <rect
                  x="652"
                  y="401"
                  width="92"
                  height="23"
                  rx="11.5"
                  fill="#101d1a"
                  stroke="var(--am-green)"
                />
                <text x="668" y="416" fill="var(--am-green)" fontSize="8">
                  task:claim
                </text>
              </g>
              <g className="identity-capability identity-capability-4">
                <rect
                  x="490"
                  y="435"
                  width="190"
                  height="25"
                  rx="12.5"
                  fill="#2a241b"
                  stroke="var(--am-amber)"
                />
                <circle cx="505" cy="447.5" r="3" fill="var(--am-amber)" />
                <text x="516" y="451" fill="var(--am-amber)" fontSize="8">
                  deploy:approval-required
                </text>
              </g>
              <text
                className="identity-scope-note"
                x="490"
                y="480"
                fill="var(--am-text-muted)"
                fontSize="8"
              >
                Scoped by dev1.eth · agent cannot expand permissions
              </text>
            </g>
          </>
        )}
        {role === 'developers' && (
          <>
            <g className="developer-editor">
              <rect
                x="475"
                y="105"
                width="245"
                height="126"
                rx="10"
                fill="var(--am-ink-900)"
                stroke="var(--am-border-dark)"
              />
              <path d="M475 141H720" stroke="var(--am-border-dark)" />
              <circle cx="492" cy="123" r="3" fill="var(--am-amber)" />
              <circle cx="503" cy="123" r="3" fill="var(--am-green)" />
              <text x="518" y="127" fill="var(--am-text-on-dark)" fontSize="10">
                Local change / src/checkout.ts
              </text>
              <text
                className="developer-code developer-code-1"
                x="493"
                y="164"
                fill="var(--am-text-muted)"
                fontSize="9"
              >
                01 const payment = validate(input)
              </text>
              <text
                className="developer-code developer-code-2"
                x="493"
                y="184"
                fill="var(--am-green)"
                fontSize="9"
              >
                02 + publishArtifact(payment)
              </text>
              <text
                className="developer-code developer-code-3"
                x="493"
                y="204"
                fill="var(--am-cyan)"
                fontSize="9"
              >
                03 save → Orion
              </text>
            </g>
            <path
              className="developer-editor-link"
              pathLength="1"
              d="M598 231V251C598 268 574 271 563 278"
              stroke="var(--am-cyan)"
              strokeWidth="1.5"
            />
            <path
              className="developer-event-spine"
              pathLength="1"
              d="M737 159V495H758"
              stroke="var(--am-border-dark)"
              strokeWidth="1.5"
            />
            {[
              ['TASK_PROPOSED', 'AM-115 · Orion / Codex', 'var(--am-purple)'],
              ['ARTIFACT_PUBLISHED', 'payment-api.json · v1', 'var(--am-cyan)'],
              ['REVIEW_REQUESTED', 'owner · dev1.eth', 'var(--am-amber)'],
            ].map(([label, detail, color], i) => {
              const y = 125 + i * 118;
              return (
                <g key={label} className={`developer-event developer-event-${i + 1}`}>
                  <path d={`M737 ${y + 34}H758`} stroke={color} strokeWidth="1.5" />
                  <circle cx="737" cy={y + 34} r="4" fill="var(--am-ink-950)" stroke={color} />
                  <rect
                    x="758"
                    y={y}
                    width="220"
                    height="69"
                    rx="8"
                    fill="var(--am-ink-900)"
                    stroke={color}
                  />
                  <text x="775" y={y + 27} fill={color} fontSize="10">
                    {label}
                  </text>
                  <text x="775" y={y + 49} fill="var(--am-text-muted)" fontSize="8">
                    {detail}
                  </text>
                </g>
              );
            })}
            <path
              className="developer-origin-link"
              pathLength="1"
              d="M642 351C690 351 696 159 737 159"
              stroke="var(--am-purple)"
              strokeWidth="1.5"
            />
            <g className="developer-trace">
              <rect
                x="758"
                y="468"
                width="220"
                height="67"
                rx="8"
                fill="#101722"
                stroke="var(--am-green)"
              />
              <circle cx="775" cy="490" r="3.5" fill="var(--am-green)" />
              <text x="787" y="493" fill="var(--am-green)" fontSize="8" letterSpacing="1.1">
                TRACE COMPLETE
              </text>
              <text x="775" y="511" fill="var(--am-technical-label)" fontSize="7.5">
                dev1.eth · Orion · AM-115
              </text>
              <text x="775" y="526" fill="var(--am-text-muted)" fontSize="7.5">
                payment-api.json · v1 · inspectable ✓
              </text>
            </g>
          </>
        )}
        {role === 'questions' && (
          <g className="scene-float-a">
            <path
              d="M330 110H595V225H435L398 259V225H330Z"
              fill="#182a37"
              stroke="var(--am-green)"
            />
            <text x="445" y="191" fill="var(--am-green)" fontSize="65">
              ?
            </text>
          </g>
        )}
        {role === 'closing' && (
          <>
            <path
              className="scene-draw"
              pathLength="1"
              d="M250 330C425 200 575 440 750 330"
              stroke="var(--am-cyan)"
              strokeWidth="3"
            />
            <g className="scene-mesh">
              <path
                d="M500 250L550 280V340L500 370L450 340V280Z"
                fill="#172739"
                stroke="var(--am-purple)"
                strokeWidth="2"
              />
              <text x="474" y="318" fill="var(--am-text-on-dark)" fontSize="15">
                MESH
              </text>
            </g>
          </>
        )}
      </svg>
      {role !== 'coordination' && (
        <div className="scene-character">
          <FlatCoder role={roles[role]} />
        </div>
      )}
      {role === 'closing' && (
        <div className="scene-character scene-character-second">
          <FlatCoder role="connect" />
        </div>
      )}
      <span className="scene-stage" />
    </div>
  );
}

/**
 * Chapter II's own clock, in seconds since the scene first came into view.
 *
 * The scene used to be scrubbed by scroll, which meant the reader's wheel was
 * also the animation's transport: scrolling back up un-drew the wire and faded
 * the agent card away again, and any stutter in the scroll was a stutter in the
 * illustration. It now assembles once, at its own even pace, and then stays
 * assembled and alive — the workshop is a live canvas rather than a scrubbable
 * film strip. Nothing it establishes is ever taken away again.
 */
const INTRO_SECONDS = 5.4;

export function paintWorkshop(scene: HTMLElement, seconds: number) {
  // The assembly maps onto the same 0-1 the ramps were already written
  // against, so their overlapping ranges are unchanged — only the thing
  // driving them is different.
  const progress = Math.min(1, seconds / INTRO_SECONDS);
  const at = (from: number, to: number) =>
    Math.max(0, Math.min(1, (progress - from) / (to - from)));
  // `soften` leaves and arrives at zero speed, `arrive` is the easeOutCubic
  // entering elements want, `travel` carries the wire across its long span.
  const soften = (t: number) => t * t * (3 - 2 * t);
  const arrive = (t: number) => 1 - (1 - t) ** 3;
  const travel = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const set = (name: string, value: number | string) =>
    scene.style.setProperty(`--agents-${name}`, String(value));

  set('settle', arrive(at(0, 0.2)));
  // The hands lead; each line of code follows a beat later and stays written.
  set('typing', arrive(at(0.12, 0.32)));
  set('line-1', soften(at(0.15, 0.26)));
  set('line-2', soften(at(0.2, 0.31)));
  set('line-3', soften(at(0.25, 0.36)));
  set('line-4', soften(at(0.3, 0.41)));
  set('caret-x', `${soften(at(0.15, 0.41)) * 205}px`);
  // The wire fades in while the last lines are still filling, so it grows out
  // of something already present rather than from its first pixel.
  set('wire', soften(at(0.3, 0.42)));
  set('connection', travel(at(0.35, 0.75)));
  // The card lifts under the arriving packet, then takes its border, then its
  // status: three ranges that overlap rather than fire in sequence.
  set('card', arrive(at(0.62, 0.82)));
  set('border', soften(at(0.7, 0.88)));
  set('response', soften(at(0.74, 0.92)));
  set('waiting', 1 - soften(at(0.72, 0.84)));
  set('ready', soften(at(0.78, 0.92)));
  // Once the link is established its traffic keeps running, for good.
  set('traffic', soften(at(0.86, 1)));
  // A very slow drift on the background circle, so the canvas is never
  // completely static even after everything has settled.
  scene.style.setProperty('--scene-progress', String(progress));
  set('drift', Math.sin(seconds * 0.21));

  scene
    .querySelectorAll<SVGSVGElement>('.flat-coder')
    .forEach((coder) => poseCoder(coder, progress, 'typing', seconds));

  const path = scene.querySelector<SVGPathElement>('.scene-agent-connection');
  const packet = scene.querySelector<SVGCircleElement>('.scene-data-packet');
  if (path && packet) {
    const point = path.getPointAtLength(path.getTotalLength() * travel(at(0.58, 0.86)));
    packet.setAttribute('cx', String(point.x));
    packet.setAttribute('cy', String(point.y));
    // It fades out into the card's own indicator as it lands, so the first
    // signal reads as received rather than as having vanished. After that the
    // looping packet on the wire carries the traffic.
    packet.style.opacity = String(at(0.62, 0.74) * (1 - at(0.84, 0.92)));
  }
  const caption = scene.querySelector('.scene-stage');
  if (caption && caption.textContent !== WORKSHOP_CAPTION) caption.textContent = WORKSHOP_CAPTION;
}
const WORKSHOP_CAPTION = 'HUMAN INPUT → LOCAL EDITOR → AGENT RESPONSE';

const range = (progress: number, start: number, end: number) =>
  Math.max(0, Math.min(1, (progress - start) / (end - start)));

function paintControlScene(scene: HTMLElement, progress: number) {
  const set = (name: string, value: number) =>
    scene.style.setProperty(`--control-${name}`, String(value));
  const settle = easeOut(range(progress, 0, 0.18));
  const travel = smoothStep(range(progress, 0.16, 0.76));
  const scope = smoothStep(range(progress, 0.34, 0.7));
  const boundary = smoothStep(range(progress, 0.54, 0.86));
  const approval = smoothStep(range(progress, 0.78, 0.98));
  const finalSettle = smoothStep(range(progress, 0.7, 0.88));
  set('settle', settle);
  set('travel', travel);
  set('scope', scope);
  set('boundary', boundary);
  set('approval', approval);
  set('human', smoothStep(range(progress, 0.62, 0.94)));
  set('path', smoothStep(range(progress, 0.38, 0.74)));
  set('notice', smoothStep(range(progress, 0.5, 0.66)));
  set('reach', smoothStep(range(progress, 0.56, 0.76)));
  set('press', smoothStep(range(progress, 0.8, 0.9)));

  const request = scene.querySelector<SVGGElement>('.scene-request');
  if (request) {
    const x = mix(388, 578, travel);
    const y = mix(330, 326, finalSettle);
    const scale = 1 + Math.sin(finalSettle * Math.PI) * 0.018;
    request.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  }
}

function paintControlAnimation(scene: HTMLElement, seconds: number) {
  const progress = Math.min(1, seconds / CONTROL_SECONDS);
  scene.dataset.controlProgress = String(progress);
  scene.style.setProperty('--scene-progress', String(progress));
  paintControlScene(scene, progress);
  scene
    .querySelectorAll<SVGSVGElement>('.flat-coder')
    .forEach((coder) => poseCoder(coder, 1, 'control', progress));
  const caption = scene.querySelector('.scene-stage');
  if (caption)
    caption.textContent =
      progress < 0.34
        ? 'AGENT REQUESTS A SENSITIVE ACTION'
        : progress < 0.78
          ? 'POLICY CHECKS THE REQUEST'
          : 'AUTONOMY STOPS · THE HUMAN DECIDES';
}

function paintIdentityAnimation(scene: HTMLElement, seconds: number) {
  const progress = Math.min(1, seconds / IDENTITY_SECONDS);
  const set = (name: string, value: number) =>
    scene.style.setProperty(`--identity-${name}`, String(value));
  set('wallet', easeOut(range(progress, 0, 0.2)));
  set('resolve-line', smoothStep(range(progress, 0.16, 0.34)));
  set('owner', easeOut(range(progress, 0.22, 0.42)));
  set('verified', smoothStep(range(progress, 0.34, 0.47)));
  set('branch', smoothStep(range(progress, 0.42, 0.62)));
  set('agent', easeOut(range(progress, 0.5, 0.68)));
  set('cap-1', easeOut(range(progress, 0.62, 0.72)));
  set('cap-2', easeOut(range(progress, 0.67, 0.77)));
  set('cap-3', easeOut(range(progress, 0.72, 0.82)));
  set('cap-4', easeOut(range(progress, 0.77, 0.88)));
  set('settled', smoothStep(range(progress, 0.84, 1)));
  scene.dataset.identityProgress = String(progress);
  scene.style.setProperty('--scene-progress', String(progress));
  scene
    .querySelectorAll<SVGSVGElement>('.flat-coder')
    .forEach((coder) => poseCoder(coder, 1, 'identity'));
  const caption = scene.querySelector('.scene-stage');
  if (caption)
    caption.textContent =
      progress < 0.22
        ? 'WALLET CONNECTED'
        : progress < 0.5
          ? 'DEV1.ETH · ENS VERIFIED'
          : progress < 0.8
            ? 'CODEX.DEV1.ETH · DERIVED FROM OWNER'
            : 'HUMAN-OWNED IDENTITY · AGENT-SCOPED PERMISSIONS';
}

function paintDevelopersAnimation(scene: HTMLElement, seconds: number) {
  const progress = Math.min(1, seconds / DEVELOPERS_SECONDS);
  const set = (name: string, value: number) =>
    scene.style.setProperty(`--developers-${name}`, String(value));
  set('editor', easeOut(range(progress, 0, 0.18)));
  set('code-1', smoothStep(range(progress, 0.08, 0.2)));
  set('code-2', smoothStep(range(progress, 0.15, 0.29)));
  set('code-3', smoothStep(range(progress, 0.23, 0.37)));
  set('editor-link', smoothStep(range(progress, 0.28, 0.42)));
  set('origin', smoothStep(range(progress, 0.34, 0.5)));
  set('spine', smoothStep(range(progress, 0.42, 0.86)));
  set('event-1', easeOut(range(progress, 0.4, 0.56)));
  set('event-2', easeOut(range(progress, 0.54, 0.7)));
  set('event-3', easeOut(range(progress, 0.68, 0.84)));
  set('trace', easeOut(range(progress, 0.82, 0.98)));
  scene.dataset.developersProgress = String(progress);
  scene.style.setProperty('--scene-progress', String(progress));
  scene
    .querySelectorAll<SVGSVGElement>('.flat-coder')
    .forEach((coder) => poseCoder(coder, 1, 'audit', Math.min(seconds, 3.2)));
  const caption = scene.querySelector('.scene-stage');
  if (caption)
    caption.textContent =
      progress < 0.34
        ? 'WRITE LOCALLY · SAVE TO ORION'
        : progress < 0.68
          ? 'STRUCTURED EVENTS APPEND TO THE TRACE'
          : progress < 0.86
            ? 'ARTIFACT AND REVIEW STAY LINKED'
            : 'OWNER · AGENT · TASK · ARTIFACT — INSPECTABLE';
}

export function paintScene(scene: HTMLElement, progress: number) {
  const role = scene.dataset.sceneRole as SceneRole;
  // Chapter II is a live canvas: it runs on its own clock rather than on the
  // reader's scroll position, so the scroll system leaves it alone entirely.
  if (role === 'agents' || role === 'control' || role === 'identity' || role === 'developers')
    return;
  scene.dataset.resolved = String(progress >= 0.8);
  scene.style.setProperty('--scene-progress', String(progress));
  scene.style.setProperty('--scene-first', String(Math.min(1, progress / 0.55)));
  scene.style.setProperty(
    '--scene-second',
    String(Math.max(0, Math.min(1, (progress - 0.4) / 0.6))),
  );
  scene
    .querySelectorAll<SVGSVGElement>('.flat-coder')
    .forEach((coder) => poseCoder(coder, progress, roles[role]));
  if (role === 'coordination') paintCoordinationScene(scene, progress);
  const parcel = scene.querySelector('.scene-parcel');
  if (parcel) {
    const p = Math.max(0, Math.min(1, (progress - 0.35) / 0.55));
    parcel.setAttribute(
      'transform',
      `translate(${530 + p * 265} ${445 - p * 175 - Math.sin(p * Math.PI) * 40})`,
    );
  }
  const captions: Partial<Record<SceneRole, string[]>> = {
    agents: ['WRITE LOCALLY', 'DECLARE CAPABILITIES', 'READY TO COLLABORATE'],
    coordination: ['DEPENDENCY MISSING', 'SCHEMA IN TRANSIT', 'WORK CAN CONTINUE'],
    control: ['INSPECT THE SCOPE', 'REQUEST REACHES THE BOUNDARY', 'THE HUMAN DECIDES'],
    identity: ['START WITH THE OWNER', 'LINK THE AGENT', 'MAKE RESPONSIBILITY VISIBLE'],
    developers: ['WRITE THE CONTRACT', 'FOLLOW THE EVENTS', 'BUILD SOMETHING TOGETHER'],
  };
  const caption = scene.querySelector('.scene-stage');
  // Chapter II returns above and captions itself from its own clock.
  if (caption)
    caption.textContent = captions[role]?.[progress < 0.33 ? 0 : progress < 0.75 ? 1 : 2] ?? '';
}
