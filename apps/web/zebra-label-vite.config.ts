import { defineConfig } from "vite";

/** Build the isolated composable slice without editing or mounting shared pages. */
export default defineConfig({
  cacheDir: "../../tmp/zebra-label/web-build-cache",
  build: {
    outDir: "../../tmp/zebra-label/web-build",
    emptyOutDir: false,
    lib: { entry: "src/ZebraLabelWorkflow.tsx", formats: ["es"], fileName: "zebra-label-workflow" },
    rollupOptions: { external: ["react", "react/jsx-runtime", "react-dom"] },
  },
});
