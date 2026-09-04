import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const dependencyRoot = realpathSync(fileURLToPath(new URL("../../node_modules", import.meta.url)));

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    fs: {
      allow: [searchForWorkspaceRoot(workspaceRoot), dependencyRoot],
    },
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
