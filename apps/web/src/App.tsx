import { useEffect, useState } from 'react';
import { HealthStatus } from '@agentmesh/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function App() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted = true;

    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (response.ok) {
          const data: HealthStatus = await response.json();
          if (isMounted && data.status === 'ok') {
            setIsConnected(true);
            return;
          }
        }
        if (isMounted) setIsConnected(false);
      } catch {
        if (isMounted) setIsConnected(false);
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="container">
      <h1 className="title">AgentMesh</h1>
      <p className="tagline">Multiplayer workspace for humans + AI agents.</p>

      <div
        id="backend-status"
        className={`status-badge ${isConnected === true ? 'connected' : 'disconnected'}`}
      >
        <span className="status-dot"></span>
        <span>Backend: {isConnected === true ? 'Connected' : 'Disconnected'}</span>
      </div>

      <div className="footer-info">
        <span>Repository Foundation &bull; Monorepo v0.1.0</span>
      </div>
    </div>
  );
}

export default App;
