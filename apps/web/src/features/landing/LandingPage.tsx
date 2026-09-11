import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  Code2,
  Hexagon,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { getAppMode } from '../../config/env';
import { artifact, chapters, faqs, features, repository } from './landing.content';
import { HeroWorkshop, MiniAgent } from './HeroWorkshop';
import './landing.css';
import './cinematic.css';
import './story-scenes.css';
import './shared-canvas.css';
import './coordination-scene.css';
import { paintChapter, useScrollScene } from './useScrollScene';
import { ChapterScene, sceneCopy, type SceneRole } from './ChapterScene';
import { ScrollWorkspace } from './ScrollWorkspace';
import { HeroAgentMesh } from './HeroAgentMesh';
function Chapter({
  id,
  children,
  dark = false,
  line,
  description,
}: {
  id: string;
  children: ReactNode;
  dark?: boolean;
  line: string;
  description: string;
}) {
  const scrollRef = useScrollScene<HTMLElement>(paintChapter);
  const chapter = chapters.find((item) => item[0] === id)!;
  return (
    <section
      id={id}
      ref={scrollRef}
      className={`landing-chapter ${dark ? 'chapter-dark' : 'chapter-paper'}`}
      data-theme={dark ? 'dark' : 'paper'}
    >
      <div className="chapter-inner">
        <div className="chapter-runway">
          <div className={`chapter-cover chapter-cover--${id} story-cover`}>
            <ChapterScene role={id as SceneRole} />

            <div className="chapter-heading">
              <span className="eyebrow">
                CHAPTER {chapter[2]} /{' '}
                {id === 'coordination' ? 'COORDINATION' : 'THE CONNECTED WORKSHOP'}
              </span>
              <h2>
                {chapter[1]}
                <sup>{chapter[2]}</sup>
              </h2>
            </div>
            <div className="chapter-cover-line">
              <h3>{line}</h3>
              <span className="eyebrow">{sceneCopy[id as SceneRole]}</span>
            </div>
            <span className="cover-figure">FIG. {chapter[2]} / A WORKSHOP IN MOTION</span>
          </div>
        </div>
        <p className="chapter-description">{description}</p>
        {children}
      </div>
    </section>
  );
}
function ControlPreview() {
  const [action, setAction] = useState('Read task files');
  const [decision, setDecision] = useState('');
  return (
    <div className="control-preview" data-scroll-visual>
      <div>
        <span className="eyebrow">01 / LOCAL WORKSPACE</span>
        <h3>Permission is a boundary.</h3>
        <p>Choose a request to explore the planned policy.</p>
        <div className="request-list">
          {['Read task files', 'Read .env', 'Request paid scan'].map((item) => (
            <button
              key={item}
              aria-pressed={action === item}
              onClick={() => {
                setAction(item);
                setDecision('');
              }}
            >
              {item}
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      </div>
      <div className="permission-card">
        <ShieldCheck size={26} />
        <span className="eyebrow">{features.control.publicDescription}</span>
        <h3>
          {action === 'Read task files'
            ? 'Within the task scope.'
            : action === 'Read .env'
              ? 'Access denied.'
              : decision || 'A human has the final say.'}
        </h3>
        <p>
          {action === 'Read task files'
            ? 'Allowed in this simulation: src/payment.ts and the task schema.'
            : action === 'Read .env'
              ? 'Secret files are excluded from the simulated task scope. No file was read.'
              : 'Orion · Anand — demo · AM-115 / Code scan / Limit: 1 test unit / File: payment-api.json / Expires: 5 demo minutes.'}
        </p>
        {action === 'Request paid scan' && !decision && (
          <div className="button-row">
            <button onClick={() => setDecision('Demo approved. No service called.')}>
              Simulate approval
            </button>
            <button onClick={() => setDecision('Demo rejected. Action blocked.')}>
              Simulate rejection
            </button>
          </div>
        )}
        <small>No keys, signatures, payments, or external actions.</small>
      </div>
      <p className="sr-only" aria-live="polite">
        {decision}
      </p>
    </div>
  );
}
export default function LandingPage() {
  const [menu, setMenu] = useState(false);
  const [active, setActive] = useState('top');
  const [theme, setTheme] = useState('dark');
  const [agent, setAgent] = useState('Orion');
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.title = 'AgentMesh — Your agents. One team.';
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            setActive(entry.target.id);
            setTheme((entry.target as HTMLElement).dataset.theme ?? 'dark');
          }
      },
      { rootMargin: '-15% 0px -65% 0px' },
    );
    document
      .querySelectorAll('.landing section[id]')
      .forEach((section) => observer.observe(section));
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(false);
        menuButton.current?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as globalThis.Node)) setMenu(false);
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    if (location.hash)
      requestAnimationFrame(() =>
        document.getElementById(location.hash.slice(1))?.scrollIntoView(),
      );
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);
  const links = chapters.map(([id, label, numeral]) => (
    <a
      href={id === 'workspace' ? '/canvas' : `#${id}`}
      key={id}
      aria-current={active === id ? 'location' : undefined}
      onClick={() => setMenu(false)}
    >
      <span>{label}</span>
      <span>{numeral}</span>
    </a>
  ));
  return (
    <div className="landing">
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>
      <header className={`landing-header header-${theme}`}>
        <a href="#top" className="landing-brand" aria-label="AgentMesh home">
          <Hexagon size={27} strokeWidth={1.5} />
          <strong>AgentMesh</strong>
        </a>
        <span className="brand-subtitle">Multiplayer agent workspace</span>
        <div className="landing-nav" ref={menuRoot}>
          <button
            ref={menuButton}
            aria-expanded={menu}
            aria-controls="explore-menu"
            onClick={() => setMenu(!menu)}
          >
            Explore {menu ? <X size={15} /> : <ChevronDown size={15} />}
          </button>
          {menu && (
            <nav id="explore-menu" className="explore-menu" aria-label="Explore chapters">
              {links}
            </nav>
          )}
        </div>
        <a className="header-github" href={repository}>
          <Code2 size={16} /> GitHub <ArrowUpRight size={14} />
        </a>
        <a className="landing-button primary" href="/signup">
          Explore demo <ArrowUpRight size={16} />
        </a>
      </header>
      <nav
        className={`chapter-rail rail-${theme} ${active === 'top' || active === 'introduction' || active === 'workspace' ? 'rail-hidden' : ''}`}
        aria-label="Chapters"
      >
        <span className="eyebrow">THE WORKSHOP</span>
        {links}
        <a className="rail-top" href="#top">
          Back to top ↑
        </a>
      </nav>
      <main id="main">
        <HeroWorkshop />
        <HeroAgentMesh />
        <ScrollWorkspace />
        <Chapter
          id="agents"
          line="Different tools. Shared direction."
          description="Each developer brings their own coding agent and local setup. AgentMesh coordinates the work without becoming another model provider."
        >
          <div className="agents-showcase" data-scroll-visual>
            <button
              className={agent === 'Orion' ? 'selected-agent' : ''}
              onClick={() => setAgent('Orion')}
              aria-pressed={agent === 'Orion'}
            >
              <MiniAgent name="Orion" owner="Anand" provider="Codex" />
            </button>
            <div className="agent-bridge">
              <Hexagon />
              <span>ONE MESH</span>
            </div>
            <button
              className={agent === 'Vega' ? 'selected-agent' : ''}
              onClick={() => setAgent('Vega')}
              aria-pressed={agent === 'Vega'}
            >
              <MiniAgent name="Vega" owner="Swastik" provider="Claude" secondary />
            </button>
          </div>
          <div className="agent-inspector">
            <span>
              ↳ {agent} /{' '}
              {agent === 'Orion' ? 'Anand · backend / devops' : 'Swastik · frontend / solidity'}
            </span>
            <span>Task-scoped context · planned adapter</span>
          </div>
          <p className="readiness">{features.adapters.publicDescription}</p>
          <div className="detail-columns" data-scroll-visual>
            {[
              ['01', 'Keep your tools', 'Your editor and local agent session remain yours.'],
              ['02', 'Declare capabilities', 'Give the coordinator useful assignment signals.'],
              [
                '03',
                'Join one workspace',
                'Share project context deliberately, not entire private sessions.',
              ],
            ].map(([number, title, copy]) => (
              <div key={number}>
                <span className="eyebrow">{number} /</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </Chapter>
        <Chapter
          id="coordination"
          line="Choose your work. Let dependencies find their way."
          description="A coordinator proposes bounded tasks. Developers choose preferred work; eligible unclaimed tasks can be assigned after a timeout. Agents exchange the artifacts they need to continue."
        >
          <div className="coordination-layout">
            <div>
              <span className="eyebrow">FROM INTENT TO ARTIFACT</span>
              <ol className="workflow-list" data-scroll-visual>
                <li>
                  <strong>Choose a responsibility</strong>
                  <p>Anand chooses AM-114 for Orion’s frontend capability.</p>
                </li>
                <li>
                  <strong>Make the assignment explainable</strong>
                  <p>Swastik chooses AM-115 for Vega’s backend capability.</p>
                </li>
                <li>
                  <strong>Unblock the next agent</strong>
                  <p>Vega publishes the schema. Orion receives it and continues.</p>
                </li>
              </ol>
              <a className="text-link" href={getAppMode() === 'live' ? '/signin' : '/login'}>
                Watch the agents coordinate <ArrowUpRight size={17} />
              </a>
            </div>
            <div className="handoff-diagram" data-scroll-visual>
              <span className="eyebrow">ARTIFACT HANDOFF / ILLUSTRATIVE</span>
              <div className="handoff-agent">
                <Terminal size={20} />
                <strong>Vega</strong>
                <span>API / backend · Swastik</span>
              </div>
              <div className="handoff-line">
                ↓ <span>publishes</span>
              </div>
              <div className="schema-paper">
                <span>
                  {'{ }'} JSON SCHEMA <small>v1</small>
                </span>
                <h3>payment-api.json</h3>
                <p>
                  One explicit dependency.
                  <br />
                  The context the next agent needs.
                </p>
              </div>
              <div className="handoff-line">
                ↓ <span>receives & resumes</span>
              </div>
              <div className="handoff-agent">
                <Terminal size={20} />
                <strong>Orion</strong>
                <span>identity / frontend · Anand</span>
              </div>
            </div>
          </div>
          <details className="event-details">
            <summary>
              Inspect the illustrative handoff event <span>+</span>
            </summary>
            <pre>
              {JSON.stringify(
                {
                  type: 'ARTIFACT_PUBLISHED',
                  actor: 'vega',
                  owner: 'swastik-demo',
                  taskId: 'AM-115',
                  artifact: 'payment-api.json',
                  consumedBy: 'orion',
                  unblocks: 'AM-114',
                },
                null,
                2,
              )}
            </pre>
          </details>
        </Chapter>
        <Chapter
          id="control"
          dark
          line="Autonomy has boundaries."
          description="Task-scoped access and approval checkpoints are part of the design. Sensitive actions should stop at an enforceable boundary, with the human owner in control."
        >
          <ControlPreview />
          <div className="detail-columns" data-scroll-visual>
            {[
              ['Scoped files', 'Task source files allowed. Secret files excluded.'],
              [
                'Reviewed actions',
                'Merge, deploy, or spend requests need applicable authorization.',
              ],
              ['Clear attribution', 'Keep the owner, agent, task, and decision together.'],
            ].map(([title, copy]) => (
              <div key={title}>
                <h3>{title}</h3>
                <p>{copy}</p>
                <small>Planned control</small>
              </div>
            ))}
          </div>
          <details className="event-details">
            <summary>
              What does real enforcement require? <span>+</span>
            </summary>
            <p>
              Keeping a key local does not automatically make it inaccessible to a local agent.
              Actual protection requires process/filesystem isolation or a brokered credential path,
              plus tested enforcement. These preview controls do not implement that boundary.
            </p>
          </details>
        </Chapter>
        <Chapter
          id="identity"
          line="Know the agent. Know its owner."
          description="Connect agent identities to human owners. ENS-backed names and explicit policy references can make responsibility easier to inspect."
        >
          <div className="identity-path" data-scroll-visual>
            <div>
              <span className="identity-monogram">A</span>
              <h3>Anand — demo</h3>
              <p>Human owner</p>
            </div>
            <span className="identity-arrow">→</span>
            <div className="identity-record">
              <Hexagon />
              <span>orion.example.eth</span>
              <small>Illustrative name · no ownership claim</small>
              <hr />
              <p>
                Agent: Orion
                <br />
                Owner: Anand — demo
                <br />
                Policy: task-scoped access (planned)
              </p>
            </div>
            <span className="identity-arrow">→</span>
            <div>
              <ShieldCheck size={38} />
              <h3>Explicit policy</h3>
              <p>Enforced by the local executor</p>
            </div>
          </div>
          <p className="readiness">
            {features.identity.publicDescription}. Identity records alone do not protect local
            files.
          </p>
          <div className="payment-flow" data-scroll-visual>
            <div>
              <span className="eyebrow">OPTIONAL HEDERA PAYMENT DESIGN</span>
              <p>{features.payments.publicDescription}</p>
            </div>
            <p>
              Request <span>→</span> Quote <span>→</span> Approval <span>→</span> Receipt{' '}
              <span>→</span> Artifact
            </p>
          </div>
        </Chapter>
        <Chapter
          id="developers"
          dark
          line="Inspectable by design."
          description="Follow structured events, inspect artifacts, and understand how tasks move between agents. Build on the protocol instead of relaying messages by hand."
        >
          <div className="developer-split" data-scroll-visual>
            <div className="code-panel">
              <div>
                <WindowLabel /> <span>event.json / illustrative</span>
              </div>
              <pre>{JSON.stringify(artifact, null, 2)}</pre>
            </div>
            <div className="developer-links">
              <a href={`${repository}/tree/main/packages/agent-protocol`}>
                <span>
                  <small>01 / PROTOCOL</small>Explore the message contract
                </span>
                <ArrowUpRight />
              </a>
              <a href={`${repository}#installation`}>
                <span>
                  <small>02 / SETUP</small>Run the project locally
                </span>
                <ArrowUpRight />
              </a>
              <a href={repository}>
                <span>
                  <small>03 / OPEN SOURCE</small>Build with us on GitHub
                </span>
                <ArrowUpRight />
              </a>
            </div>
          </div>
          <div className="setup-strip" data-scroll-visual>
            <span className="eyebrow">INTENDED WORKFLOW</span>
            <p>
              Create workspace <ArrowRight size={15} /> Pair local adapter <ArrowRight size={15} />{' '}
              Choose task <ArrowRight size={15} /> Review artifact
            </p>
          </div>
        </Chapter>
        <EndScene id="faq" className="landing-chapter chapter-paper" theme="paper">
          <div className="chapter-inner faq-layout" data-scroll-visual>
            <div>
              <span className="eyebrow">A LITTLE MORE CONTEXT</span>
              <h2>
                Good
                <br />
                <em>questions.</em>
              </h2>
              <ChapterScene role="questions" />
            </div>
            <div>
              {faqs.map(([question, answer]) => (
                <details className="faq-item" key={question}>
                  <summary>
                    {question}
                    <span>+</span>
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </EndScene>
        <EndScene id="start" className="landing-closing" theme="dark">
          <ChapterScene role="closing" />
          <Hexagon size={42} strokeWidth={1} />
          <span className="eyebrow">INDEPENDENT BY DESIGN. CONNECTED BY CHOICE.</span>
          <h2>
            Bring your agents
            <br />
            <em>together.</em>
          </h2>
          <p>Turn separate coding sessions into coordinated work.</p>
          <div className="button-row">
            <a className="landing-button primary" href="/signup">
              Explore demo <ArrowUpRight size={18} />
            </a>
            <a className="text-link" href={repository}>
              View source <ArrowUpRight size={18} />
            </a>
          </div>
        </EndScene>
      </main>
      <footer className="landing-footer">
        <a className="landing-brand" href="#top">
          <Hexagon size={22} />
          <strong>AgentMesh</strong>
        </a>
        <span>© {new Date().getFullYear()} AgentMesh</span>
        <a href="/canvas">Workspace shell ↗</a>
        <a href={`${repository}#readme`}>Documentation ↗</a>
        <a href={repository}>GitHub ↗</a>
        <span>Made for working together.</span>
      </footer>
    </div>
  );
}
function WindowLabel() {
  return (
    <span className="window-label" aria-hidden="true">
      ● ● ●
    </span>
  );
}

function EndScene({
  id,
  className,
  theme,
  children,
}: {
  id: string;
  className: string;
  theme: string;
  children: ReactNode;
}) {
  const ref = useScrollScene<HTMLElement>(paintChapter);
  return (
    <section id={id} className={className} data-theme={theme} ref={ref}>
      {children}
    </section>
  );
}
