import type { ReactNode } from 'react';
import { Hexagon, ShieldCheck, Wallet, Loader2 } from 'lucide-react';
import { useWorkspace } from '../state/WorkspaceContext';

/**
 * Authentication gate for the product shell. When the user is not signed in
 * with SIWE, only the wallet connect + sign-in flow is rendered; the shell
 * (projects, agents, tasks, live state) is only reachable authenticated.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { authStatus, authError, connectWallet, loginWithSiwe } = useWorkspace();

  if (authStatus === 'authenticated') {
    return <>{children}</>;
  }

  const busy = authStatus === 'connecting' || authStatus === 'authenticating';

  return (
    <div className="auth-gate">
      <div className="auth-gate__card">
        <Hexagon size={34} strokeWidth={1.5} className="auth-gate__mark" aria-hidden="true" />
        <h1 className="auth-gate__title">AgentMesh</h1>
        <p className="auth-gate__subtitle">
          Multiplayer workspace for humans + AI agents. Sign in with your Ethereum wallet to
          verify your identity against the backend before entering the workspace.
        </p>

        {authError && <div className="form-error">{authError}</div>}

        {busy ? (
          <div className="auth-gate__busy">
            <Loader2 size={16} className="animate-spin" />
            {authStatus === 'connecting' ? 'Connecting wallet…' : 'Verifying signature…'}
          </div>
        ) : authStatus === 'connected_unauthenticated' ? (
          <button className="btn btn--primary auth-gate__cta" onClick={() => void loginWithSiwe()}>
            <ShieldCheck size={16} />
            Sign in with Ethereum
          </button>
        ) : (
          <button className="btn btn--primary auth-gate__cta" onClick={() => void connectWallet()}>
            <Wallet size={16} />
            Connect Wallet
          </button>
        )}

        <p className="auth-gate__hint">
          Requires MetaMask (or another injected EIP-1193 wallet) and the AgentMesh backend
          running on :3001. Authentication is verified server-side via SIWE.
        </p>
      </div>
    </div>
  );
}