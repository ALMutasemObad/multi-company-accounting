import base from '../../../vite.subscription-discovery.config.mjs';
import { resolve } from 'node:path';
export default {
  ...base, cacheDir: resolve('tmp/coordination/subscription-acceptance/vite'),
  build: { ...base.build, outDir: resolve('tmp/coordination/subscription-acceptance/build') },
  server: { ...base.server, port: 4216, proxy: { '/api': 'http://127.0.0.1:3166' } },
};
