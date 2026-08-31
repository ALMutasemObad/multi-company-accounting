import base from './vitest.config.mjs';
export default {
  ...base, cacheDir: './tmp/coordination/w1-qa-fixes/vitest',
  test: { ...base.test, include: [...base.test.include,
    'apps/web/src/subscription-route-intent.test.ts',
    'apps/web/src/safe-local-storage.test.tsx',
  ] },
};
