import { useEffect, useMemo } from 'react';
import { ShieldCheck, Wallet, Loader2, Check } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import './sign-in.css';

function isSafeInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

function navigate(path: string) {
  window.location.href = path;
}

/**
 * Real sign in entry for Live Mode. No `useDemo`, no demo fixtures, no shared
 * layout with the demo `Header` or `/canvas`: just the real wallet connect +
 * SIWE flow from `useAuth`, the same hook `WalletAuthButton` runs on. This
 * page calls `useAuth` itself rather than embedding `WalletAuthButton`: the
 * hook holds its own local state with nothing shared between instances, so
 * two separate calls to it (one here to watch `status`, one inside that
 * component to drive the click handlers) would never see each other's
 * updates. Calling it once and rendering the button states inline keeps the
 * signing implementation itself singular (only `useAuth.ts` talks to a
 * wallet or the SIWE endpoints); only the presentation is page specific.
 *
 * `LiveRouteGuard` redirects an unauthenticated user here with `?next=` set to
 * the route they were denied. Once `status` reports `authenticated`, this
 * page sends them on to `next` (a real cookie session is set by then, so the
 * guard they land back on passes on its own next real `GET /auth/me`, no
 * reload). `next` is attacker controlled (it's a query string), so it only
 * gets used when it looks like an internal path; anything else falls back to
 * `/workspaces`.
 */
export function SignInPage() {
  const { status, error, connectWallet, loginWithSiwe } = useAuth();

  const next = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('next');
    return raw && isSafeInternalPath(raw) ? raw : '/workspaces';
  }, []);

  useEffect(() => {
    if (status === 'authenticated') navigate(next);
  }, [status, next]);

  return (
    <div className="signin-page">
      <div className="signin-card">
        <ShieldCheck size={22} />
        <h1>Sign in to AgentMesh</h1>
        <p>Connect a wallet and sign a message to open your real workspace. No transaction, no gas.</p>
        <div className="signin-card__action">
          {status === 'authenticated' ? (
            <span className="signin-status signin-status--ok"><Check size={14} /> Signed in, opening your workspace...</span>
          ) : status === 'connected_unauthenticated' ? (
            <button type="button" className="signin-button" onClick={() => void loginWithSiwe()}>
              <ShieldCheck size={14} /> Sign In with Ethereum
            </button>
          ) : status === 'connecting' || status === 'authenticating' ? (
            <span className="signin-status"><Loader2 size={14} className="signin-spin" /> {status === 'connecting' ? 'Connecting wallet...' : 'Verifying signature...'}</span>
          ) : (
            <>
              {error && <p className="signin-error" role="alert">{error}</p>}
              <button type="button" className="signin-button signin-button--secondary" onClick={() => void connectWallet()}>
                <Wallet size={14} /> Connect Wallet
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
