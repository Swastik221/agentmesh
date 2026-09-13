import { useState } from 'react';
import { Plug, Copy, Check } from 'lucide-react';
import {
  createAgentConnectToken,
  type AgentConnectToken,
} from '../../adapters/live/agent.adapter';
import { envConfig } from '../../config/env';

export interface AgentConnectPanelProps {
  agentId: string;
  agentName: string;
}

/**
 * The missing half of agent onboarding.
 *
 * Registering an agent only ever created a database row: nothing in the product
 * told a user how to actually connect the process, and the browser session is
 * httpOnly so no UI could surface a usable credential. This mints a real,
 * short-lived, agent-scoped connect token and shows the exact command to run.
 *
 * The token is shown once because that is all the server returns. Nothing here
 * pretends the agent is connected: the roster's ONLINE state is driven by the
 * real handshake, not by this panel.
 */
export function AgentConnectPanel({ agentId, agentName }: AgentConnectPanelProps) {
  const [issued, setIssued] = useState<AgentConnectToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The CLI is not published to npm, so `npx agentmesh` 404s. `agentmesh` is
  // instead a real command on PATH on this machine (a local symlink to the
  // built binary, the same effect `npm publish` + a global install would have
  // once the package ships), so this is genuinely paste-and-run from any
  // directory, not just the repo root.
  const command = issued
    ? `agentmesh connect --workspace ${issued.projectId} --agent ${issued.agentId} --connect-token ${issued.token} --url ${envConfig.apiUrl}`
    : '';

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      setIssued(await createAgentConnectToken(agentId));
    } catch (reason) {
      // The real server message, never a friendly substitute.
      setError(reason instanceof Error ? reason.message : 'Unable to issue a connect token.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard unavailable. Select the command and copy it manually.');
    }
  };

  return (
    <div className="agent-connect-panel">
      {!issued ? (
        <button type="button" className="agent-connect-panel__btn" onClick={() => void issue()} disabled={busy}>
          <Plug size={13} /> {busy ? 'Issuing token…' : 'Connect this agent'}
        </button>
      ) : (
        <div className="agent-connect-panel__issued">
          <p className="agent-connect-panel__hint">
            Paste this in any terminal to bring {agentName} online. Once connected, type
            a prompt at its <code>agentmesh&gt;</code> line and press Enter — it becomes a
            real task this agent runs immediately. Token expires at{' '}
            {new Date(issued.expiresAt).toLocaleTimeString()}.
          </p>
          <div className="agent-connect-panel__cmd">
            <code>{command}</code>
            <button type="button" onClick={() => void copy()} aria-label="Copy connect command">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <button type="button" className="agent-connect-panel__link" onClick={() => setIssued(null)}>
            Issue a new token
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="agent-connect-panel__error">
          {error}
        </p>
      )}
    </div>
  );
}
