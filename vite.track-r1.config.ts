import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: resolve("apps/web"), plugins: [react()],
  cacheDir: resolve("apps/web/node_modules/.cache-track-r1/vite"),
  build: { outDir: resolve("tmp/track-r1/build"), emptyOutDir: false },
  server: { host: "127.0.0.1", port: 4190, strictPort: true, proxy: { "/api": "http://127.0.0.1:3140" },
    fs: { allow: [resolve("."), realpathSync(resolve("node_modules/@fontsource"))] } },
});
