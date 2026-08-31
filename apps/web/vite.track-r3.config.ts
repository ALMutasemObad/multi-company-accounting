import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  cacheDir: "node_modules/.vite-track-r3",
  server: {
    host: "127.0.0.1", port: 4192, strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3142" },
  },
  build: { outDir: "../../tmp/agent/track-r3-build", emptyOutDir: false },
});
