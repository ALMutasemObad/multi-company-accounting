import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const source = name => fileURLToPath(new URL(`./apps/web/src/${name}`, import.meta.url));

// Offline bundle verification of the unwired slice; no server or shared cache.
export default defineConfig({
  cacheDir: './tmp/subscription-upgrade/vite-build',
  build: {
    outDir: './tmp/subscription-upgrade/build',
    emptyOutDir: false,
    lib: {
      entry: {
        SubscriptionUpgradeCard: source('SubscriptionUpgradeCard.tsx'),
        SubscriptionUpgradeBanner: source('SubscriptionUpgradeBanner.tsx'),
        'subscription-upgrade-contract': source('subscription-upgrade-contract.ts'),
        'subscription-upgrade-policy': source('subscription-upgrade-policy.ts'),
        'subscription-upgrade-dismissal': source('subscription-upgrade-dismissal.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: { external: ['react', 'react/jsx-runtime'] },
  },
});
