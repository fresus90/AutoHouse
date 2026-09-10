import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.PORT ?? '4000';
const isDemo = process.env.VITE_DEMO === '1';
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'web',
  plugins: [react()],
  // Entscheidet, welcher API-Client gebuendelt wird. Der jeweils andere
  // taucht im Bundle gar nicht erst auf.
  resolve: {
    alias: {
      '@client': path.resolve(here, isDemo ? 'src/lib/demo-api.ts' : 'src/lib/http-api.ts'),
    },
  },
  // Als echte Konstante ersetzen, nicht als Zugriff auf das env-Objekt.
  define: {
    'import.meta.env.VITE_DEMO': JSON.stringify(process.env.VITE_DEMO ?? ''),
  },
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
