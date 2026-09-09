import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localeManifestPlugin } from "./apps/web/vite.config";
export default defineConfig({
  root: resolve("tests/track-r1"), plugins: [localeManifestPlugin(), react()],
  cacheDir: resolve("apps/web/node_modules/.cache-track-r1/vite-test"),
  server: { host: "127.0.0.1", port: 4190, strictPort: true, proxy: { "/api": "http://127.0.0.1:3140" },
    fs: { allow: [resolve("."), realpathSync(resolve("node_modules/@fontsource"))] } },
});
