import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  // stills are rendered from a long-lived dev server; never hot-reload a page mid-render
  server: { fs: { strict: false }, hmr: process.env.VILLA_NO_HMR ? false : true },
});
