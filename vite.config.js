import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :5000 and is proxied so the app can call `/api/...` same-origin.
// In production set VITE_API_URL to the deployed API (e.g. https://api.example.com/api).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5000',
        changeOrigin: true,
        // API not running: answer 503 with a readable reason (the client retries 503 until the API is up) instead of a bare 500
        configure: (proxy) => proxy.on('error', (_err, _req, res) => {
          if (res.writeHead && !res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end?.(JSON.stringify({ detail: 'The ReadVibe API is not running. Start everything with `npm run dev` (it launches the API on :5000 and the web app together).' }));
        }),
      },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // stable vendor chunks stay cached across deploys
        manualChunks: (id) => (id.includes('node_modules') ? (/react-router|@remix-run/.test(id) ? 'router' : /lucide/.test(id) ? 'icons' : /react/.test(id) ? 'react' : undefined) : undefined),
      },
    },
  },
});
