import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Where `/api` and `/media` go in dev/preview. The real API runs on :4000; tests can point it at a mock. */
const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

const proxy = {
  '/api': { target: apiTarget, changeOrigin: false },
  '/media': { target: apiTarget, changeOrigin: false },
};

const vendorGroups: { name: string; test: RegExp; priority: number }[] = [
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|cookie|set-cookie-parser)[\\/]/, priority: 20 },
  { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 10 },
  { name: 'dnd', test: /node_modules[\\/]@dnd-kit[\\/]/, priority: 10 },
  { name: 'ui', test: /node_modules[\\/](sonner|lucide-react|clsx)[\\/]/, priority: 10 },
];

export default defineConfig({
  // Relative base: the API serves the build under a secret ADMIN_PATH and injects <base href="ADMIN_PATH/">.
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    proxy,
  },
  preview: {
    port: 4174,
    proxy,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: vendorGroups,
        },
      },
    },
  },
});
