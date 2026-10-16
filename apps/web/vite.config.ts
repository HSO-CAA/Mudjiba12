import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

/**
 * Vendor groups → long-cacheable chunks. Groups pull in their dependencies recursively, so the
 * React group must win first; the 3D stack (three, R3F, drei, postprocessing) is only reachable
 * through lazy imports and never lands in the entry chunk.
 */
const vendorGroups: { name: string; test: RegExp; priority: number }[] = [
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|cookie|set-cookie-parser)[\\/]/, priority: 50 },
  { name: 'motion', test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/, priority: 40 },
  { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 40 },
  { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 30 },
  {
    name: 'r3f',
    test: /node_modules[\\/](@react-three|postprocessing|maath|three-stdlib|three-mesh-bvh|@monogrid|camera-controls|troika-[^\\/]+|its-fine|suspend-react|zustand|react-use-measure|use-sync-external-store|tunnel-rat|detect-gpu|stats-gl|stats\.js|hls\.js|meshline|@use-gesture|fflate|react-reconciler)[\\/]/,
    priority: 20,
  },
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/media': { target: apiTarget, changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/media': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 2048,
    // three.js alone is ~1 MB minified (290 kB gzip); it is a lazy, immutable-cached chunk.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: vendorGroups,
        },
      },
    },
  },
});
