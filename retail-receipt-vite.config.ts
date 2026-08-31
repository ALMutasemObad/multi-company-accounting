import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: resolve(import.meta.dirname, 'tests/retail-receipt'), plugins: [react()],
  cacheDir: resolve(import.meta.dirname, 'tmp/retail-receipt/browser-cache'),
  server: { host: '127.0.0.1', port: 4202, strictPort: true,
    fs: { allow: [import.meta.dirname, realpathSync(resolve(import.meta.dirname, 'node_modules/@fontsource'))] } },
});
