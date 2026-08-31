import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  cacheDir: fileURLToPath(new URL("./tmp/cashier-context/build-cache", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("./tmp/cashier-context/component-build", import.meta.url)),
    emptyOutDir: false,
    lib: { entry: fileURLToPath(new URL("./apps/web/src/CashierContextPanel.tsx", import.meta.url)), formats: ["es"], fileName: "cashier-context-panel" },
    rolldownOptions: { external: ["react", "react/jsx-runtime"] },
  },
});
