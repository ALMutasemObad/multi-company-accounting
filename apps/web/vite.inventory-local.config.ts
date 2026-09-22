import { mergeConfig } from "vite";
import baseConfig from "./vite.config";

export default mergeConfig(baseConfig, {
  server: {
    // Expose the local MVP to phones and tablets on the same trusted LAN.
    // API traffic remains behind Vite's same-origin proxy on this single port.
    host: "0.0.0.0",
    port: 4175,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3010" },
  },
});
