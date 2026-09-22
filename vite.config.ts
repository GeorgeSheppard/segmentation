import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      // The tutorial, plus the standalone scene comparison page — both static entry points,
      // built side by side rather than routed through the tutorial's own JS.
      input: {
        main: resolve(__dirname, "index.html"),
        compare: resolve(__dirname, "compare.html"),
      },
    },
  },
  server: { host: true },
});
