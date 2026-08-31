import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: resolve("apps/web"),
  plugins: [react()],
  cacheDir: resolve("tmp/track-a/vite-cache"),
  server: {
    host: "127.0.0.1", port: 4180, strictPort: true, proxy: { "/api": "http://127.0.0.1:3130" },
    // The shared dependency junction resolves outside this worktree. Permit only
    // its font assets, not another track's application source.
    fs: { allow: [resolve("."), realpathSync(resolve("node_modules/@fontsource"))] },
  },
});
