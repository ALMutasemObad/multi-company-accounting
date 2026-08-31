import base from './vite.config.mjs';
import { resolve } from 'node:path';

// Keep the first acceptance run's cache/build/evidence untouched.
export default {
  ...base, cacheDir: resolve('tmp/coordination/w1-qa-fixes/vite'),
  build: { ...base.build, outDir: resolve('tmp/coordination/w1-qa-fixes/build') },
};
