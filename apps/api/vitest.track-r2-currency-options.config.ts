import { defineConfig } from 'vitest/config';

export default defineConfig({ cacheDir: 'node_modules/.vite-track-r2-currency-options', test: {
  include: ['tests/currency-options.test.ts', 'tests/company-service.test.ts',
    'tests/company-router-guards.test.ts', 'tests/openapi-route-parity.test.ts'],
  fileParallelism: false, maxWorkers: 1,
} });
