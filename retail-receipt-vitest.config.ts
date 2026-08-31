import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: resolve(import.meta.dirname, 'tmp/retail-receipt/vite-cache'),
  test: {
    include: ['apps/api/tests/retail-receipt-*.test.ts', 'apps/web/src/retail-receipt.test.tsx'],
    fileParallelism: false, maxWorkers: 1, pool: 'threads',
  },
});
