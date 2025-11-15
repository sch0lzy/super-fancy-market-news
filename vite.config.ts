import { defineConfig } from 'vite';

export default defineConfig({
  base: '/super-fancy-market-news/',
  root: '.',
  build: {
    outDir: 'docs',
    sourcemap: true,
  },
});
