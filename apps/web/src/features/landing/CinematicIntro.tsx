import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { FlatCoder, poseCoder } from './FlatCoder';
import { HeroWorkshop, MiniAgent } from './HeroWorkshop';
import './cinematic.css';

gsap.registerPlugin(ScrollTrigger);

type Box = { x: number; y: number; width: number; height: number };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function CinematicIntro() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = ref.current!;
    const landing = root.closest<HTMLElement>('.landing')!;
    const character = root.querySelector<SVGSVGElement>('.flat-coder')!;
    const workspace = root.querySelector<HTMLElement>('.intro-headline')!;
    const cards = [...root.querySelectorAll<HTMLElement>('.intro-agent')];
    const wires = [...root.querySelectorAll<SVGPathElement>('.intro-wire')];
    const emberWires = [...root.querySelectorAll<SVGPathElement>('.intro-wire-ember')];
    const borderRects = [...root.querySelectorAll<SVGRectElement>('.intro-border rect')];
    let coderBox: Box;
    let cardBoxes: Box[] = [];
    let terminalBoxes: Box[] = [];
    let destinations: Box[] = [];
    let frame = 0;
    let disposed = false;
    const media = gsap.matchMedia();
    const state = {
      clock: 0,
      reach: 0,
      draw: 0,
      ember: 0,
      emberTravel: 0,
      burstScale: 0,
      burstOpacity: 0,
      coder: 1,
      canvas: 0,
      reveal: 0,
      dock: 0,
      cards: 1,
      wires: 1,
    };

    const measure = () => {
      // Measurements are only taken at refresh/resize, never in the scrubbed frame loop.
      cards.forEach((card) => {
        card.style.transform = 'none';
      });
      const bounds = root.getBoundingClientRect();
      const local = (node: Element): Box => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x - bounds.x,
          y: rect.y - bounds.y,
          width: rect.width,
          height: rect.height,
        };
      };
      coderBox = local(character);
      cardBoxes = cards.map(local);
      terminalBoxes = cards.map((card) => local(card.querySelector('.mini-terminal')!));
      destinations = terminalBoxes.map((box, i) => ({
        ...box,
        x: box.x + (i ? -40 : 40),
        y: box.y - 35,
        width: box.width * 0.92,
        height: box.height * 0.92,
      }));
      cards.forEach((card, i) => {
        const svg = card.querySelector('.intro-border')!;
        svg.setAttribute('viewBox', `0 0 ${cardBoxes[i].width} ${cardBoxes[i].height}`);
        svg.querySelectorAll('rect').forEach((rect) => {
          rect.setAttribute('x', '1');
          rect.setAttribute('y', String(terminalBoxes[i].y - cardBoxes[i].y + 1));
          rect.setAttribute('width', String(terminalBoxes[i].width - 2));
          rect.setAttribute('height', String(terminalBoxes[i].height - 2));
        });
      });
    };
    const paint = () => {
      if (!coderBox) return;
      const progress = state.clock / 100;
      const complete = progress >= 0.9999;
      root.dataset.progress = String(progress);
      root.dataset.stage =
        progress < 0.42 ? 'reaching' : progress < 0.68 ? 'connection' : 'headline';
      root.dataset.complete = String(complete);
      landing.dataset.introComplete = String(complete);
      workspace.inert = !complete;
      workspace.setAttribute('aria-hidden', String(!complete));
      for (const [key, value] of Object.entries({
        coder: state.coder,
        canvas: state.canvas,
        cards: state.cards,
        'docked-opacity': 1 - state.cards,
      }))
        root.style.setProperty(`--intro-${key}`, String(value));
      workspace.style.clipPath = `circle(${state.reveal * 150}% at 50% 50%)`;
      const burst = root.querySelector<HTMLElement>('.intro-burst')!;
      burst.style.transform = `translate(-50%, -50%) scale(${state.burstScale})`;
      burst.style.opacity = String(state.burstOpacity);
      const hands = poseCoder(character, state.reach);
      hands.forEach((hand, i) => {
        const origin = {
          x: coderBox.x + (hand.x / 520) * coderBox.width,
          y: coderBox.y + (hand.y / 600) * coderBox.height,
        };
        const terminal = terminalBoxes[i];
        const end = {
          x: terminal.x + (i ? 0 : terminal.width) + (i ? -1 : 1) * state.reach * 24,
          y: terminal.y + terminal.height * 0.5 - state.reach * 12,
        };
        const direction = i ? 1 : -1;
        const d = `M${origin.x} ${origin.y}C${origin.x + direction * 65} ${origin.y - 25} ${end.x - direction * 65} ${end.y} ${end.x} ${end.y}`;
        wires[i].setAttribute('d', d);
        wires[i].style.strokeDashoffset = String(1 - state.draw);
        wires[i].style.opacity = String(state.wires);
        emberWires[i].setAttribute('d', d);
        emberWires[i].style.strokeDashoffset = String(-state.emberTravel);
        const card = cardBoxes[i];
        const target = destinations[i];
        const scaleX = mix(1, target.width / terminal.width, state.dock);
        const scaleY = mix(1, target.height / terminal.height, state.dock);
        const x =
          (target.x - card.x) * state.dock + (i ? -1 : 1) * state.reach * 24 * (1 - state.dock);
        const y =
          (target.y - card.y - (terminal.y - card.y) * scaleY) * state.dock -
          state.reach * 12 * (1 - state.dock);
        cards[i].style.transform = `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`;
      });
      const flicker = state.ember * (0.8 + 0.2 * Math.sin(state.emberTravel * 48));
      emberWires.forEach((path) => {
        path.style.opacity = String(flicker);
      });
      borderRects.forEach((rect) => {
        rect.style.opacity = String(flicker);
        rect.style.strokeDashoffset = String(-state.emberTravel);
      });
      // Only write when the wording actually changes: assigning the same text
      // sixty times a second is what made the terminal copy flicker while the
      // cards were moving.
      const write = (node: Element, value: string) => {
        if (node.textContent !== value) node.textContent = value;
      };
      root.querySelectorAll('.hero-agent-status').forEach((node) => {
        write(node, progress >= 0.55 ? 'connected' : 'ready');
      });
      root.querySelectorAll('.hero-agent-event').forEach((node, i) => {
        write(
          node,
          progress >= 0.75
            ? i
              ? 'received payment-api.json'
              : 'published payment-api.json'
            : 'awaiting shared connection',
        );
      });
      root.querySelectorAll('.hero-agent-result').forEach((node, i) => {
        write(
          node,
          progress >= 0.75
            ? i
              ? '✓ Dependency resolved'
              : '✓ Artifact shared'
            : '○ Local agent ready',
        );
      });
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
            clock: 100,
            reach: 1,
            draw: 1,
            coder: 0,
            canvas: 1,
            reveal: 1,
            dock: 1,
            cards: 0,
            wires: 0,
            ember: 0,
            burstOpacity: 0,
          });
          paint();
          return;
        }
        Object.assign(state, {
          clock: 0,
          reach: 0,
          draw: 0,
          ember: 0,
          emberTravel: 0,
          burstScale: 0,
          burstOpacity: 0,
          coder: 1,
          canvas: 0,
          reveal: 0,
          dock: 0,
          cards: 1,
          wires: 1,
        });
        const timeline = gsap.timeline({
          defaults: { ease: 'none' },
          onUpdate: paint,
          scrollTrigger: {
            id: 'agentmesh-intro',
            trigger: root,
            start: 'top top',
            end: () => `+=${innerHeight * (innerWidth < 700 ? 2.4 : 3.2)}`,
            pin: true,
            // Keep the camera fluid while letting the first wheel movement
            // visibly pull both agent workspaces toward the connection.
            scrub: 0.55,
            invalidateOnRefresh: true,
            anticipatePin: 1,
            onRefreshInit: measure,
            onRefresh: (self) => {
              root.dataset.scrollStart = String(self.start);
              root.dataset.scrollEnd = String(self.end);
              paint();
            },
          },
        });
        timeline
          .addLabel('reach', 0)
          .addLabel('connection', 42)
          .addLabel('workspace', 68)
          .addLabel('complete', 100)
          .to(state, { clock: 100, duration: 100 }, 0)
          .to(state, { reach: 1, duration: 42, ease: 'power1.out' }, 'reach')
          .to(state, { draw: 1, duration: 42 }, 'reach')
          .to(state, { ember: 1, duration: 2 }, 'connection')
          .to(state, { emberTravel: 1.9, duration: 24 }, 'connection')
          .to(state, { ember: 0, duration: 4 }, 64)
          .to(state, { burstScale: 1, duration: 22, ease: 'power2.out' }, 'workspace')
          .to(state, { burstOpacity: 0.9, duration: 5 }, 'workspace')
          .to(state, { burstOpacity: 0, duration: 16 }, 74)
          .to(state, { coder: 0, duration: 12 }, 80)
          .to(state, { wires: 0, duration: 10 }, 78)
          .to(state, { canvas: 1, reveal: 1, duration: 12, ease: 'power1.out' }, 88)
          .to(state, { dock: 1, duration: 28, ease: 'power1.inOut' }, 68)
          .to(state, { cards: 0, duration: 10 }, 82);
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
    document.fonts.ready.then(() => {
      if (!disposed) refresh();
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      media.revert();
      delete landing.dataset.introComplete;
    };
  }, []);

  return (
    <section
      ref={ref}
      id="top"
      className="mesh-intro"
      aria-label="Two coding agents connect through a developer and form a shared workspace"
    >
      <div className="intro-headline">
        <HeroWorkshop />
      </div>
      <div className="intro-coder">
        <FlatCoder />
      </div>
      <svg className="intro-wires" aria-hidden="true">
        <defs>
          <filter
            id="intro-ember-glow"
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[0, 1].map((i) => (
          <g key={i}>
            <path className="intro-wire" pathLength="1" />
            <path className="intro-wire-ember" pathLength="1" filter="url(#intro-ember-glow)" />
          </g>
        ))}
      </svg>
      {[
        ['Orion', 'Anand', 'Codex'],
        ['Vega', 'Swastik', 'Claude'],
      ].map(([name, owner, provider], i) => (
        <div key={name} className={`intro-agent intro-agent--${i ? 'right' : 'left'}`}>
          <MiniAgent name={name} owner={owner} provider={provider} secondary={!!i} progressive />
          <svg className="intro-border" aria-hidden="true">
            <rect rx="9" pathLength="1" filter="url(#intro-ember-glow)" />
            <rect className="intro-ember-core" rx="9" pathLength="1" />
          </svg>
        </div>
      ))}
      <div className="intro-burst" aria-hidden="true" />
    </section>
  );
}
