import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: './tmp/subscription-discovery/vite',
  test: {
    include: [
      'apps/web/src/subscription-plan-navigation.test.ts',
      'apps/web/src/public-plans.test.ts',
      'apps/web/src/PlansDiscovery*.test.{ts,tsx}',
      'apps/web/src/subscription-upgrade-*.test.{ts,tsx}',
      'apps/web/src/subscription-change-safety.test.ts',
      'apps/web/src/subscription-usage.test.ts',
    ],
    pool: 'threads', maxWorkers: 1, fileParallelism: false,
  },
});
