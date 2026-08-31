import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: './tmp/subscription-upgrade/vite',
  test: {
    include: [
      'apps/web/src/subscription-upgrade-*.test.{ts,tsx}',
      'apps/web/src/subscription-change-safety.test.ts',
      'apps/web/src/subscription-usage.test.ts',
      'apps/web/src/public-plans.test.ts',
      'apps/web/src/module-entitlements.test.ts',
      'apps/web/src/authorization.test.ts',
    ],
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
  },
});
