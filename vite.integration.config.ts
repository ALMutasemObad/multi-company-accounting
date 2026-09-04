import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve('apps/web'),
  plugins: [react()],
  cacheDir: resolve('apps/web/node_modules/.cache-integration'),
  server: {
    host: '127.0.0.1', port: 4183, strictPort: true,
    // Worktrees may share an installed dependency tree. Keep the Arabic font
    // available without broadly allowing the external dependency directory.
    fs: { allow: [resolve('.'), realpathSync(resolve('node_modules/@fontsource'))] },
    proxy: { '/api': 'http://127.0.0.1:3133' },
  },
});
