import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: local("./apps/web"), plugins: [react()],
  cacheDir: local("./tmp/plans-discovery/vite-cache"),
  build: { outDir: local("./tmp/plans-discovery/build"), emptyOutDir: false },
  server: { host: "127.0.0.1", port: 4211, strictPort: true, proxy: { "/api": "http://127.0.0.1:3161" } },
});
