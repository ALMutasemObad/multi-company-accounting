import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';

export default defineConfig({
  root: resolve('apps/web'), plugins: [react()],
  cacheDir: resolve('apps/web/node_modules/.cache-track-d'),
  server: { host: '127.0.0.1', port: 4184, strictPort: true,
    fs: { allow: [resolve('.'), realpathSync('node_modules/@fontsource')] },
    proxy: { '/api': 'http://127.0.0.1:3134' } },
});
