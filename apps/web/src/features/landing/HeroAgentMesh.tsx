import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUpRight } from 'lucide-react';
import { FlatCoder, poseCoder } from './FlatCoder';
import { AGENT_MESH_CARDS, type AgentMeshCard } from './agentMeshData';
import './hero-agent-mesh.css';

gsap.registerPlugin(ScrollTrigger);

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

type Pt = { x: number; y: number };

/** Class per terminal line, so colours match the reference art. */
function lineClass(line: string): string {
  if (line.startsWith('$')) return 'is-cmd';
  if (line.startsWith('✓')) return 'is-ok';
  if (line.startsWith('↳')) return 'is-branch';
  if (line.startsWith('○')) return 'is-ready';
  return '';
}

export function HeroAgentMesh() {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = ref.current!;
    // The landing chrome (chapter rail) reveals itself once the intro is done.
    const landing = root.closest<HTMLElement>('.landing');
    const coders = [...root.querySelectorAll<SVGSVGElement>('.ham-coder .flat-coder')];
    const screens = [...root.querySelectorAll<HTMLElement>('.ham-coder__screen')];
    const cards = [...root.querySelectorAll<HTMLElement>('.ham-card')];
    const cableMain = [...root.querySelectorAll<SVGPathElement>('.ham-cable--main')];
    const cableGlow = [...root.querySelectorAll<SVGPathElement>('.ham-cable--glow')];
    const linkMain = [...root.querySelectorAll<SVGPathElement>('.ham-link--main')];
    const linkGlow = [...root.querySelectorAll<SVGPathElement>('.ham-link--glow')];
    const pulses = [...root.querySelectorAll<SVGCircleElement>('.ham-pulse')];
    const stage = root.querySelector<HTMLElement>('.ham-stage')!;
    const cablesSvg = root.querySelector<HTMLElement>('.ham-cables')!;
    const meshGroup = root.querySelector<HTMLElement>('.ham-mesh-group')!;
    const product = root.querySelector<HTMLElement>('.ham-product')!;
    const hint = root.querySelector<HTMLElement>('.ham-hint')!;

    // Per-card line nodes for progressive reveal.
    const cardLines = cards.map((card) => [...card.querySelectorAll<HTMLElement>('.ham-card__code p')]);
    const commands = AGENT_MESH_CARDS.map((c) => c.command);

    let cableStart: Pt[] = [];
    let homeCenter: Pt[] = [];
    let homeBottom: Pt[] = [];
    let slot: Pt[] = [];
    let frame = 0;
    let disposed = false;

    const state = {
      clock: 0,
      t0: 0, t1: 0, t2: 0, // command typing per coder
      a0: 0, a1: 0, a2: 0, // agent card appear (rise + line reveal)
      converge: 0,
      cableFade: 1,
      coderFade: 1,
      draw: 0,
      pulse: 0,
      meshScale: 1,
      meshOpacity: 1,
      product: 0,
      hint: 1,
    };

    const media = gsap.matchMedia();

    const measure = () => {
      cards.forEach((card) => {
        card.style.transform = 'none';
      });
      const bounds = root.getBoundingClientRect();
      const center = (node: Element): Pt => {
        const r = node.getBoundingClientRect();
        return { x: r.x - bounds.x + r.width / 2, y: r.y - bounds.y + r.height / 2 };
      };
      const bottom = (node: Element): Pt => {
        const r = node.getBoundingClientRect();
        return { x: r.x - bounds.x + r.width / 2, y: r.y - bounds.y + r.height };
      };
      cableStart = screens.map(center);
      homeCenter = cards.map(center);
      homeBottom = cards.map(bottom);
      const w = bounds.width;
      const h = bounds.height;
      // Central triangle: top apex, two lower corners.
      slot = [
        { x: w * 0.5, y: h * 0.31 },
        { x: w * 0.37, y: h * 0.6 },
        { x: w * 0.63, y: h * 0.6 },
      ];
    };

    const cardTransform = (i: number) => {
      const appear = [state.a0, state.a1, state.a2][i];
      const conv = state.converge;
      const opacity = clamp01(appear / 0.28);
      const riseY = (1 - smooth(clamp01(appear / 0.6))) * 42;
      const dx = (slot[i].x - homeCenter[i].x) * conv;
      const dy = (slot[i].y - homeCenter[i].y) * conv;
      const appearScale = mix(0.9, 1, smooth(clamp01(appear / 0.45)));
      const convScale = 1 - 0.18 * conv;
      const scale = appearScale * convScale;
      return { dx, dy: dy - riseY, scale, opacity };
    };

    const curveTo = (a: Pt, b: Pt, lift = 0.28) => {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * lift;
      return `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
    };

    const paint = () => {
      if (!homeCenter.length) return;
      const progress = state.clock / 100;
      root.dataset.progress = progress.toFixed(3);
      root.dataset.stage =
        progress < 0.15 ? 'idle'
        : progress < 0.35 ? 'typing'
        : progress < 0.55 ? 'rise'
        : progress < 0.75 ? 'converge'
        : progress < 0.9 ? 'mesh'
        : 'product';
      // Reveal the landing chapter rail once the intro reaches the product.
      if (landing) landing.dataset.introComplete = String(progress >= 0.97);

      // Coders: pose + typed command.
      const beat = state.clock * 0.05;
      const typeVals = [state.t0, state.t1, state.t2];
      coders.forEach((svg, i) => {
        poseCoder(svg, clamp01(typeVals[i]), 'typing', beat);
      });
      screens.forEach((screen, i) => {
        const t = typeVals[i];
        const cmd = commands[i];
        const shown = cmd.slice(0, Math.round(t * cmd.length));
        const caret = t > 0 && t < 1 ? '▋' : '';
        const value = t > 0 ? `$ ${shown}${caret}` : '$ _';
        if (screen.textContent !== value) screen.textContent = value;
      });
      stage.style.opacity = String(state.coderFade);

      // Cards: rise + converge + reveal.
      const currentCenter: Pt[] = [];
      cards.forEach((card, i) => {
        const { dx, dy, scale, opacity } = cardTransform(i);
        card.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        card.style.opacity = String(opacity);
        currentCenter[i] = { x: homeCenter[i].x + dx, y: homeCenter[i].y + dy };
        const appear = [state.a0, state.a1, state.a2][i];
        const shown = Math.round(clamp01((appear - 0.12) / 0.85) * cardLines[i].length);
        cardLines[i].forEach((p, li) => {
          p.dataset.hidden = li < shown ? '0' : '1';
        });
      });

      // Cables: laptop → card bottom (fade out as cards detach).
      cablesSvg.style.opacity = String(state.cableFade * state.coderFade);
      cards.forEach((_, i) => {
        const { dx, dy } = cardTransform(i);
        const end = { x: homeBottom[i].x + dx, y: homeBottom[i].y + dy };
        const start = cableStart[i];
        const d = curveTo(start, end, 0.12);
        const appear = [state.a0, state.a1, state.a2][i];
        const off = 1 - smooth(clamp01(appear / 0.6));
        [cableMain[i], cableGlow[i]].forEach((p) => {
          if (!p) return;
          p.setAttribute('d', d);
          p.style.strokeDashoffset = String(off);
        });
      });

      // Mesh group scale + opacity.
      meshGroup.style.transform = `scale(${state.meshScale})`;
      meshGroup.style.opacity = String(state.meshOpacity);

      // Links between the (moving) card centres.
      const pairs: [number, number][] = [[0, 1], [1, 2], [2, 0]];
      pairs.forEach(([a, b], li) => {
        const d = curveTo(currentCenter[a], currentCenter[b], 0.14);
        const off = 1 - clamp01(state.draw);
        const vis = clamp01(state.draw) * clamp01(state.converge * 1.4);
        [linkMain[li], linkGlow[li]].forEach((p) => {
          if (!p) return;
          p.setAttribute('d', d);
          p.style.strokeDashoffset = String(off);
          p.style.opacity = String(vis);
        });
        const pulse = pulses[li];
        if (pulse && linkMain[li]) {
          const len = linkMain[li].getTotalLength();
          if (len > 0 && vis > 0.05) {
            const frac = (state.pulse + li / 3) % 1;
            const pt = linkMain[li].getPointAtLength(len * frac);
            pulse.setAttribute('cx', String(pt.x));
            pulse.setAttribute('cy', String(pt.y));
            pulse.style.opacity = String(vis);
          } else {
            pulse.style.opacity = '0';
          }
        }
      });

      product.style.opacity = String(state.product);
      product.style.transform = `scale(${mix(0.94, 1, smooth(state.product))})`;
      hint.style.opacity = String(state.hint);
    };

    media.add(
      {
        reduced: '(prefers-reduced-motion: reduce)',
        animated: '(prefers-reduced-motion: no-preference)',
      },
      (context) => {
        measure();
        if (context.conditions?.reduced) {
          Object.assign(state, {
            clock: 100, t0: 1, t1: 1, t2: 1, a0: 1, a1: 1, a2: 1,
            converge: 1, cableFade: 0, coderFade: 0, draw: 1,
            meshScale: 1, meshOpacity: 0, product: 1, hint: 0,
          });
          paint();
          return;
        }
        Object.assign(state, {
          clock: 0, t0: 0, t1: 0, t2: 0, a0: 0, a1: 0, a2: 0,
          converge: 0, cableFade: 1, coderFade: 1, draw: 0, pulse: 0,
          meshScale: 1, meshOpacity: 1, product: 0, hint: 1,
        });
        const screens = innerWidth < 760 ? 4 : 4.6;
        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          onUpdate: paint,
          scrollTrigger: {
            id: 'agentmesh-hero',
            trigger: root,
            start: 'top top',
            end: () => `+=${innerHeight * screens}`,
            pin: true,
            scrub: 0.7,
            invalidateOnRefresh: true,
            anticipatePin: 1,
            onRefreshInit: measure,
            onRefresh: paint,
          },
        });

        tl.to(state, { clock: 100, duration: 100 }, 0)
          // Stage 0→1: the scroll hint fades, developers type (staggered).
          .to(state, { hint: 0, duration: 8 }, 8)
          .to(state, { t0: 1, duration: 11, ease: 'power1.inOut' }, 15)
          .to(state, { t1: 1, duration: 11, ease: 'power1.inOut' }, 18)
          .to(state, { t2: 1, duration: 11, ease: 'power1.inOut' }, 21)
          // Stage 2: cards rise on cables + reveal line by line (staggered).
          .to(state, { a0: 1, duration: 12, ease: 'power2.out' }, 35)
          .to(state, { a1: 1, duration: 12, ease: 'power2.out' }, 38)
          .to(state, { a2: 1, duration: 12, ease: 'power2.out' }, 41)
          // Stage 3: cables release, cards drift to centre, links draw in.
          .to(state, { cableFade: 0, duration: 10, ease: 'power1.in' }, 55)
          .to(state, { converge: 1, duration: 18, ease: 'power2.inOut' }, 55)
          .to(state, { coderFade: 0, duration: 15, ease: 'power2.inOut' }, 58)
          .to(state, { draw: 1, duration: 15, ease: 'power1.inOut' }, 60)
          // Stage 4: pulses flow, the mesh scales up.
          .to(state, { pulse: 6, duration: 40, ease: 'none' }, 60)
          .to(state, { meshScale: 1.16, duration: 13, ease: 'power1.inOut' }, 75)
          // Stage 5: mesh scales out + dissolves as the product surface arrives.
          .to(state, { meshScale: 1.9, duration: 12, ease: 'power2.in' }, 88)
          .to(state, { meshOpacity: 0, duration: 8, ease: 'power2.in' }, 88)
          .to(state, { product: 1, duration: 9, ease: 'power2.out' }, 91);

        paint();
      },
    );

    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        ScrollTrigger.refresh();
        measure();
        paint();
      });
    };
    document.fonts?.ready.then(() => {
      if (!disposed) refresh();
    });
    window.addEventListener('resize', refresh);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', refresh);
      media.revert();
      if (landing) delete landing.dataset.introComplete;
    };
  }, []);

  return (
    <section
      ref={ref}
      id="introduction"
      className="ham"
      aria-label="Three developers connect their coding agents into one shared workspace"
    >
      <div className="ham-bg" aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>

      <div className="ham-stage" aria-hidden="true">
        <div className="ham-table" />
        {AGENT_MESH_CARDS.map((card) => (
          <div key={card.id} className={`ham-coder ham-coder--${card.seat}`}>
            <FlatCoder role="typing" />
            <div className="ham-coder__screen">$ _</div>
          </div>
        ))}
      </div>

      <svg className="ham-cables" aria-hidden="true">
        <defs>
          <filter id="ham-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {AGENT_MESH_CARDS.map((card) => (
          <g key={card.id}>
            <path className={`ham-cable ham-cable--glow ham-cable--${card.accent}`} pathLength={1} />
            <path className={`ham-cable ham-cable--main ham-cable--${card.accent}`} pathLength={1} />
          </g>
        ))}
      </svg>

      <div className="ham-mesh-group">
        <svg className="ham-links" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <path className="ham-link ham-link--glow" pathLength={1} />
              <path className="ham-link ham-link--main" pathLength={1} />
            </g>
          ))}
          {[0, 1, 2].map((i) => (
            <circle key={`p${i}`} className="ham-pulse" r={3.4} />
          ))}
        </svg>

        {AGENT_MESH_CARDS.map((card) => (
          <AgentCardView key={card.id} card={card} />
        ))}
      </div>

      <a className="ham-product" href="/canvas" aria-label="Open the live AgentMesh workspace">
        <div className="ham-product__panel">
          <div className="ham-product__bar">
            <i /> AGENTMESH · SHARED WORKSPACE <span>{'AM-7X92'} · synced</span>
          </div>
          <div className="ham-product__stage">
            <div className="ham-product__intro">
              <span className="ham-product__eyebrow">✳ LIVE MESH / COORDINATED</span>
              <h3 className="ham-product__title">
                Three agents. <em>One shared plan.</em>
              </h3>
            </div>

            <div className="ham-product__mesh">
              <div className="ham-product__node ham-product__node--vega">
                <strong>Vega · Claude</strong>
                <span>frontend / solidity · swastik.eth</span>
              </div>
              <div className="ham-product__wire ham-product__wire--a" aria-hidden="true">
                <span className="ham-product__wire-label">synced</span>
                <i />
              </div>
              <div className="ham-product__node ham-product__node--orion">
                <strong>Orion · Codex</strong>
                <span>backend / devops · anand.eth</span>
              </div>
              <div className="ham-product__wire ham-product__wire--b" aria-hidden="true">
                <span className="ham-product__wire-label">synced</span>
                <i />
              </div>
              <div className="ham-product__node ham-product__node--nova">
                <strong>Nova · Gemini</strong>
                <span>testing / QA · dev.eth</span>
              </div>
            </div>

            <div className="ham-product__detail">
              <div className="ham-product__card ham-product__feed">
                <span className="ham-product__label">Live activity</span>
                <ul>
                  <li className="ham-ev ham-ev--claim">
                    <i /> <code>TASK_CLAIMED</code> <b>AM-114</b>
                    <em>Orion · frontend</em>
                  </li>
                  <li className="ham-ev ham-ev--artifact">
                    <i /> <code>ARTIFACT_PUBLISHED</code> <b>payment-api.json</b>
                    <em>Vega → Orion</em>
                  </li>
                  <li className="ham-ev ham-ev--approval">
                    <i /> <code>APPROVAL_GRANTED</code> <b>0.35 ETH</b>
                    <em>anand.eth</em>
                  </li>
                </ul>
              </div>
              <div className="ham-product__card ham-product__stats">
                <span className="ham-product__label">Workspace</span>
                <dl>
                  <div><dt>Agents</dt><dd>3 <span>synced</span></dd></div>
                  <div><dt>Owners</dt><dd>2 <span>online</span></dd></div>
                  <div><dt>Tasks</dt><dd>4 <span>active</span></dd></div>
                  <div><dt>Artifacts</dt><dd>1 <span>shared</span></dd></div>
                </dl>
              </div>
            </div>

            <span className="ham-product__cta">
              Open the live canvas <ArrowUpRight size={15} />
            </span>
          </div>
        </div>
      </a>

      <div className="ham-hint" aria-hidden="true">
        <i /> SCROLL TO CONNECT
      </div>
    </section>
  );
}

function AgentCardView({ card }: { card: AgentMeshCard }) {
  return (
    <div className={`ham-card ham-card--${card.seat} ham-card--${card.accent}`}>
      <div className="ham-card__inner">
        <div className="ham-card__owner">
          <i>{card.owner[0].toUpperCase()}</i>
          {card.owner} <small>— demo / owner</small>
        </div>
        <div className="ham-card__title">
          <strong>{card.name}</strong>
          <span>{card.provider}</span>
          <b /> <em>ready</em>
        </div>
        <div className="ham-card__code">
          {card.lines.map((line, i) => (
            <p key={i} className={lineClass(line)} data-hidden="1">
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
