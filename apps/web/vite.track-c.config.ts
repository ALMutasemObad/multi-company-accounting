import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
export default defineConfig({
  root: resolve(workspace, "apps/web"),
  plugins: [react()],
  cacheDir: resolve(workspace, "apps/web/node_modules/.vite-track-c"),
  server: {
    host: "127.0.0.1", port: 4182, strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3132" },
    fs: { allow: [workspace, realpathSync(resolve(workspace, "node_modules/@fontsource"))] },
  },
});
