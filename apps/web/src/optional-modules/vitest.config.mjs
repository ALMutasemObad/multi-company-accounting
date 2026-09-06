import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['apps/web/src/optional-modules/*.test.tsx'], maxWorkers: 1, fileParallelism: false } });
