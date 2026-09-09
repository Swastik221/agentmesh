import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Forward API calls to the Express backend. The backend exposes both
      // `/foo` and `/api/foo` variants for most resources; stripping the `/api`
      // prefix keeps a single consistent client base and matches every router.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Live workspace state (snapshot/delta/presence/task.status/activity).
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});