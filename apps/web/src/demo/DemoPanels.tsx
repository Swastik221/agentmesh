import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Copy, ExternalLink, Pause, Play, RefreshCw, RotateCcw, SkipForward, Terminal as TerminalIcon, X } from 'lucide-react';
import { demoGateways } from './demo.gateways';
import { useDemo } from './DemoProvider';

export function DemoToolbar() {
  const { state, profile, profiles, replay, reset, switchProfile } = useDemo();
  return (
    <div className="demo-toolbar" aria-label="Demo controls">
      <span>DEMO MODE</span>
      {state.replay.playing ? (
        <button type="button" onClick={replay.pause}>
          <Pause size={11} /> Pause
        </button>
      ) : (
        <button type="button" onClick={replay.play}>
          <Play size={11} fill="currentColor" /> Resume
        </button>
      )}
      <button type="button" onClick={replay.next}>
        <SkipForward size={11} /> Next step
      </button>
      <button type="button" onClick={replay.restart}>
        <RotateCcw size={11} /> Restart
      </button>
      {state.replay.active && (
        <button type="button" onClick={replay.exit}>
          Exit replay
        </button>
      )}
      <label>
        Profile{' '}
        <select
          value={profile.id}
          onChange={(event) => switchProfile(event.target.value as 'anand' | 'swastik')}
        >
          {profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => void navigator.clipboard?.writeText('MESH-2026')}>
        <Copy size={11} /> Copy invite
      </button>
      <button type="button" onClick={() => window.open(location.href, '_blank', 'noopener')}>
        <ExternalLink size={11} /> Second tab
      </button>
      <button type="button" onClick={reset}>
        Reset data
      </button>
      <small>Step {state.replay.step} / 9</small>
    </div>
  );
}

export function TerminalPanel({ onClose }: { onClose(): void }) {
  const { state, runCommand } = useDemo(); const [agent, setAgent] = useState<'orion' | 'vega'>('orion'); const [history, setHistory] = useState<string[]>([]); const [historyIndex, setHistoryIndex] = useState(-1); const output = useRef<HTMLDivElement>(null);
  useEffect(() => { output.current?.scrollTo({ top: output.current.scrollHeight }); }, [agent, state.terminal]);
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = e.currentTarget; const input = form.elements.namedItem('command') as HTMLInputElement; if (!input.value.trim()) return; runCommand(agent, input.value); setHistory((current) => [...current, input.value]); setHistoryIndex(-1); input.value = ''; };
  return <section className="demo-panel demo-terminal" aria-label="Demo terminal"><header><div><TerminalIcon/> <b>Terminal</b><i/> connected</div><div><button className={agent === 'orion' ? 'is-active' : ''} onClick={() => setAgent('orion')}>Orion</button><button className={agent === 'vega' ? 'is-active' : ''} onClick={() => setAgent('vega')}>Vega</button><button aria-label="Copy terminal output" onClick={() => void navigator.clipboard?.writeText(state.terminal[agent].map((line) => line.text).join('\n'))}><Copy/></button><button aria-label="Close terminal" onClick={onClose}><X/></button></div></header><div className="demo-terminal__output" ref={output} role="log">{state.terminal[agent].map((line) => <p key={line.id} className={`is-${line.kind}`}>{line.text}</p>)}</div><form onSubmit={submit}><span>$</span><input name="command" autoFocus aria-label="Terminal command" autoComplete="off" placeholder="agentmesh help" onKeyDown={(event) => { if (event.key === 'ArrowUp' && history.length) { event.preventDefault(); const index = Math.min(history.length - 1, historyIndex + 1); setHistoryIndex(index); event.currentTarget.value = history[history.length - 1 - index]; } }}/></form></section>;
}

export function BrowserPanel({ onClose }: { onClose(): void }) {
  const { state, openBrowser, browserBack, browserForward } = useDemo(); const [address, setAddress] = useState(state.browser.history[state.browser.index]); const route = state.browser.history[state.browser.index]; const page = useMemo(() => demoGateways.browser.resolve(route, state), [route, state]);
  useEffect(() => { setAddress(route); }, [route]);
  return <section className="demo-panel demo-browser" aria-label="Internal demo browser"><header><button aria-label="Back" onClick={browserBack} disabled={state.browser.index === 0}><ArrowLeft/></button><button aria-label="Forward" onClick={browserForward} disabled={state.browser.index >= state.browser.history.length - 1}><ArrowRight/></button><button aria-label="Refresh" onClick={() => openBrowser(route)}><RefreshCw/></button><form onSubmit={(e) => { e.preventDefault(); openBrowser(address); }}><input value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Internal preview route"/></form><button aria-label="Close browser" onClick={onClose}><X/></button></header><nav>{['agentmesh://preview/checkout','agentmesh://artifact/payment-api','agentmesh://activity','agentmesh://task/AM-115'].map((item) => <button key={item} onClick={() => openBrowser(item)}>{item.split('/').pop()}</button>)}</nav><article><span>SAFE LOCAL PREVIEW</span><h2>{page.title}</h2><p>{page.body}</p>{page.code && <pre>{page.code}</pre>}</article></section>;
}
