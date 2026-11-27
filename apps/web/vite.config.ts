import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };

  // A deployed build must know where its API is. Without these it would call
  // http://localhost:3001 from every visitor's browser (the original Vercel
  // deployment did exactly that). Enforced for Vercel production builds and
  // whenever AGENTMESH_REQUIRE_API_URL=true; local and CI builds still work.
  const mustHaveApi = env.VERCEL_ENV === 'production' || env.AGENTMESH_REQUIRE_API_URL === 'true';
  if (mode === 'production' && mustHaveApi) {
    const missing = ['VITE_API_URL', 'VITE_WS_URL'].filter((k) => !env[k]);
    if (missing.length) {
      throw new Error(`Refusing to build for deployment without ${missing.join(' and ')}. Set them to the server's public https:// and wss:// URLs.`);
    }
    if (/localhost|127\.0\.0\.1/.test(`${env.VITE_API_URL} ${env.VITE_WS_URL}`)) {
      throw new Error('VITE_API_URL / VITE_WS_URL point at localhost in a deployment build.');
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
    },
  };
});
