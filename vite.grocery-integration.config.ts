import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve('apps/web'), plugins: [react()],
  cacheDir: resolve('apps/web/node_modules/.cache-grocery-integration'),
  build: { outDir: resolve('tmp/agent/grocery-build'), emptyOutDir: false },
  server: {
    host: '127.0.0.1', port: 4193, strictPort: true,
    fs: { allow: [resolve('.'), realpathSync(resolve('node_modules/@fontsource'))] },
    proxy: { '/api': 'http://127.0.0.1:3143' },
  },
});
