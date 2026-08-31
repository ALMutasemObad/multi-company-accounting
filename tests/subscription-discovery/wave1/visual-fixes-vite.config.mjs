import base from './vite.config.mjs';
import { resolve } from 'node:path';
export default {
  ...base, cacheDir: resolve('tmp/coordination/w1-visual-fixes/vite'),
  build: { ...base.build, outDir: resolve('tmp/coordination/w1-visual-fixes/build') },
};
