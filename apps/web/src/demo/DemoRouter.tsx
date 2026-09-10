import { lazy, Suspense, useEffect, useState } from 'react';
import { DemoProvider } from './DemoProvider';
import { AuthPage, OnboardingPage, RouteGuard, WorkspacesPage } from './DemoPages';
const CanvasApp = lazy(() => import('../App'));
const LandingPage = lazy(() => import('../features/landing/LandingPage'));

function RouterContent() {
  const [path, setPath] = useState(location.pathname.replace(/\/$/, '') || '/');

  useEffect(() => {
    const update = () => setPath(location.pathname.replace(/\/$/, '') || '/');
    addEventListener('popstate', update);

    // Smooth SPA link navigation interceptor
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

    return () => {
      removeEventListener('popstate', update);
      document.removeEventListener('click', handleLinkClick);
    };
  }, []);
  if (path === '/' || path === '/landing') return <LandingPage/>;
  if (path === '/login') return <AuthPage mode="login"/>;
  if (path === '/signup') return <AuthPage mode="signup"/>;
  if (path === '/onboarding') return <RouteGuard><OnboardingPage/></RouteGuard>;
  if (path === '/workspaces') return <RouteGuard><WorkspacesPage/></RouteGuard>;
  if (path === '/canvas') return <CanvasApp/>;
  if (path.startsWith('/workspace/')) return <RouteGuard><CanvasApp/></RouteGuard>;
  return <div className="demo-not-found"><h1>Workspace route not found</h1><a href="/">Return home</a></div>;
}
export function DemoRouter() { return <DemoProvider><Suspense fallback={<div className="demo-route-loading" role="status">Loading AgentMesh…</div>}><RouterContent/></Suspense></DemoProvider>; }
