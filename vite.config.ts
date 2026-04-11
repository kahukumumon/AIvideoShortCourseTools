import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const coiHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  root: 'src/video-edit-app',
  base: './',
  plugins: [react()],
  server: { headers: coiHeaders },
  preview: { headers: coiHeaders },
  build: {
    outDir: '../../tools/video_edit',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/test/**/*.test.ts'],
  },
});