import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  base: "./",
  build: {
    sourcemap: true,
    outDir: "../../.vite/renderer/main_window",
    emptyOutDir: true
  }
});
