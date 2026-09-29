import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // ^/api/ (regex) so page routes like /api-providers are NOT proxied
      '^/api/': 'http://localhost:3210',
      '/ws': { target: 'ws://localhost:3211', ws: true },
    },
  },
});
