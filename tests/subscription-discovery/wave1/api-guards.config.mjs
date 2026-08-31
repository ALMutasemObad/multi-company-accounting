export default {
  cacheDir: './tmp/coordination/subscription-acceptance/api-vitest',
  test: { include: [
    'apps/api/tests/architecture-guardrails.test.ts',
    'apps/api/tests/public-plan-catalog.test.ts',
    'apps/api/tests/openapi-subscription-usage-contract.test.ts',
  ], pool: 'threads', maxWorkers: 1, fileParallelism: false },
};
