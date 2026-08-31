import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({ root: resolve('apps/web'), cacheDir: resolve('apps/web/node_modules/.cache-track-d/vitest'),
  test: { maxWorkers: 1, include: ['src/subscription-change-*.test.ts'] } });
