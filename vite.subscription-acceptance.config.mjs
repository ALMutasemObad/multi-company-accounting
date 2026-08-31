import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const output = process.env.SUBSCRIPTION_ACCEPTANCE_RUN_DIR;
if (!output) throw new Error('Missing isolated subscription acceptance output directory');
export default defineConfig({
  root: resolve('apps/web'), plugins: [react()],
  cacheDir: resolve(output, 'cache/vite'),
  build: { outDir: resolve(output, 'build'), emptyOutDir: false },
  server: {
    host: '127.0.0.1', port: 4216, strictPort: true,
    fs: { allow: [resolve('.'), realpathSync(resolve('node_modules/@fontsource'))] },
    proxy: { '/api': 'http://127.0.0.1:3166' },
  },
});
