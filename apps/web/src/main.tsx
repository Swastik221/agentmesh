import React from 'react';
import ReactDOM from 'react-dom/client';
import { lazy, Suspense } from 'react';
const CanvasApp = lazy(() => import('./App'));
const LandingPage = lazy(() => import('./features/landing/LandingPage'));
import './index.css';

const pathname = window.location.pathname.replace(/\/$/, '') || '/';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense
      fallback={
        <div role="status" style={{ padding: 32 }}>
          Loading AgentMesh…
        </div>
      }
    >
      {pathname === '/canvas' ? <CanvasApp /> : <LandingPage />}
    </Suspense>
  </React.StrictMode>,
);
