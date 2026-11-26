import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:9222',
      '/command': 'http://127.0.0.1:9222',
      '/status': 'http://127.0.0.1:9222',
      '/health': 'http://127.0.0.1:9222',
      '/openapi.json': 'http://127.0.0.1:9222',
      '/docs': 'http://127.0.0.1:9222',
    },
  },
});
