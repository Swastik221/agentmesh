import { ArrowUpRight, Terminal } from 'lucide-react';
export function MiniAgent({
  name,
  owner,
  provider,
  secondary = false,
  progressive = false,
}: {
  name: string;
  owner: string;
  provider: string;
  secondary?: boolean;
  progressive?: boolean;
}) {
  return (
    <div className={`mini-agent ${secondary ? 'mini-agent--vega' : ''}`}>
      <div className="mini-owner">
        <span className="owner-dot">{owner[0]}</span>
        {owner} <span>— demo / owner</span>
      </div>
      <div className="mini-terminal">
        <div className="mini-title">
          <Terminal size={15} />
          <strong>{name}</strong>
          <span>{provider}</span>
          <i />{' '}
          <span className={progressive ? 'hero-agent-status' : undefined}>
            {progressive ? 'ready' : 'connected'}
          </span>
        </div>
        <div className="mini-code">
          <span>agent.ready</span>
          <br />
          <b>↳</b> {secondary ? 'frontend / solidity' : 'backend / devops'}
          <br />
          <b>↳</b>{' '}
          <span className={progressive ? 'hero-agent-event' : undefined}>
            {progressive
              ? 'awaiting shared connection'
              : secondary
                ? 'received payment-api.json'
                : 'published payment-api.json'}
          </span>
          <br />
          <span className="mini-success">
            <span className={progressive ? 'hero-agent-result' : undefined}>
              {progressive
                ? '○ Local agent ready'
                : secondary
                  ? '✓ Dependency resolved'
                  : '✓ Artifact shared'}
            </span>{' '}
            <span className="terminal-caret">_</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** The product promise owns the first viewport before the connection story begins. */
export function HeroWorkshop() {
  return (
    <section id="top" className="landing-introduction" data-theme="dark" tabIndex={-1}>
      <div className="hero-copy">
        <div className="eyebrow">
          <span className="tiny-cross">✳</span> AGENTMESH / THE CONNECTED WORKSHOP
        </div>
        <h1>
          Your agents. <em>One team.</em>
        </h1>
        <p>
          Bring your coding agents into one shared workspace. Choose responsibilities, exchange
          dependencies, and keep your team in control.
        </p>
        <a className="landing-button primary" href="/signup">
          Explore the canvas <ArrowUpRight size={18} />
        </a>
        <span className="hero-caption">
          <i /> Interactive product preview. No wallet required.
        </span>
      </div>
    </section>
  );
}
