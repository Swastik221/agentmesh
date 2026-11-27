import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { authSessionService } from '../services/auth-session';
import { SignInPage } from '../pages/SignIn/SignInPage';
import { WorkspacesPage } from '../pages/Workspace/WorkspacesPage';
import { SESSION_ENDED_EVENT } from '../services/api-client';
import { closeAllWorkspaceRealtime } from '../hooks/useWorkspaceRealtime';
import { isMisconfiguredDeployment } from '../config/env';

const CanvasApp = lazy(() => import('../App'));
const LandingPage = lazy(() => import('../features/landing/LandingPage'));

export function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function isSafeInternalPath(path: string): boolean {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    !path.includes('http:') &&
    !path.includes('https:')
  );
}

type LiveGuardState = 'checking' | 'authenticated' | 'unauthenticated' | 'error';

export function RouteGuard({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState<LiveGuardState>('checking');
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    setGuard('checking');
    setError('');
    const session = await authSessionService.fetchSession();
    if (session.authenticated) {
      setGuard('authenticated');
    } else if (session.status === 'error') {
      setError(session.error || 'Could not reach the authentication service.');
      setGuard('error');
    } else {
      setGuard('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (guard !== 'unauthenticated') return;
    const next = location.pathname + location.search;
    navigate(`/signin?next=${encodeURIComponent(next)}`);
  }, [guard]);

  if (guard === 'authenticated') return <>{children}</>;
  if (guard === 'error') {
    return (
      <div className="demo-route-loading" role="alert">
        <p>{error}</p>
        <button type="button" className="demo-secondary" onClick={() => void check()}>
          <RotateCcw size={14} /> Retry
        </button>
      </div>
    );
  }
  return (
    <div className="demo-route-loading" role="status">
      {guard === 'checking' ? 'Checking your session…' : 'Redirecting to sign in…'}
    </div>
  );
}

function RouterContent() {
  const [path, setPath] = useState(location.pathname.replace(/\/$/, '') || '/');

  useEffect(() => {
    const update = () => setPath(location.pathname.replace(/\/$/, '') || '/');
    window.addEventListener('popstate', update);

    const handleLinkClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (!target) return;
      const href = target.getAttribute('href');
      if (
        href &&
        href.startsWith('/') &&
        !href.startsWith('//') &&
        !target.getAttribute('target') &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        window.history.pushState({}, '', href);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        update();
      }
    };
    document.addEventListener('click', handleLinkClick);

    // Session over (signed out, wallet changed, or a 401): leave protected
    // pages and drop live connections. A 401 remembers where the user was.
    const onSessionEnded = (e: Event) => {
      closeAllWorkspaceRealtime();
      const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason;
      const here = location.pathname + location.search;
      if (here.startsWith('/signin') || here === '/' || here.startsWith('/landing')) return;
      navigate(reason === 'expired' ? `/signin?next=${encodeURIComponent(here)}` : '/signin');
    };
    window.addEventListener(SESSION_ENDED_EVENT, onSessionEnded);

    return () => {
      window.removeEventListener('popstate', update);
      document.removeEventListener('click', handleLinkClick);
      window.removeEventListener(SESSION_ENDED_EVENT, onSessionEnded);
    };
  }, []);

  if (path === '/' || path === '/landing') return <LandingPage />;
  if (path === '/signin' || path === '/login' || path === '/signup') return <SignInPage />;
  if (path === '/workspaces' || path === '/onboarding')
    return (
      <RouteGuard>
        <WorkspacesPage />
      </RouteGuard>
    );
  if (path === '/canvas' || path.startsWith('/workspace/'))
    return (
      <RouteGuard>
        <CanvasApp />
      </RouteGuard>
    );

  return (
    <div className="demo-not-found">
      <h1>Route not found</h1>
      <a href="/">Return home</a>
    </div>
  );
}

export function AppRouter() {
  if (isMisconfiguredDeployment()) {
    return (
      <div className="demo-not-found" role="alert">
        <h1>This deployment is not connected to a server</h1>
        <p>It was built without VITE_API_URL and VITE_WS_URL, so it does not know where the AgentMesh API is.</p>
        <p>Set both to the server's public https:// and wss:// URLs and rebuild. See docs/DEPLOYMENT.md.</p>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="demo-route-loading" role="status">Loading AgentMesh…</div>}>
      <RouterContent />
    </Suspense>
  );
}
