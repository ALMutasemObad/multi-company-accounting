import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const trackRoot = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: resolve(trackRoot, "apps/web"),
  plugins: [react({})],
  cacheDir: resolve(trackRoot, "apps/web/node_modules/.cache-track-b/vite"),
  server: {
    host: "127.0.0.1", port: 4181, strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3131" },
    fs: { allow: [trackRoot, realpathSync(resolve(trackRoot, "node_modules/@fontsource"))] },
  },
});
