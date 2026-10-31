import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dev server: /api/* is proxied to the aggregator and the stats bearer token
 * is added here, server-side, from ANALYTICS_TOKEN. The browser bundle never
 * contains the token.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['AGGREGATOR_URL'] ?? 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        headers: process.env['ANALYTICS_TOKEN'] ? { Authorization: `Bearer ${process.env['ANALYTICS_TOKEN']}` } : {},
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
