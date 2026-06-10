import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
              return 'react';
            }

            if (
              id.includes('/node_modules/react-markdown/') ||
              id.includes('/node_modules/remark-gfm/') ||
              id.includes('/node_modules/lowlight/') ||
              id.includes('/node_modules/highlight.js/') ||
              id.includes('/src/renderer/highlightLanguages') ||
              id.includes('/src/renderer/rehypeHighlightSubset')
            ) {
              return 'markdown';
            }

            return undefined;
          },
        },
      },
    },
    plugins: [react()],
  },
});
